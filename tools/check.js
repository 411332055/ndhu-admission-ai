// 自動檢查：每次推送 GitHub 都會跑（.github/workflows/check.yml），本機也可以跑：node tools/check.js
// 檢查項目：程式語法、版本號、重複的 id、有沒有把密碼或 API 金鑰寫進程式。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
let failed = 0;
const ok = (m) => console.log("✅ " + m);
const fail = (m) => {
  failed++;
  console.log("❌ " + m);
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const PAGES = ["docs/index.html", "docs/staff.html", "docs/admin.html"];

// 1. 前端程式語法：共用的 js 檔，加上每個頁面裡的 <script>
{
  const bad = [];
  for (const f of ["docs/common.js", "docs/config.js"]) {
    try {
      new vm.Script(read(f), { filename: f });
    } catch (e) {
      bad.push(`${f}：${e.message}`);
    }
  }
  for (const f of PAGES) {
    [...read(f).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].forEach((m, i) => {
      try {
        new vm.Script(m[1], { filename: `${f} 第 ${i + 1} 段程式` });
      } catch (e) {
        bad.push(`${f} 第 ${i + 1} 段程式：${e.message}`);
      }
    });
  }
  bad.length ? fail("程式語法錯誤：" + bad.join("；")) : ok("前端程式語法正確");
}

// 2. 版本號：三個頁面引用 style.css、common.js、config.js 的 ?v= 要一樣
const vers = new Set();
for (const f of PAGES)
  for (const m of read(f).matchAll(/(?:style\.css|common\.js|config\.js)\?v=(\d+)/g)) vers.add(m[1]);
const ver = [...vers][0];
if (vers.size !== 1) fail(`版本號不一致：${[...vers].map((v) => "v" + v).join("、") || "找不到 ?v="}`);
else ok(`版本號一致（v${ver}）`);

// 3. 改了 style.css、common.js、config.js 卻沒加版本號（跟上一筆提交比），手機可能一直用舊的
try {
  const changed = execSync("git diff --name-only HEAD~1 HEAD", { cwd: ROOT, stdio: "pipe" }).toString().split("\n");
  const shared = ["docs/style.css", "docs/common.js", "docs/config.js"].filter((f) => changed.includes(f));
  if (shared.length) {
    const prev = (execSync("git show HEAD~1:docs/index.html", { cwd: ROOT, stdio: "pipe" }).toString().match(/style\.css\?v=(\d+)/) || [])[1];
    if (prev && prev === ver) fail(`這次改了 ${shared.join("、")}，但版本號還是 v${ver}，請把三個頁面的 ?v= 都加 1`);
    else ok("改了共用檔案，版本號也有加");
  }
} catch (e) {
  /* 第一筆提交或拿不到上一筆，就跳過 */
}

// 4. 同一個頁面裡 id 不能重複
{
  const dups = [];
  for (const f of PAGES) {
    const ids = [...read(f).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const d = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
    if (d.length) dups.push(`${f}：${d.join("、")}`);
  }
  dups.length ? fail("id 重複：" + dups.join("；")) : ok("頁面的 id 沒有重複");
}

// 5. 不能把密碼或金鑰寫進 repo（repo 是公開的）
{
  const files = execSync("git ls-files", { cwd: ROOT, stdio: "pipe" })
    .toString()
    .split("\n")
    .filter((f) => /\.(js|ts|mjs|html|css|md|sql|toml|json|ps1|bat|txt)$/.test(f));
  const RULES = [
    [/AIza[0-9A-Za-z_-]{35}/, "Google／Gemini API 金鑰"],
    [/sb_secret_[0-9A-Za-z_-]{20,}/, "Supabase secret key"],
    [/eyJ[0-9A-Za-z_-]{20,}\.eyJ[0-9A-Za-z_-]{40,}\.[0-9A-Za-z_-]{20,}/, "Supabase 金鑰（JWT）"],
    [/\b(ADMIN_KEY|STAFF_KEY|GEMINI_API_KEY)\s*[:=]\s*["'][^"'\s]{6,}["']/, "密碼"],
  ];
  const hits = [];
  for (const f of files) {
    if (f === "tools/check.js") continue;
    let t = "";
    try {
      t = read(f);
    } catch (e) {
      continue;
    }
    for (const [re, what] of RULES) if (re.test(t)) hits.push(`${f}（${what}）`);
  }
  hits.length ? fail("這些檔案好像寫了密碼或金鑰，請移除並到 Supabase Secrets 換一組新的：" + hits.join("、")) : ok("沒有把密碼或金鑰寫進程式");
}

// 6. 後端網址要指向 Supabase Edge Function
/functions\/v1\/chat/.test(read("docs/config.js")) ? ok("config.js 的後端網址格式正確") : fail("config.js 的 FUNCTION_URL 看起來不對");

if (failed) {
  console.log(`\n有 ${failed} 項沒通過`);
  process.exit(1);
}
console.log("\n全部通過");
