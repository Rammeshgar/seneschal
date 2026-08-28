[CmdletBinding()]
param(
  [string]$WslDistribution = 'Ubuntu',
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Seneschal')
)

$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot

if ($env:OS -ne 'Windows_NT') { throw 'Seneschal currently supports Windows only.' }
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js 20 or newer is required: https://nodejs.org/' }
$nodeMajor = [int]((& node.exe --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw 'Node.js 20 or newer is required: https://nodejs.org/' }
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw 'WSL is required. Install it from Windows Features or run: wsl --install' }

$distributions = @(& wsl.exe --list --quiet | ForEach-Object { $_.Trim([char]0).Trim() } | Where-Object { $_ })
if ($WslDistribution -notin $distributions) {
  throw "WSL distribution '$WslDistribution' was not found. Available: $($distributions -join ', ')"
}

$linuxHome = (& wsl.exe -d $WslDistribution -- sh -lc 'printf %s "$HOME"').Trim()
if (-not $linuxHome.StartsWith('/')) { throw "Could not determine the home folder in $WslDistribution." }
$openCodePath = (& wsl.exe -d $WslDistribution -- sh -lc 'command -v opencode || true').Trim()
if (-not $openCodePath) { throw 'OpenCode is not installed in this WSL distribution. Install it first: https://opencode.ai/docs/' }

New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null
foreach ($folder in @('app', 'config', 'docs', 'scripts', 'tests')) {
  $from = Join-Path $source $folder
  if (Test-Path -LiteralPath $from) {
    $to = Join-Path $InstallDirectory $folder
    New-Item -ItemType Directory -Force -Path $to | Out-Null
    Copy-Item -Recurse -Force -Path (Join-Path $from '*') -Destination $to
  }
}
foreach ($file in @('server.js', 'package.json', 'LICENSE', 'NOTICE.md', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md')) {
  $from = Join-Path $source $file
  if (Test-Path -LiteralPath $from) { Copy-Item -Force -LiteralPath $from -Destination $InstallDirectory }
}

$data = Join-Path $InstallDirectory 'data'
New-Item -ItemType Directory -Force -Path $data | Out-Null
$settingsPath = Join-Path $data 'settings.json'
$settings = if (Test-Path -LiteralPath $settingsPath) { Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json -AsHashtable } else { @{} }
$settings.wslDistribution = $WslDistribution
$settings.wslLinuxHome = $linuxHome
$settings.launchDirectory = "$linuxHome/projects"
$settings | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath $settingsPath

$homeParts = $linuxHome.TrimStart('/').Split('/')
$wslHome = Join-Path "\\wsl.localhost\$WslDistribution" ($homeParts -join '\')
$openCodeConfig = Join-Path $wslHome '.config\opencode'
New-Item -ItemType Directory -Force -Path $openCodeConfig | Out-Null
foreach ($file in @('AGENTS.md', 'GENERAL.md')) {
  $target = Join-Path $openCodeConfig $file
  if (-not (Test-Path -LiteralPath $target)) { Copy-Item -LiteralPath (Join-Path $source "config\$file") -Destination $target }
}
$openCodeJson = Join-Path $openCodeConfig 'opencode.json'
if (-not (Test-Path -LiteralPath $openCodeJson)) {
  Copy-Item -LiteralPath (Join-Path $source 'config\opencode.template.json') -Destination $openCodeJson
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Seneschal.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + (Join-Path $InstallDirectory 'scripts\launch.vbs') + '"'
$shortcut.WorkingDirectory = $InstallDirectory
$shortcut.IconLocation = (Join-Path $InstallDirectory 'app\favicon.ico') + ',0'
$shortcut.Description = 'Open Seneschal'
$shortcut.Save()

Write-Host ''
Write-Host 'Seneschal is installed.' -ForegroundColor Green
Write-Host "Location: $InstallDirectory"
Write-Host "Desktop shortcut: $shortcutPath"
Write-Host 'Your existing OpenCode configuration was preserved.'
Write-Host 'Open the app from the Seneschal desktop shortcut.'
