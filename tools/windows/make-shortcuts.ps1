# 在桌面建立「開啟專案」與「一鍵部署」兩個捷徑
$here = $PSScriptRoot
$repo = Split-Path -Parent (Split-Path -Parent $here)
$desk = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell

function New-Link($name, $target, $icon) {
  $lnk = $ws.CreateShortcut((Join-Path $desk "$name.lnk"))
  $lnk.TargetPath = $target
  $lnk.WorkingDirectory = $repo
  $lnk.IconLocation = $icon
  $lnk.Save()
}

$ag = Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe'
$openIcon = if (Test-Path $ag) { "$ag,0" } else { "$env:SystemRoot\System32\shell32.dll,3" }
New-Link '入學AI助理｜開啟專案' (Join-Path $here 'open-project.bat') $openIcon
New-Link '入學AI助理｜一鍵部署' (Join-Path $here 'deploy.bat') "$env:SystemRoot\System32\shell32.dll,238"
Write-Host "已在桌面建立兩個捷徑。專案位置：$repo"
