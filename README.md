# 東華大學入學行政 AI 助理

國立東華大學「創新與知識管理」第十組專題：大學部入學行政知識管理與 AI 輔助系統。

- **問答頁**：`docs/index.html`（GitHub Pages）
- **知識庫管理頁**：`docs/admin.html`：上傳 PDF / Word / 文字，查看問答紀錄與知識缺口
- **後端**：Supabase Edge Function `chat`（`supabase/functions/chat/index.ts`）
- **資料庫**：Supabase Postgres + pgvector（`supabase/schema.sql`）
- **模型**：Gemini API（回答）＋ Gemini Embedding（向量檢索）

## 架構

```
使用者 ──► GitHub Pages（前端）
              │ POST
              ▼
      Supabase Edge Function ──► Gemini Embedding（問題轉向量）
              │                 ──► Gemini（根據檢索到的資料回答）
              ▼
      Supabase Postgres + pgvector
        ├─ kb_chunks：入學知識（段落＋向量）
        └─ chat_logs：問答紀錄（找出知識缺口）
```

## 部署

1. Supabase SQL Editor 執行 `supabase/schema.sql`
2. 部署 Edge Function `chat`（關閉 JWT 驗證），設定 Secrets：
   - `GEMINI_API_KEY`：Google AI Studio 申請
   - `ADMIN_KEY`：自訂管理密碼
3. 把 `docs/config.js` 的 `FUNCTION_URL` 換成 `https://<project-ref>.supabase.co/functions/v1/chat`
4. GitHub repo → Settings → Pages → Branch `main`、資料夾 `/docs`

## 自動檢查

每次推送到 GitHub 都會自動跑兩項檢查，在 GitHub 的提交旁邊看到綠色勾勾就是通過，紅色叉叉就是有東西壞了：

- `tools/check.js`：程式語法、版本號、有沒有不小心把密碼或 API 金鑰寫進程式。
- `tools/test/browser-test.mjs`：用假的後端在模擬手機上把三個頁面跑一遍（不會用到 Gemini 額度）。

## 注意

- Gemini API key 只存在 Supabase Secrets，不會出現在前端。
- Supabase 免費專案閒置一段時間會暫停，展示前先到後台確認。
