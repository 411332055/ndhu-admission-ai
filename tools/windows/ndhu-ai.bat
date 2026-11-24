@echo off
rem NDHU admission AI assistant - all-in-one launcher (keep this file ASCII only)
set "DIR=%USERPROFILE%\Projects\ndhu-admission-ai"
if exist "%DIR%\.git" goto run

where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed. Opening the download page...
  echo Install Git with all default options, then run this file again.
  start "" "https://git-scm.com/download/win"
  pause
  exit /b 1
)
echo First run: downloading the project to %DIR% ...
if not exist "%USERPROFILE%\Projects" mkdir "%USERPROFILE%\Projects"
git clone https://github.com/411332055/ndhu-admission-ai.git "%DIR%"
if errorlevel 1 (
  echo Download failed. If GitHub asks you to sign in, use the school account 411332055.
  pause
  exit /b 1
)

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%DIR%\tools\windows\launcher.ps1"
