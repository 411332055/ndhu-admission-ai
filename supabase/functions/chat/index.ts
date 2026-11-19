// 東華大學入學行政 AI 助理 — Supabase Edge Function
// 動作：
//   chat   { question, history? }                → RAG 問答（公開）
//   ingest { admin_key, source, text }           → 新增知識（管理員）
//   ingest_url { admin_key, url, source }        → 從網址下載 PDF / 網頁並加入知識（管理員）
//   pdf_prepare / pdf_part                       → 大型 PDF 分段匯入（管理員）
//   list   { admin_key }                       → 列出知識來源（管理員）
//   delete { admin_key, source }                 → 刪除某個來源（管理員）
//   stats  { admin_key }                         → 最近問答與知識缺口（管理員）
//
// 需要的 Secrets：GEMINI_API_KEY、ADMIN_KEY
// 選用：GEMINI_MODEL（預設 gemini-3.1-flash-lite）、EMBED_MODEL（預設 gemini-embedding-001）

import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const ADMIN_KEY = Deno.env.get("ADMIN_KEY") ?? "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.1-flash-lite";
const EMBED_MODEL = Deno.env.get("EMBED_MODEL") ?? "gemini-embedding-001";
const DIM = 768;
const TOP_K = 4;
const MIN_SIM = Number(Deno.env.get("MIN_SIMILARITY") ?? "0.5");
const CHUNK_SIZE = 700;   // 每段字數（免費版向量額度每分鐘 100 次，段落大一點比較不會超過）
const OVERLAP = 100;
const API = "https://generativelanguage.googleapis.com/v1beta";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `你是國立東華大學入學行政 AI 助理。
規則：
1. 只能根據「參考資料」回答，用繁體中文，條列清楚、簡潔。
2. 參考資料沒有的內容，回答「目前知識庫沒有相關資訊，建議洽詢東華大學教務處綜合業務組（03-8906143）」，不要自行編造。
3. 日期、名額、金額等數字必須和參考資料完全一致。
4. 回答最後另起一行，只寫一個標記，說明參考資料是否足以回答：
   【完整】參考資料足以完整回答問題
   【部分】只能回答一部分，問題中有細節（例如具體標準、分數、日期）參考資料沒有
   【無資料】參考資料完全無法回答
   這個標記只用來統計，使用者看不到。`;

const STATUS_TAG = /\s*[【\[]\s*(完整|部分|無資料)\s*[】\]]\s*$/;
const NO_INFO = /目前知識庫沒有相關資訊/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function gemini(path: string, body: unknown) {
  // Gemini 忙碌（429 / 500 / 503）時自動重試：等 1、2、4 秒
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${API}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return data;
    const perDay = /per day/i.test(String(data?.error?.message ?? ""));  // 每日額度用完：重試也沒用，直接回報
    if (attempt < 3 && [429, 500, 503].includes(r.status) && !perDay) {
      // 429 = 免費額度用完：依 Gemini 建議的秒數等待（最多 62 秒）
      const hint = Number(String(data?.error?.message ?? "").match(/retry in ([\d.]+)s/)?.[1] ?? 0);
      const wait = r.status === 429 && hint ? Math.min(hint + 1, 62) : 2 ** attempt;
      await new Promise((res) => setTimeout(res, wait * 1000));
      continue;
    }
    throw new Error(`Gemini ${r.status}: ${data?.error?.message ?? JSON.stringify(data)}`);
  }
}

function normalize(v: number[]) {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

async function embed(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50);
    const data = await gemini(`models/${EMBED_MODEL}:batchEmbedContents`, {
      requests: batch.map((text) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: DIM,
      })),
    });
    for (const e of data.embeddings) out.push(normalize(e.values));
  }
  return out;
}

