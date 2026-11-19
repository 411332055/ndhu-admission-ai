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

-- 備援檢索：中文雙字詞重疊比例
create or replace function public.match_chunks_text(q text, match_count int default 4, include_staff boolean default false)
returns table (id bigint, source text, content text, similarity float, audience text)
language sql stable
set search_path = public
as $$
  with grams as (
    select distinct substr(q, i, 2) as g
    from generate_series(1, greatest(char_length(q) - 1, 1)) as i
    where substr(q, i, 2) !~ '[[:space:][:punct:]？，。、！：；「」（）]'
      and substr(q, i, 2) not in ('什麼','怎麼','可以','要在','是否','請問','我要','如何','的時','時候')
  ),
  total as (select greatest(count(*), 1)::float as n from grams),
  scored as (
    select c.id, c.source, c.content, c.audience,
           (select count(*) from grams where strpos(c.content, grams.g) > 0)::float / (select n from total) as s
    from public.kb_chunks c
    where include_staff or c.audience = 'public'
  )
  select id, source, content, s, audience from scored
  where s >= 0.35
  order by s desc, id
  limit match_count;
$$;
revoke execute on function public.match_chunks_text(text, int, boolean) from public, anon, authenticated;
grant execute on function public.match_chunks_text(text, int, boolean) to service_role;
