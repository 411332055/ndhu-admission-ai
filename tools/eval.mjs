// 正確率測試：15 題標準答案（都已對照官方文件原文），丟到線上網站問，檢查答案有沒有包含關鍵資訊。
// 用法（Windows PowerShell）：$env:ADMIN_KEY="管理密碼"; node tools/eval.mjs
// 控制台按 7 會自動幫你執行。學生端每分鐘最多 8 題，所以每題間隔約 9 秒，全部跑完約 3 分鐘。
// 測試紀錄會標成 test，不會算進後台統計與 Top 10；結果會存進後台「系統狀態」。

const URL = "https://krbrxahyebnvjnxievjb.supabase.co/functions/v1/chat";
const KEY = process.env.ADMIN_KEY;
if (!KEY) {
  console.error("請先設定管理密碼：$env:ADMIN_KEY=\"你的管理密碼\"");
  process.exit(1);
}

// any：每一組至少要出現其中一個詞；全部組都有＝完全正確，一半以上＝部分正確
// noFabricate：知識庫沒有的題目，答案必須說沒有資料（不能編造）
const CASES = [
  { q: "學雜費繳費單什麼時候可以下載？去哪裡下載？", any: [["8月17日", "8 月 17 日", "8/17"], ["臺灣銀行", "台灣銀行", "學雜費入口網"]] },
  { q: "學雜費繳費單的代收類別代碼是多少？", any: [["111332"]] },
  { q: "什麼時候可以查詢註冊情形、列印在學證明？", any: [["9月7日", "9 月 7 日", "9/7"], ["電子學習履歷"]] },
  { q: "研究所新生宿舍申請時間是什麼時候？", any: [["8月3日", "8 月 3 日", "8/3"], ["8月16日", "8 月 16 日", "8/16"]] },
  { q: "學雜費沒有按時繳會怎麼樣？", any: [["愛校服務"], ["退學"], ["二週", "兩週", "2 週"]] },
  { q: "要申請延緩繳交學雜費，最晚什麼時候要提出？", any: [["9月7日", "9 月 7 日", "9/7", "註冊日前"]] },
  { q: "就學貸款要找哪個單位？電話多少？", any: [["生活輔導組"], ["6221"]] },
  { q: "學雜費減免審核通過之後要怎麼繳費？", any: [["減免後", "減免後繳費單"], ["臺灣銀行", "台灣銀行", "學雜費入口網"]] },
  { q: "新生報到資料最晚什麼時候要上傳？", any: [["8月27日", "8 月 27 日", "8/27"]] },
  { q: "企管系經營管理組申請入學招生名額幾名？第一階段看哪些科目？", any: [["18"], ["數學B", "數學 B"], ["國文"], ["英文"]] },
  { q: "宿舍保證金什麼時候退？", any: [["11 月", "11月", "十一月"], ["期中"]] },
  { q: "新生入學活動要問哪個單位？", any: [["課外活動組"], ["6232"]] },
  { q: "就學優待減免的承辦電話是多少？", any: [["6218"]] },
  { q: "東華大學學生餐廳幾點開？", noFabricate: true },
  { q: "英語能力畢業標準的檢定考試有哪些可以用？", any: [["600"], ["IELTS", "雅思"], ["GEPT", "全民英檢"], ["托福", "TOEFL"]] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NO_DATA = /沒有(這方面|相關|這項)|還沒有|doesn't have|not (have|available)/;

async function ask(q) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://411332055.github.io" },
        body: JSON.stringify({ action: "chat", question: q, test: true, admin_key: KEY }),
        signal: AbortSignal.timeout(90_000),
      });
      const d = await r.json();
      if (r.ok && d.answer) return d.answer;
      if (r.status === 429) { await sleep(20_000); continue; }
      return `（錯誤 ${r.status}：${d.error ?? ""}）`;
    } catch (e) {
      if (i === 1) return `（逾時或連線失敗：${e.message}）`;
      await sleep(5_000);
    }
  }
  return "（失敗）";
}

const details = [];
let passed = 0, partial = 0;
console.log(`開始測試 ${CASES.length} 題，約需 ${Math.ceil(CASES.length * 9 / 60)} 分鐘…\n`);
for (const [i, c] of CASES.entries()) {
  const ans = await ask(c.q);
  let result;
  if (c.noFabricate) {
    result = NO_DATA.test(ans) ? "pass" : "fail";
  } else {
    const hit = c.any.filter((group) => group.some((w) => ans.includes(w))).length;
    result = hit === c.any.length ? "pass" : hit * 2 >= c.any.length ? "partial" : "fail";
  }
  if (result === "pass") passed++;
  if (result === "partial") partial++;
  const mark = { pass: "✅ 正確", partial: "🟡 部分", fail: "❌ 錯誤" }[result];
  console.log(`${String(i + 1).padStart(2)}. ${mark}　${c.q}`);
  if (result !== "pass") console.log(`    AI 回答：${ans.replace(/\s+/g, " ").slice(0, 160)}…`);
  details.push({ q: c.q, result, answer: ans.slice(0, 400) });
  if (i < CASES.length - 1) await sleep(9_000);
}

const pct = Math.round((passed * 100) / CASES.length);
console.log(`\n結果：${CASES.length} 題中完全正確 ${passed} 題、部分正確 ${partial} 題（正確率 ${pct}%）`);

try {
  const r = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://411332055.github.io" },
    body: JSON.stringify({ action: "save_eval", admin_key: KEY, total: CASES.length, passed, partial, details }),
  });
  console.log(r.ok ? "已存進管理後台「系統狀態」。" : `存檔失敗（${r.status}）`);
} catch (e) {
  console.log("存檔失敗：" + e.message);
}
