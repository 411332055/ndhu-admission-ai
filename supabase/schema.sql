-- 東華大學入學行政 AI 助理：知識庫資料表
-- 在 Supabase SQL Editor 執行一次即可

create extension if not exists vector with schema extensions;

-- 知識庫：每一段入學資料 + 向量
create table if not exists public.kb_chunks (
  id          bigserial primary key,
  source      text not null,              -- 來源檔名 / 標題
  content     text not null,              -- 段落內容
  embedding   extensions.vector(768) not null,       -- Gemini embedding（768 維）
  created_at  timestamptz not null default now()
);
create index if not exists kb_chunks_embedding_idx
  on public.kb_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists kb_chunks_source_idx on public.kb_chunks (source);

-- 問答紀錄：用來分析使用者常問什麼、哪些問題知識庫答不出來（知識缺口）
create table if not exists public.chat_logs (
  id          bigserial primary key,
  question    text not null,
  answer      text,
  sources     text[],
  top_score   real,
  answered    boolean,                    -- status = 'full'
  status      text not null default 'full', -- full 完整回答 / partial 部分回答 / none 無資料（由 AI 回報）
  resolved    boolean not null default false, -- 後台按「已補充」後不再列為缺口
  created_at  timestamptz not null default now()
);

-- 開啟 RLS 且不建任何 policy：前端無法直接讀寫，只有後端（service role）可以
alter table public.kb_chunks enable row level security;
alter table public.chat_logs enable row level security;

-- 資料分級：public 學生／家長可查；staff 只有行政人員登入後可查（過濾在資料庫函式裡做）
alter table public.kb_chunks add column if not exists audience text not null default 'public' check (audience in ('public','staff'));
create index if not exists kb_chunks_audience_idx on public.kb_chunks (audience);
alter table public.chat_logs add column if not exists role text not null default 'student';  -- student / staff
alter table public.chat_logs add column if not exists helpful boolean;                      -- 使用者回饋：true 有幫助 / false 沒幫到

-- 知識來源統計（資料庫端直接分組，避免超過 1,000 段時被查詢上限截斷）
create or replace function public.list_sources()
returns table (source text, audience text, chunks bigint, updated timestamptz)
language sql stable
set search_path = public
as $$
  select c.source, max(c.audience) as audience, count(*) as chunks, max(c.created_at) as updated
  from public.kb_chunks c
  group by c.source
  order by max(c.created_at) desc;
$$;
revoke execute on function public.list_sources() from public, anon, authenticated;
grant execute on function public.list_sources() to service_role;

-- 提問頻率限制（防洗版，保護免費額度）
create table if not exists public.rate_limits (
  key text primary key,
  count int not null default 1,
  window_start timestamptz not null default now()
);
alter table public.rate_limits enable row level security;

create or replace function public.check_rate_limit(p_key text, p_limit int default 8, p_window_sec int default 60)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.rate_limits where window_start < now() - make_interval(secs => p_window_sec * 5);
  insert into public.rate_limits (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
  set count = case
        when rate_limits.window_start < now() - make_interval(secs => p_window_sec) then 1
        else rate_limits.count + 1
      end,
      window_start = case
        when rate_limits.window_start < now() - make_interval(secs => p_window_sec) then now()
        else rate_limits.window_start
      end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;
revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;

-- 行政人員分享的經驗筆記（隱性知識外化），管理者審核通過後才寫入 staff 知識庫
create table if not exists public.staff_notes (
  id bigserial primary key,
  title text not null,
  content text not null,
  author text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table public.staff_notes enable row level security;

-- 快取（熱門問題統計，避免每次都呼叫 Gemini）
create table if not exists public.app_cache (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_cache enable row level security;

-- 向量相似度搜尋（include_staff=false 時只搜公開資料）
create or replace function public.match_chunks(
  query_embedding extensions.vector(768),
  match_count int default 4,
  min_similarity float default 0.5,
  include_staff boolean default false
)
returns table (id bigint, source text, content text, similarity float, audience text)
language sql stable
set search_path = public, extensions
as $$
  select c.id, c.source, c.content, 1 - (c.embedding <=> query_embedding) as similarity, c.audience
  from public.kb_chunks c
  where (include_staff or c.audience = 'public')
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
revoke execute on function public.match_chunks(extensions.vector, int, float, boolean) from public, anon, authenticated;
grant execute on function public.match_chunks(extensions.vector, int, float, boolean) to service_role;

-- 備援與混合檢索：同時比對「文件標題＋內文」的中文雙字詞與英數代碼（標題命中與代碼精準命中皆加權）
create or replace function public.match_chunks_text(q text, match_count int default 4, include_staff boolean default false)
returns table (id bigint, source text, content text, similarity float, audience text)
language sql stable
set search_path = public
as $$
  with grams as (
    select distinct substr(q, i, 2) as g
    from generate_series(1, greatest(char_length(q) - 1, 1)) as i
    where substr(q, i, 2) !~ '[[:space:][:punct:]？，。、！：；「」（）『』]'
      and substr(q, i, 2) !~ '^[A-Za-z0-9]+$'
      and substr(q, i, 2) not in (
        '什麼','怎麼','可以','要在','是否','請問','我要','如何','的時','時候',
        '哪些','哪裡','多少','還有','如果','需要','應該','一下','關於','知道','告訴','我們','你們','他們'
      )
  ),
  tokens as (
    select distinct lower(m[1]) as t
    from regexp_matches(q, '([A-Za-z0-9][A-Za-z0-9_+.-]{1,})', 'g') as m
  ),
  counts as (
    select (select count(*) from grams) as ng, (select count(*) from tokens) as nt
  ),
  scored as (
    select c.id, c.source, c.content, c.audience,
      least(1.0,
        case when (select ng from counts) > 0 then
          (
            (select count(*) from grams where strpos(c.content, grams.g) > 0)::float
            + 1.6 * (select count(*) from grams where strpos(c.source, grams.g) > 0)::float
          ) / ((select ng from counts)::float * 1.4)
        else 0.0 end
        + case when (select nt from counts) > 0 then
          (
            (select count(*) from tokens where strpos(lower(c.source || ' ' || c.content), tokens.t) > 0)::float
            / (select nt from counts)::float
          ) * 0.85
        else 0.0 end
      ) as s
    from public.kb_chunks c
    where include_staff or c.audience = 'public'
  )
  select id, source, content, s, audience from scored
  where s >= 0.32
  order by s desc, id
  limit match_count;
$$;
revoke execute on function public.match_chunks_text(text, int, boolean) from public, anon, authenticated;
grant execute on function public.match_chunks_text(text, int, boolean) to service_role;

-- 排程匯入佇列：大型 PDF 由 pg_cron 定時呼叫 Edge Function 的 process_queue，一次處理一小步（上傳或 10 頁）
create table if not exists public.import_queue (
  id bigserial primary key,
  url text not null,
  source text not null,
  status text not null default 'pending',   -- pending / parts / done / error
  file_uri text,                            -- Gemini Files API 的檔案位址
  next_from integer not null default 1,     -- 下一次要轉錄的起始頁
  chunks integer not null default 0,
  error text,
  locked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.import_queue enable row level security;
-- 需要時再建立排程（用完記得 cron.unschedule）：
-- select cron.schedule('process-import-queue', '*/2 * * * *', $$
--   select net.http_post(url := 'https://krbrxahyebnvjnxievjb.supabase.co/functions/v1/chat',
--     body := '{"action":"process_queue"}'::jsonb, headers := '{"content-type":"application/json"}'::jsonb,
--     timeout_milliseconds := 150000) $$);
