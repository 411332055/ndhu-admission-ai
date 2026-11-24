# 東華入學 AI 助理｜控制台（由 launcher.bat 或桌面捷徑啟動）
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = '東華入學 AI 助理｜控制台'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
$ref  = 'krbrxahyebnvjnxievjb'
$site = 'https://411332055.github.io/ndhu-admission-ai/'

function Wait-Key {
  Write-Host ''
  Write-Host '按任意鍵回到選單…' -ForegroundColor DarkGray
  [void][Console]::ReadKey($true)
}
function Show-Fail {
  Write-Host ''
  Write-Host '發生錯誤。請把這個視窗截圖貼給 AI（Claude 或 Antigravity）處理。' -ForegroundColor Red
  Wait-Key
}
function Show-Step($text) { Write-Host ''; Write-Host $text -ForegroundColor Cyan }

function Open-Project {
  Show-Step '正在下載最新版本…'
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) { Write-Host '（下載最新版本失敗，可能是本機有還沒上傳的修改；先照常開啟專案）' -ForegroundColor Yellow }
  $cmd = Get-Command antigravity -ErrorAction SilentlyContinue
  $paths = @(
    $(if ($cmd) { $cmd.Source }),
    "$env:LOCALAPPDATA\Programs\Antigravity\bin\antigravity.cmd",
    "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }
  if (-not $paths) {
    Write-Host '找不到 Antigravity，請先安裝：https://antigravity.google' -ForegroundColor Red
    Start-Process 'https://antigravity.google'
    Wait-Key
    return
  }
  $app = @($paths)[0]
  if ($app -like '*.cmd') { Start-Process -FilePath $app -ArgumentList "`"$repo`"" -WindowStyle Hidden }
  else { Start-Process -FilePath $app -ArgumentList "`"$repo`"" }
  Write-Host '已用 Antigravity 開啟專案。' -ForegroundColor Green
  Start-Sleep -Seconds 2
}

function Invoke-Deploy {
  Show-Step '[1/3] 下載遠端最新版本'
  git pull --rebase --autostash
  if ($LASTEXITCODE -ne 0) { return Show-Fail }

  Show-Step '[2/3] 上傳網頁到 GitHub Pages'
  git add -A
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { git commit -m ('更新 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')) }
  git push
  if ($LASTEXITCODE -ne 0) { return Show-Fail }

  Show-Step '[3/3] 部署後端到 Supabase'
  if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
    Write-Host '需要先安裝 Node.js（選 LTS 版本），裝好後再選一次「一鍵部署」。' -ForegroundColor Yellow
    Start-Process 'https://nodejs.org'
    return Show-Fail
  }
  npx.cmd -y supabase functions deploy chat --project-ref $ref --no-verify-jwt --use-api
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '需要登入 Supabase：按 Enter 後瀏覽器會打開，用個人帳號登入後回到這個視窗。' -ForegroundColor Yellow
    npx.cmd -y supabase login
    if ($LASTEXITCODE -ne 0) { return Show-Fail }
    npx.cmd -y supabase functions deploy chat --project-ref $ref --no-verify-jwt --use-api
    if ($LASTEXITCODE -ne 0) { return Show-Fail }
  }
  Write-Host ''
  Write-Host "完成！網頁約 1 分鐘後更新：$site" -ForegroundColor Green
  Wait-Key
}

while ($true) {
  Clear-Host
  Write-Host '======================================' -ForegroundColor DarkGreen
  Write-Host '     東華入學 AI 助理｜控制台' -ForegroundColor Green
  Write-Host '======================================' -ForegroundColor DarkGreen
  Write-Host ''
  Write-Host '  1. 用 Antigravity 開啟專案（先下載最新版）'
  Write-Host '  2. 一鍵部署（網頁＋後端）'
  Write-Host ''
  Write-Host '  3. 開啟學生端網站'
  Write-Host '  4. 開啟行政人員端'
  Write-Host '  5. 開啟管理後台'
  Write-Host '  6. 開啟 Supabase 控制台'
  Write-Host ''
  Write-Host '  0. 離開'
  Write-Host ''
  Write-Host '請按數字鍵選擇：' -NoNewline
  $key = [Console]::ReadKey($true).KeyChar
  Write-Host $key
  switch ($key) {
    '1' { Open-Project }
    '2' { Invoke-Deploy }
    '3' { Start-Process $site }
    '4' { Start-Process "${site}staff.html" }
    '5' { Start-Process "${site}admin.html" }
    '6' { Start-Process "https://supabase.com/dashboard/project/$ref" }
    '0' { exit }
  }
}
