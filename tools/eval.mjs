// 正確率測試：30 題標準答案（都已對照官方文件原文，含雙語與防幻覺陷阱題），丟到線上網站問，檢查答案有沒有包含關鍵資訊。
// 用法（控制台按 7 即可自動執行，或 PowerShell：$env:ADMIN_KEY="管理密碼"; node tools/eval.mjs）
// 學生端每分鐘最多 8 題，所以每題間隔約 9 秒，全部跑完約 5 分鐘，只耗約 30 次免費額度。
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
  // ── 擴充 15 題（涵蓋 115 新知識包、行事曆、生活交通、獎助學金、雙語與防幻覺） ──
  { q: "新生健康檢查（體檢）前要空腹幾小時？衛保組電話是多少？", any: [["6", "六"], ["8", "八"], ["6252", "6253", "6254"]] },
  { q: "新生辦理兵役緩徵要找哪個單位？電話多少？", any: [["生活輔導組", "生輔組"], ["6225"]] },
  { q: "大一新生申請汽車和機車車證分別要多少錢？有什麼特別規定？", any: [["400"], ["免收費", "免費"], ["交通安全"]] },
  { q: "怎麼從志學火車站到東華大學？走路大概多久？", any: [["志學門", "後門"], ["10", "15"]] },
  { q: "宿舍網路（宿網）或單一簽入忘記密碼要找哪個單位？電話多少？", any: [["圖書資訊處", "圖資處"], ["6708"]] },
  { q: "東華大學轉系申請以幾次為原則？最多可以選填幾個志願？", any: [["一次", "1次", "1 次"], ["2", "兩"]] },
  { q: "開學後未逾學期三分之一辦理休學，學雜費會退還多少？", any: [["三分之二", "2/3"]] },
  { q: "大學部申請不利處境（弱勢）助學計畫的家庭年所得上限是多少？", any: [["90"]] },
  { q: "原住民學生獎學金（成績達 70 分以上）每學期補助多少錢？", any: [["32,000", "32000"]] },
  { q: "115 學年度大學申請入學第二階段網路報名及繳費時間是什麼時候？", any: [["4 月 23", "4月23", "04.23", "4/23"], ["5 月 5", "5月5", "05.05", "5/5"]] },
  { q: "115 學年度住校新生什麼時候入宿報到？", any: [["9 月 1", "9月1", "9/1", "09/01"]] },
  { q: "115 學年度新生網路選課是什麼時候？", any: [["9 月 2", "9月2", "9/2", "09/02"]] },
  { q: "東華大學修讀五年一貫（3+2 學碩一貫）有什麼好處或規定？", any: [["學", "碩"], ["五年", "5年", "3+2"]] },
  { q: "東華大學校內有麥當勞嗎？", noFabricate: true },
  { q: "When is the deadline to upload freshman registration documents?", any: [["August 27", "Aug 27", "8/27", "8月27", "8 月 27"]] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NO_DATA = /沒有(這方面|相關|這項|關於|提供|記載|紀錄)|還沒有|並未(明確)?(列出|記載|提供)|doesn't have|not (have|available)/;

async function ask(q) {
  for (let i = 0; i < 3; i++) {
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
      if (r.status === 503 && i < 2) { await sleep(6_000); continue; }
      return `（錯誤 ${r.status}：${d.error ?? ""}）`;
    } catch (e) {
      if (i === 2) return `（逾時或連線失敗：${e.message}）`;
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