function splitText(text: string, size = CHUNK_SIZE, overlap = OVERLAP) {
  const paras = text.replace(/[ \t]+/g, " ").split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (let p of paras) {
    if (buf.length + p.length <= size) {
      buf += p + "\n";
      continue;
    }
    if (buf) chunks.push(buf.trim());
    while (p.length > size) {
      chunks.push(p.slice(0, size));
      p = p.slice(size - overlap);
    }
    buf = (buf ? buf.slice(-overlap) : "") + p + "\n";
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

async function chat(question: string, history: { role: string; content: string }[] = []) {
  question = String(question ?? "").trim().slice(0, 500);
  if (!question) return json({ error: "請輸入問題" }, 400);

  // 混合檢索：向量（語意）＋ 關鍵字（雙字詞重疊）。向量額度用完時只用關鍵字，系統照常回答。
  let hits: any[] = [];
  try {
    const [qv] = await embed([question], "RETRIEVAL_QUERY");
    const { data, error } = await sb.rpc("match_chunks", {
      query_embedding: qv, match_count: TOP_K, min_similarity: MIN_SIM,
    });
    if (error) throw error;
    hits = data ?? [];
  } catch (e) {
    console.error("vector search failed, keyword only:", e);
  }
  const { data: kw } = await sb.rpc("match_chunks_text", { q: question, match_count: TOP_K });
  for (const k of kw ?? []) {
    if (hits.length >= TOP_K + 2) break;
    if (!hits.some((h) => h.id === k.id)) hits.push(k);
  }

  let answer: string;
  let status: "full" | "partial" | "none" = "none";
  let sources = [...new Set((hits ?? []).map((h: any) => h.source))] as string[];
  const top = hits?.[0]?.similarity ?? null;

  if (!hits?.length) {
    answer = "目前知識庫沒有相關資訊，建議洽詢東華大學教務處綜合業務組（03-8906143）。";
  } else {
    const ctx = hits.map((h: any, i: number) => `[${i + 1}]（${h.source}）${h.content}`).join("\n\n");
    const contents = history.slice(-4).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.content).slice(0, 1500) }],
    }));
    contents.push({ role: "user", parts: [{ text: `參考資料：\n${ctx}\n\n問題：${question}` }] });
    const data = await gemini(`models/${GEMINI_MODEL}:generateContent`, {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    });
    answer = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("").trim()
      || "抱歉，暫時無法產生回答，請稍後再試。";
    // 由 AI 自己回報是否真的答得出來；沒有標記時用文字判斷
    const m = answer.match(STATUS_TAG);
    answer = answer.replace(STATUS_TAG, "").trim();
    status = m ? ({ 完整: "full", 部分: "partial", 無資料: "none" } as const)[m[1] as "完整" | "部分" | "無資料"]
      : NO_INFO.test(answer) ? (answer.length < 90 ? "none" : "partial") : "full";
    // 我們自己的標記不該出現在答案中間
    answer = answer.replace(/[【\[]\s*(完整|部分|無資料)\s*[】\]]/g, "").trim();
    if (status === "none") sources = [];
  }

  await sb.from("chat_logs").insert({
    question, answer, sources, top_score: top, answered: status === "full", status,
  });
  return json({ answer, sources, top_score: top });
}

async function ingest(source: string, text: string, append = false) {
  source = String(source ?? "").trim().slice(0, 200);
  text = String(text ?? "");
  if (!source || !text.trim()) return json({ error: "需要 source 與 text" }, 400);
  const chunks = splitText(text);
  if (chunks.length > 500) return json({ error: "內容太長，請分成多份上傳" }, 400);
  const vecs = await embed(chunks, "RETRIEVAL_DOCUMENT");
  if (!append) await sb.from("kb_chunks").delete().eq("source", source); // 同名來源先刪除再寫入（更新）
  const rows = chunks.map((content, i) => ({ source, content, embedding: vecs[i] }));
  const { error } = await sb.from("kb_chunks").insert(rows);
  if (error) throw error;
  return json({ ok: true, source, chunks: chunks.length });
}

