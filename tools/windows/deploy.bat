@echo off
chcp 65001 >nul
title 入學 AI 助理｜一鍵部署
cd /d "%~dp0..\.."

echo [1/3] 下載遠端最新版本
git pull --rebase --autostash
if errorlevel 1 goto fail

echo.
echo [2/3] 上傳網頁到 GitHub Pages
git add -A
git diff --cached --quiet
if errorlevel 1 git commit -m "更新 %date% %time:~0,5%"
git push
if errorlevel 1 goto fail

echo.
echo [3/3] 部署後端到 Supabase
where npx >nul 2>nul
if errorlevel 1 (
  echo 需要先安裝 Node.js：https://nodejs.org （選 LTS 版本），裝好後再點一次。
  start https://nodejs.org
  goto fail
)
call npx -y supabase functions deploy chat --project-ref krbrxahyebnvjnxievjb --no-verify-jwt --use-api
if errorlevel 1 (
  echo.
  echo 第一次使用要先登入 Supabase，等一下瀏覽器會打開，登入後回到這個視窗。
  call npx -y supabase login
  if errorlevel 1 goto fail
  call npx -y supabase functions deploy chat --project-ref krbrxahyebnvjnxievjb --no-verify-jwt --use-api
  if errorlevel 1 goto fail
)

echo.
echo 完成！網頁約 1 分鐘後更新：https://411332055.github.io/ndhu-admission-ai/
pause
exit /b 0

:fail
echo.
echo 發生錯誤。請把這個視窗截圖貼給 AI（Claude 或 Antigravity）處理。
pause
exit /b 1
