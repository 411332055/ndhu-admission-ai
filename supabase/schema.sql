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

-- 口語化關鍵字對照表：將學生／家長常用口語自動對應到官方正式用語，提升檢索精準度
create table if not exists public.kb_synonyms (
  term text primary key,
  expands text not null
);
alter table public.kb_synonyms enable row level security;

insert into public.kb_synonyms (term, expands) values
  -- 招生管道口語
  ('個申', '申請入學 個人申請'),
  ('個人申請', '申請入學'),
  ('繁星', '繁星推薦'),
  ('分科', '分發入學 分科測驗'),
  ('指考', '分發入學'),
  ('轉學考', '轉學生 轉學招生 暑轉'),
  ('暑轉', '暑假轉學生 轉學生'),
  ('寒轉', '寒假轉學生 轉學生'),
  ('推甄', '甄試入學 碩士班甄試'),
  ('獨招', '單獨招生'),
  ('特殊選才', '特殊選才 單獨招生'),
  ('原住民', '原住民學生 民族學院 減免'),
  ('僑生', '僑生 港澳生 國際事務處'),
  ('外籍生', '外國學生 國際事務處'),
  -- 註冊、報到與證件
  ('報到', '新生報到 網路報到 網路註冊'),
  ('線上註冊', '網路註冊 網路註冊系統'),
  ('畢業證書', '學歷證件 畢業證書 切結書 補繳'),
  ('沒交畢業證書', '學歷證件 切結書 補繳 延後繳交'),
  ('補交', '補繳 逾期 切結書'),
  ('忘記傳', '補繳 逾期 報到資料上傳'),
  ('學號', '學號查詢 網路註冊 單一簽入'),
  ('忘記密碼', '密碼重設 單一簽入 網路註冊系統'),
  -- 學費、貸款與補助
  ('學費', '學雜費 繳費 繳納'),
  ('繳錢', '學雜費 繳費 繳費單 台灣銀行'),
  ('刷卡', '信用卡 繳費 學雜費'),
  ('超商繳費', '便利商店 繳費 學雜費'),
  ('延後繳費', '延緩繳交 學雜費延緩繳交'),
  ('學貸', '就學貸款 台灣銀行 對保'),
  ('助學貸款', '就學貸款 台灣銀行'),
  ('減免', '學雜費減免 低收入戶 中低收入戶 身心障礙'),
  ('低收', '低收入戶 學雜費減免 弱勢助學'),
  ('中低收', '中低收入戶 學雜費減免 弱勢助學'),
  ('獎學金', '獎助學金 優秀新生入學獎勵'),
  ('補助', '弱勢助學 獎助學金 減免'),
  -- 體檢、兵役與新生生活
  ('體檢', '新生健康檢查 體檢表 衛保組'),
  ('健檢', '新生健康檢查 體檢'),
  ('當兵', '兵役 兵役調查 緩徵 儘後召集'),
  ('兵役', '兵役調查 緩徵 儘後召集'),
  ('宿舍', '學生宿舍 住宿申請 進住 床位'),
  ('住宿', '學生宿舍 住宿申請 宿舍費'),
  ('搬進去', '宿舍進住 學生宿舍 新生進住'),
  ('宿網', '宿舍網路 宿網申請 資訊處'),
  ('新生營', '新生入學指導 新生定向輔導'),
  ('新生訓練', '新生入學指導 新生定向輔導'),
  ('開學', '開學日 行事曆 註冊日'),
  -- 選課與學籍
  ('搶課', '選課 初選 加退選 選課系統'),
  ('加退選', '選課 加退選 課務組'),
  ('抵免', '學分抵免 科目學分抵免'),
  ('二一', '學業成績不及格 退學 學則 預警'),
  ('被當', '學業成績不及格 重修 學則'),
  ('休學', '休學申請 退費 學則'),
  ('退學', '退學 退費 學則'),
  ('轉系', '轉系 轉系辦法 教務處'),
  ('雙主修', '雙主修 申請 教務處'),
  ('輔系', '輔修 輔系 申請'),
  -- 校園交通
  ('怎麼去', '交通資訊 接駁車 志學火車站'),
  ('志學站', '志學火車站 交通資訊 接駁車'),
  ('腳踏車', '自行車 腳踏車 校園交通')
on conflict (term) do update set expands = excluded.expands;

create or replace function public.expand_query(q text)
returns text
language sql stable
set search_path = public
as $$
  select case
    when extra is null or extra = '' then q
    else q || ' ' || left(extra, 120)
  end
  from (
    select string_agg(expands, ' ') as extra
    from public.kb_synonyms
    where strpos(lower(q), lower(term)) > 0
  ) s;
$$;
revoke execute on function public.expand_query(text) from public, anon, authenticated;
grant execute on function public.expand_query(text) to service_role;

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