function htmlToText(html: string) {
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0]
    ?? html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
  return main
    .replace(/<(script|style|noscript|nav|header|footer)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi, "$2（附件：$1）")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function toBase64(buf: Uint8Array) {
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function ingestUrl(url: string, source: string) {
  url = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return json({ error: "請輸入 http(s) 開頭的網址" }, 400);
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (NDHU-KM-course-project)" } });
  if (!r.ok) return json({ error: `下載失敗：HTTP ${r.status}` }, 400);
  const type = r.headers.get("content-type") ?? "";
  const buf = new Uint8Array(await r.arrayBuffer());
  let text: string;
  let truncated = false;
  if (type.includes("pdf") || /\.pdf($|\?)/i.test(url)) {
    if (buf.length > 18 * 1024 * 1024) return json({ error: "PDF 超過 18MB", tooLarge: true }, 413);
    const data = await gemini(`models/${GEMINI_MODEL}:generateContent`, {
      contents: [{ role: "user", parts: [
        { inlineData: { mimeType: "application/pdf", data: toBase64(buf) } },
        { text: "請把這份文件的內容完整轉成純文字（繁體中文照原文）。規則：逐字保留所有日期、時間、金額、名額、電話、網址與單位名稱；表格每一列寫成一行，欄位用「 | 」分隔；不要摘要、不要省略、不要加入任何說明或評論；頁首頁尾與頁碼可省略。" },
      ] }],
      generationConfig: { temperature: 0, maxOutputTokens: 32768 },
    });
    text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    truncated = data?.candidates?.[0]?.finishReason === "MAX_TOKENS";
  } else {
    text = htmlToText(new TextDecoder("utf-8").decode(buf));
  }
  if (text.trim().length < 20) return json({ error: "讀不到文字內容" }, 400);
  text = `（原始網址：${url}）\n` + text;
  const res = await ingest(source, text);
  const body = await res.json();
  return json({ ...body, truncated, chars: text.length }, res.status);
}

// 大型 PDF（> 18MB）：先上傳到 Gemini Files API，再分段（依頁碼）轉成文字
async function pdfPrepare(url: string) {
  url = String(url ?? "").trim();
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (NDHU-KM-course-project)" } });
  if (!r.ok) return json({ error: `下載失敗：HTTP ${r.status}` }, 400);
  const buf = new Uint8Array(await r.arrayBuffer());
  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": GEMINI_KEY,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buf.length),
      "X-Goog-Upload-Header-Content-Type": "application/pdf",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: url.split("/").pop() } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) return json({ error: `Gemini 檔案上傳失敗：HTTP ${start.status}` }, 500);
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: buf,
  });
  const info = await up.json();
  let file = info.file;
  for (let i = 0; i < 20 && file?.state === "PROCESSING"; i++) {
    await new Promise((res) => setTimeout(res, 3000));
    const g = await fetch(`${API}/${file.name}`, { headers: { "x-goog-api-key": GEMINI_KEY } });
    file = await g.json();
  }
  if (!file?.uri || file.state === "FAILED") return json({ error: "Gemini 檔案處理失敗" }, 500);
  return json({ fileUri: file.uri, sizeMB: +(buf.length / 1048576).toFixed(1) });
}

async function pdfPart(fileUri: string, source: string, url: string, from: number, to: number) {
  const data = await gemini(`models/${GEMINI_MODEL}:generateContent`, {
    contents: [{ role: "user", parts: [
      { fileData: { mimeType: "application/pdf", fileUri } },
      { text: `只轉錄這份 PDF 的第 ${from} 頁到第 ${to} 頁（以 PDF 實際頁序計算，不是頁面上印的頁碼）。如果這些頁不存在，只輸出「（無此頁）」。規則：繁體中文照原文，逐字保留所有日期、時間、金額、名額、電話、網址與單位名稱；表格每一列寫成一行，欄位用「 | 」分隔；圖片中的文字也要轉錄；不要摘要、不要省略、不要加入說明。` },
    ] }],
    generationConfig: { temperature: 0, maxOutputTokens: 32768 },
  });
  const text = (data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "").trim();
  if (text.length < 30 || text.includes("（無此頁）")) return json({ ok: true, empty: true, chunks: 0 });
  const res = await ingest(source, `（原始網址：${url}，第 ${from}-${to} 頁）\n` + text, from > 1);
  const body = await res.json();
  return json({ ...body, empty: false, truncated: data?.candidates?.[0]?.finishReason === "MAX_TOKENS" }, res.status);
}

