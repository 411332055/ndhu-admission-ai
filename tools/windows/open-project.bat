@echo off
chcp 65001 >nul
title 入學 AI 助理｜開啟專案
cd /d "%~dp0..\.."
echo 正在下載最新版本...
git pull --ff-only
if errorlevel 1 echo （下載最新版本失敗，可能是本機有還沒上傳的修改；先照常開啟專案）

where antigravity >nul 2>nul && (start "" antigravity "%CD%" & exit /b 0)
set "AG=%LOCALAPPDATA%\Programs\Antigravity\bin\antigravity.cmd"
if exist "%AG%" (start "" "%AG%" "%CD%" & exit /b 0)
set "AGEXE=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
if exist "%AGEXE%" (start "" "%AGEXE%" "%CD%" & exit /b 0)

echo.
echo 找不到 Antigravity。請先安裝：https://antigravity.google
echo 安裝好後再點一次這個捷徑。
pause
