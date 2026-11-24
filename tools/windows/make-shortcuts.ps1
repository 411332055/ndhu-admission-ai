# 在桌面建立「入學AI助理」控制台捷徑（並移除舊的兩個捷徑）
$here = $PSScriptRoot
$repo = Split-Path -Parent (Split-Path -Parent $here)
$desk = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell

foreach ($old in '入學AI助理｜開啟專案', '入學AI助理｜一鍵部署') {
  $p = Join-Path $desk "$old.lnk"
  if (Test-Path $p) { Remove-Item $p }
}

$ag = Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'
$icon = if (Test-Path $ag) { "$ag,0" } else { "$env:SystemRoot\System32\shell32.dll,3" }
$lnk = $ws.CreateShortcut((Join-Path $desk '入學AI助理.lnk'))
$lnk.TargetPath = Join-Path $here 'launcher.bat'
$lnk.WorkingDirectory = $repo
$lnk.IconLocation = $icon
$lnk.Save()
Write-Host "已在桌面建立「入學AI助理」捷徑。專案位置：$repo"