// 排程匯入：每次呼叫只處理一小步（下載上傳，或 10 頁），由 pg_cron 定時觸發。
// 只處理資料庫 import_queue 裡已排好的網址，不接受外部傳入網址，所以不需要管理密碼。
async function processQueue() {
  const { data: items } = await sb.from("import_queue").select("*")
    .in("status", ["pending", "parts"]).order("id").limit(1);
  const it = items?.[0];
  if (!it) return json({ ok: true, idle: true });
  if (it.locked_at && Date.now() - Date.parse(it.locked_at) < 170_000) return json({ ok: true, busy: true });
  await sb.from("import_queue").update({ locked_at: new Date().toISOString() }).eq("id", it.id);
  const save = (patch: Record<string, unknown>) =>
    sb.from("import_queue").update({ ...patch, locked_at: null, updated_at: new Date().toISOString() }).eq("id", it.id);
  try {
    if (it.status === "pending") {
      const res = await pdfPrepare(it.url);
      const body = await res.json();
      if (!res.ok) { await save({ status: "error", error: body.error }); return json(body, 500); }
      await save({ status: "parts", file_uri: body.fileUri, next_from: 1 });
      return json({ ok: true, step: "uploaded", id: it.id });
    }
    const from = it.next_from;
    const res = await pdfPart(it.file_uri, it.source, it.url, from, from + 9);
    const body = await res.json();
    if (!res.ok) { await save({ error: body.error }); return json(body, 500); }
    if (body.empty || from > 300) { await save({ status: "done", error: null }); return json({ ok: true, done: it.source }); }
    await save({ next_from: from + 10, chunks: it.chunks + (body.chunks ?? 0), error: null });
    return json({ ok: true, step: `pages ${from}-${from + 9}`, chunks: body.chunks });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 額度不足：保留進度，下次排程再試；其他錯誤記錄下來
    await save(/429/.test(msg) ? { error: msg.slice(0, 300) } : { status: "error", error: msg.slice(0, 300) });
    return json({ error: msg }, 500);
  }
}

async function list() {
  const { data, error } = await sb.from("kb_chunks").select("source, created_at");
  if (error) throw error;
  const map = new Map<string, { source: string; chunks: number; updated: string }>();
  for (const r of data ?? []) {
    const m = map.get(r.source) ?? { source: r.source, chunks: 0, updated: r.created_at };
    m.chunks++;
    if (r.created_at > m.updated) m.updated = r.created_at;
    map.set(r.source, m);
  }
  return json({ sources: [...map.values()] });
}

async function stats() {
  const { data, error } = await sb.from("chat_logs")
    .select("id, question, answer, status, resolved, top_score, created_at")
    .order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  const total = data?.length ?? 0;
  const gaps = (data ?? []).filter((r) => r.status !== "full" && !r.resolved);
  return json({ total, unanswered: gaps.length, recent: data, gaps });
}

async function resolveGap(id: number, resolved = true) {
  const { error } = await sb.from("chat_logs").update({ resolved }).eq("id", id);
  if (error) throw error;
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "請用 POST" }, 405);
  try {
    if (!GEMINI_KEY) return json({ error: "後端尚未設定 GEMINI_API_KEY" }, 500);
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "chat";
    if (action === "chat") return await chat(body.question, body.history);
    if (action === "process_queue") return await processQueue();

    if (!ADMIN_KEY || body.admin_key !== ADMIN_KEY) return json({ error: "管理密碼錯誤" }, 401);
    if (action === "ingest") return await ingest(body.source, body.text);
    if (action === "ingest_url") return await ingestUrl(body.url, body.source);
    if (action === "pdf_prepare") return await pdfPrepare(body.url);
    if (action === "pdf_part") return await pdfPart(body.fileUri, body.source, body.url, Number(body.from), Number(body.to));
    if (action === "list") return await list();
    if (action === "stats") return await stats();
    if (action === "resolve_gap") return await resolveGap(Number(body.id), body.resolved !== false);
    if (action === "delete") {
      const { error } = await sb.from("kb_chunks").delete().eq("source", body.source);
      if (error) throw error;
      return json({ ok: true });
    }
    return json({ error: "未知的 action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
