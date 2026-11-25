// 瀏覽器測試：用假的後端在模擬手機上把三個頁面跑一遍。
// 不會連到 Supabase 或 Gemini，不會用掉任何免費額度。每次推送 GitHub 會自動跑。
// 本機執行：npm i --no-save playwright && npx playwright install chromium && node tools/test/browser-test.mjs
import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png" };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = join(DOCS, p === "/" ? "index.html" : p);
  if (!f.startsWith(DOCS) || !existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" }).end(readFileSync(f));
}).listen(0);
const BASE = `http://localhost:${server.address().port}/`;

// ---- 假後端：照真的後端（supabase/functions/chat）的回應格式 ----
let mode = "ok"; // ok：正常串流回答；down：連不上
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
function fakeBackend(route) {
  if (mode === "down") return route.abort("internetdisconnected");
  const body = JSON.parse(route.request().postData() || "{}");
  const json = (o, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(o) });
  switch (body.action) {
    case "chat":
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse([
          { type: "delta", text: "新生報到要準備：\n- 身分證\n" },
          { type: "delta", text: "- 畢業證書影本\n【完整】" },
          { type: "done", answer: "新生報到要準備：\n- 身分證\n- 畢業證書影本", sources: ["115 新生註冊須知"], images: [], log_id: 1 },
        ]),
      });
    case "feedback":
    case "staff_login":
      return json({ ok: true });
    case "top_questions":
      return json({ items: [] });
    default:
      return json({ ok: true, items: [], sources: [] });
  }
}

let failed = 0;
const ok = (m) => console.log("✅ " + m);
const fail = (m) => {
  failed++;
  console.log("❌ " + m);
};

const browser = await chromium.launch();
async function phone({ theme = "light", width = 390, device } = {}) {
  const ctx = await browser.newContext(
    device ? { ...devices[device], colorScheme: theme } : { viewport: { width, height: 844 }, isMobile: true, hasTouch: true, colorScheme: theme },
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/supabase\.co\/functions/, fakeBackend);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ body: "" }));
  return { ctx, page, errors };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

// 1. 三個頁面在淺色、深色、窄螢幕都能打開，沒有程式錯誤、沒有左右超出畫面
for (const [theme, width] of [["light", 390], ["dark", 390], ["light", 360]]) {
  const bad = [];
  for (const pg of ["index.html", "staff.html", "admin.html"]) {
    const { ctx, page, errors } = await phone({ theme, width });
    await page.goto(BASE + pg);
    await page.waitForTimeout(500);
    const o = await overflow(page);
    if (o > 1) bad.push(`${pg} 超出 ${o}px`);
    if (errors.length) bad.push(`${pg} 程式錯誤：${errors.join(" | ")}`);
    await ctx.close();
  }
  bad.length ? fail(`${theme} ${width}px：${bad.join("、")}`) : ok(`${theme === "dark" ? "深色" : "淺色"} ${width}px：三個頁面都正常`);
}

// 2. 學生端問問題：串流回答、資料來源、回饋按鈕
{
  const { ctx, page, errors } = await phone({ device: "iPhone 13" });
  await page.goto(BASE + "index.html");
  await page.fill("#q", "新生報到要準備什麼？");
  await page.click("#send");
  await page.waitForSelector(".msg.bot .sources", { timeout: 5000 }).catch(() => {});
  const r = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".msg.bot .bubble")].pop();
    return { text: b?.textContent || "", src: !!b?.querySelector(".sources"), fb: !!b?.querySelector(".fb button[data-v]") };
  });
  r.text.includes("畢業證書") && r.src && r.fb && !/【完整】/.test(r.text)
    ? ok("學生端問答：回答、資料來源、回饋按鈕都正常，【完整】標記有被拿掉")
    : fail("學生端問答不正常：" + JSON.stringify(r));

  // 3. 斷網：顯示中文說明和「再問一次」，恢復後按一次就能問到
  mode = "down";
  await page.fill("#q", "學雜費可以怎麼繳？");
  await page.click("#send");
  await page.waitForSelector(".retry-btn", { timeout: 5000 }).catch(() => {});
  const err = await page.evaluate(() => [...document.querySelectorAll(".msg.bot .bubble")].pop()?.textContent || "");
  if (!/再問一次/.test(err) || /Failed to fetch|TypeError/.test(err)) fail("斷網時沒有顯示中文說明：" + err.slice(0, 60));
  else {
    mode = "ok";
    const before = await page.$$eval(".msg", (m) => m.length);
    await page.click(".retry-btn");
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => ({
      n: document.querySelectorAll(".msg").length,
      last: [...document.querySelectorAll(".msg.bot .bubble")].pop()?.textContent || "",
      users: [...document.querySelectorAll(".msg.user")].filter((u) => u.textContent.includes("學雜費")).length,
    }));
    after.last.includes("畢業證書") && after.n === before && after.users === 1
      ? ok("斷網時顯示中文說明，按「再問一次」能重新回答，而且不會重複出現同一個問題")
      : fail("再問一次不正常：" + JSON.stringify(after));
  }

  // 4. iPhone：輸入框字體至少 16px，點下去畫面才不會自動放大
  const fs = await page.$eval("#q", (e) => parseFloat(getComputedStyle(e).fontSize));
  fs >= 16 ? ok(`iPhone 輸入框字體 ${fs}px，不會自動放大畫面`) : fail(`iPhone 輸入框字體只有 ${fs}px，點下去畫面會放大`);
  if (errors.length) fail("學生端操作過程有程式錯誤：" + errors.join(" | "));
  await ctx.close();
}

// 5. 行政人員端：登入後能問問題（假後端，測試用密碼）
{
  const { ctx, page, errors } = await phone({ device: "Galaxy S9+" });
  await page.goto(BASE + "staff.html");
  const keyInput = await page.$("#loginPane input[type=password]");
  if (!keyInput) fail("行政人員端找不到登入框");
  else {
    await keyInput.fill("test-only-key");
    await keyInput.press("Enter");
    const inApp = await page
      .waitForFunction(() => !document.getElementById("app").hidden, null, { timeout: 5000 })
      .then(() => true, () => false);
    if (!inApp) fail("行政人員端登入後沒有進到主畫面");
    else {
      await page.fill("#q", "轉學生學分抵免怎麼處理？");
      await page.click("#send");
      await page.waitForSelector(".msg.bot .sources", { timeout: 5000 }).catch(() => {});
      const t = await page.evaluate(() => [...document.querySelectorAll(".msg.bot .bubble")].pop()?.textContent || "");
      t.includes("畢業證書") ? ok("行政人員端：登入、問答都正常") : fail("行政人員端問答不正常：" + t.slice(0, 60));
    }
  }
  if (errors.length) fail("行政人員端有程式錯誤：" + errors.join(" | "));
  await ctx.close();
}

await browser.close();
server.close();
if (failed) {
  console.log(`\n有 ${failed} 項沒通過`);
  process.exit(1);
}
console.log("\n瀏覽器測試全部通過");
