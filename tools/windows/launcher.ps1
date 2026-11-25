# 東華入學 AI 助理｜控制台（由 launcher.bat 或桌面捷徑啟動）
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = '東華入學 AI 助理｜控制台'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
git pull --ff-only --quiet 2>$null | Out-Null
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

function Find-Agy {
  # 重新讀取 PATH，剛安裝完的 agy 才找得到
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  $cmd = Get-Command agy -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in "$env:USERPROFILE\.local\bin\agy.exe", "$env:LOCALAPPDATA\Programs\agy\agy.exe") {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Open-Project {
  Show-Step '正在下載最新版本…'
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) { Write-Host '（下載最新版本失敗，可能是本機有還沒上傳的修改；先照常開啟）' -ForegroundColor Yellow }

  $agy = Find-Agy
  if (-not $agy) {
    Write-Host ''
    Write-Host '這台電腦還沒安裝 Antigravity CLI（agy）。' -ForegroundColor Yellow
    Write-Host '要現在用 Google 官方安裝指令安裝嗎？按 Y 安裝，其他鍵取消：' -NoNewline
    $ans = [Console]::ReadKey($true).KeyChar
    Write-Host $ans
    if ($ans -ne 'y' -and $ans -ne 'Y') { return }
    Invoke-RestMethod 'https://antigravity.google/cli/install.ps1' | Invoke-Expression
    $agy = Find-Agy
    if (-not $agy) {
      Write-Host '安裝完成但找不到 agy，請關掉這個視窗重新開啟一次。' -ForegroundColor Yellow
      return Show-Fail
    }
  }

  Clear-Host
  Write-Host "在 $repo 啟動 Antigravity CLI…" -ForegroundColor Green
  Write-Host '第一次會請你登入、並問要不要信任這個資料夾，選信任。離開 Antigravity 後會回到選單。' -ForegroundColor DarkGray
  Write-Host ''
  & $agy
  $Host.UI.RawUI.WindowTitle = '東華入學 AI 助理｜控制台'
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

function Invoke-Eval {
  Show-Step '正確率測試：15 題，約 3 分鐘（每分鐘最多 8 題，會自動放慢）'
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '需要先安裝 Node.js（選 LTS 版本）。' -ForegroundColor Yellow
    Start-Process 'https://nodejs.org'
    return Show-Fail
  }
  $sec = Read-Host '請輸入管理密碼（輸入時不會顯示）' -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  $env:ADMIN_KEY = $plain
  node tools/eval.mjs
  Remove-Item Env:ADMIN_KEY -ErrorAction SilentlyContinue
  Wait-Key
}

while ($true) {
  Clear-Host
  Write-Host '======================================' -ForegroundColor DarkGreen
  Write-Host '     東華入學 AI 助理｜控制台' -ForegroundColor Green
  Write-Host '======================================' -ForegroundColor DarkGreen
  Write-Host ''
  Write-Host '  1. 在這個視窗啟動 Antigravity（先下載最新版）'
  Write-Host '  2. 一鍵部署（網頁＋後端）'
  Write-Host ''
  Write-Host '  3. 開啟學生端網站'
  Write-Host '  4. 開啟行政人員端'
  Write-Host '  5. 開啟管理後台'
  Write-Host '  6. 開啟 Supabase 控制台'
  Write-Host '  7. 跑正確率測試（15 題）'
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
    '7' { Invoke-Eval }
    '0' { exit }
  }
}
