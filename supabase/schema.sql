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

-- 向量相似度搜尋
create or replace function public.match_chunks(
  query_embedding extensions.vector(768),
  match_count int default 4,
  min_similarity float default 0.5
)
returns table (id bigint, source text, content text, similarity float)
language sql stable
set search_path = public, extensions
as $$
  select c.id, c.source, c.content, 1 - (c.embedding <=> query_embedding) as similarity
  from public.kb_chunks c
  where 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

revoke execute on function public.match_chunks(extensions.vector, int, float) from public, anon, authenticated;
grant execute on function public.match_chunks(extensions.vector, int, float) to service_role;

-- 備援檢索：向量額度用完時，用「中文雙字詞」重疊比例找相關段落（後端平常也會和向量結果合併）
create or replace function public.match_chunks_text(q text, match_count int default 4)
returns table (id bigint, source text, content text, similarity float)
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
    select c.id, c.source, c.content,
           (select count(*) from grams where strpos(c.content, grams.g) > 0)::float / (select n from total) as s
    from public.kb_chunks c
  )
  select id, source, content, s from scored
  where s >= 0.35
  order by s desc, id
  limit match_count;
$$;
revoke execute on function public.match_chunks_text(text, int) from public, anon, authenticated;
grant execute on function public.match_chunks_text(text, int) to service_role;
