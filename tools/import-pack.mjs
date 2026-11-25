// 一鍵匯入 115 學年度漏網官方知識包（tools/kb_pack_115.json）＋ 115 校務行事曆線上版
// 用法（控制台按 8 即可自動執行，或 PowerShell：$env:ADMIN_KEY="管理密碼"; node tools/import-pack.mjs）
// 特色：自動限速（每份間隔 1.5 秒）、只消耗約 25 次免費向量額度，安全不觸發 429。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const URL = "https://krbrxahyebnvjnxievjb.supabase.co/functions/v1/chat";
const KEY = process.env.ADMIN_KEY;
if (!KEY) {
  console.error('請先設定管理密碼（或直接用桌面控制台按 8 執行）');
  process.exit(1);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const pack = JSON.parse(readFileSync(join(HERE, "kb_pack_115.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(body) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://411332055.github.io" },
    body: JSON.stringify({ ...body, admin_key: KEY }),
    signal: AbortSignal.timeout(90_000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

console.log(`準備匯入 ${pack.length} 份官方知識文件（＋ 115 校務行事曆線上版）…\n`);
let ok = 0, fail = 0;

for (const [i, item] of pack.entries()) {
  try {
    const res = await post({
      action: "ingest",
      source: item.source,
      text: item.text,
      audience: item.audience || "public",
    });
    ok++;
    console.log(`✅ [${i + 1}/${pack.length}] ${item.source}（${res.chunks} 段）`);
  } catch (e) {
    fail++;
    console.log(`❌ [${i + 1}/${pack.length}] ${item.source}：${e.message}`);
  }
  await sleep(1500);
}

// 順便更新 115 學年度線上校務行事曆
try {
  const res = await post({
    action: "ingest_url",
    url: "https://sys.ndhu.edu.tw/AA/calendar/?yd=115",
    source: "115學年度國立東華大學校務行事曆（線上版）",
    audience: "public",
  });
  ok++;
  console.log(`✅ [行事曆] ${res.source}（${res.chunks} 段）`);
} catch (e) {
  fail++;
  console.log(`❌ [行事曆] 匯入失敗：${e.message}`);
}

console.log(`\n全部完成：成功 ${ok} 份、失敗 ${fail} 份！`);
