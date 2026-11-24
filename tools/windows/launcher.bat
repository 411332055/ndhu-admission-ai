@echo off
chcp 65001 >nul
title 東華入學 AI 助理｜控制台
cd /d "%~dp0..\.."

:menu
cls
echo ======================================
echo     東華入學 AI 助理｜控制台
echo ======================================
echo.
echo   1. 用 Antigravity 開啟專案（先下載最新版）
echo   2. 一鍵部署（網頁＋後端）
echo.
echo   3. 開啟學生端網站
echo   4. 開啟行政人員端
echo   5. 開啟管理後台
echo   6. 開啟 Supabase 控制台
echo.
echo   0. 離開
echo.
choice /c 1234560 /n /m "請按數字鍵選擇："
if errorlevel 7 exit /b 0
if errorlevel 6 (start "" "https://supabase.com/dashboard/project/krbrxahyebnvjnxievjb" & goto menu)
if errorlevel 5 (start "" "https://411332055.github.io/ndhu-admission-ai/admin.html" & goto menu)
if errorlevel 4 (start "" "https://411332055.github.io/ndhu-admission-ai/staff.html" & goto menu)
if errorlevel 3 (start "" "https://411332055.github.io/ndhu-admission-ai/" & goto menu)
if errorlevel 2 (call "%~dp0deploy.bat" & goto menu)
if errorlevel 1 (call "%~dp0open-project.bat" & goto menu)
goto menu
