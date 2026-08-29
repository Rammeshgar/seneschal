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

function Invoke-WslText {
  param(
    [Parameter(Mandatory = $true)][string[]]$WslArguments,
    [Parameter(Mandatory = $true)][string]$Operation,
    [switch]$AllowEmpty
  )

  $result = @(& wsl.exe @WslArguments 2>&1)
  $exitCode = $LASTEXITCODE
  $text = (($result | ForEach-Object { [string]$_ }) -join "`n").Replace([string][char]0, '').Trim()
  if ($exitCode -ne 0) {
    $detail = if ($text) { $text } else { "WSL exited with code $exitCode and returned no details." }
    throw "Could not $Operation. $detail Restart WSL, then run this installer again."
  }
  if (-not $AllowEmpty -and [string]::IsNullOrWhiteSpace($text)) {
    throw "Could not $Operation because WSL returned no information. Restart WSL, then run this installer again."
  }
  return $text
}

$distributionText = Invoke-WslText -WslArguments @('--list', '--quiet') -Operation 'list WSL distributions'
$distributions = @($distributionText -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($WslDistribution -notin $distributions) {
  throw "WSL distribution '$WslDistribution' was not found. Available: $($distributions -join ', ')"
}

$linuxHome = Invoke-WslText -WslArguments @('-d', $WslDistribution, '--', 'sh', '-lc', 'printf %s "$HOME"') -Operation "read the home folder from $WslDistribution"
if (-not $linuxHome.StartsWith('/')) { throw "Could not determine the home folder in $WslDistribution." }
$openCodePath = Invoke-WslText -WslArguments @('-d', $WslDistribution, '--', 'bash', '-ic', 'command -v opencode || true') -Operation "find OpenCode in $WslDistribution" -AllowEmpty
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
$legacyInstall = Join-Path $env:LOCALAPPDATA 'OpenCodeAtelier'
$legacyData = Join-Path $legacyInstall 'data'
if ((Test-Path -LiteralPath $legacyData) -and ($legacyData -ne $data)) {
  foreach ($legacyItem in @('instructions', 'instruction-backups', 'settings.json')) {
    $from = Join-Path $legacyData $legacyItem
    $to = Join-Path $data $legacyItem
    if ((Test-Path -LiteralPath $from) -and -not (Test-Path -LiteralPath $to)) {
      Copy-Item -Recurse -Force -LiteralPath $from -Destination $to
    }
  }
}

$legacyBrowserRuntime = Join-Path $legacyInstall 'browser-runtime'
$browserRuntime = Join-Path $InstallDirectory 'browser-runtime'
if ((Test-Path -LiteralPath $legacyBrowserRuntime) -and -not (Test-Path -LiteralPath $browserRuntime)) {
  Copy-Item -Recurse -Force -LiteralPath $legacyBrowserRuntime -Destination $browserRuntime
}
$browserLauncherSource = Join-Path $source 'scripts\start-playwright-mcp.cmd'
$browserLauncher = Join-Path $browserRuntime 'start-playwright-mcp.cmd'
if ((Test-Path -LiteralPath $browserRuntime) -and (Test-Path -LiteralPath $browserLauncherSource)) {
  Copy-Item -Force -LiteralPath $browserLauncherSource -Destination $browserLauncher
}
$legacyBlenderLauncher = Join-Path $legacyInstall 'scripts\start-blender-mcp.cmd'
$blenderLauncher = Join-Path $InstallDirectory 'scripts\start-blender-mcp.cmd'
if ((Test-Path -LiteralPath $legacyBlenderLauncher) -and -not (Test-Path -LiteralPath $blenderLauncher)) {
  Copy-Item -Force -LiteralPath $legacyBlenderLauncher -Destination $blenderLauncher
}
foreach ($legacyArchive in @('browser-artifacts', 'instruction-update-backup-20260815-123201')) {
  $from = Join-Path $legacyData $legacyArchive
  $to = Join-Path $data "legacy-$legacyArchive"
  if ((Test-Path -LiteralPath $from) -and -not (Test-Path -LiteralPath $to)) {
    Copy-Item -Recurse -Force -LiteralPath $from -Destination $to
  }
}
$settingsPath = Join-Path $data 'settings.json'
$settings = @{}
if (Test-Path -LiteralPath $settingsPath) {
  try {
    $parsedSettings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
    if ($parsedSettings) {
      foreach ($property in $parsedSettings.PSObject.Properties) { $settings[$property.Name] = $property.Value }
    }
  } catch {
    Copy-Item -Force -LiteralPath $settingsPath -Destination "$settingsPath.invalid-backup"
  }
}
$settings['wslDistribution'] = $WslDistribution
$settings['wslLinuxHome'] = $linuxHome
$settings['launchDirectory'] = "$linuxHome/projects"
$settings | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath $settingsPath

$homeParts = $linuxHome.TrimStart('/').Split('/')
$wslHome = Join-Path "\\wsl.localhost\$WslDistribution" ($homeParts -join '\')
$openCodeConfig = Join-Path $wslHome '.config\opencode'
New-Item -ItemType Directory -Force -Path $openCodeConfig | Out-Null
foreach ($file in @('AGENTS.md', 'GENERAL.md')) {
  $target = Join-Path $openCodeConfig $file
  $sourceConfig = Join-Path $source "config\$file"
  if (-not (Test-Path -LiteralPath $target)) {
    Copy-Item -LiteralPath $sourceConfig -Destination $target
  } elseif ($file -eq 'AGENTS.md') {
    $existingAgent = Get-Content -Raw -LiteralPath $target
    if ($existingAgent -match '(?im)^# Digital Servant\s*$|You are Digital Servant') {
      $backup = Join-Path $openCodeConfig 'AGENTS.before-seneschal.md'
      if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $target -Destination $backup }
      Copy-Item -Force -LiteralPath $sourceConfig -Destination $target
    }
  }
}
$openCodeJson = Join-Path $openCodeConfig 'opencode.json'
if (-not (Test-Path -LiteralPath $openCodeJson)) {
  Copy-Item -LiteralPath (Join-Path $source 'config\opencode.template.json') -Destination $openCodeJson
}
if (Test-Path -LiteralPath $openCodeJson) {
  $openCodeText = Get-Content -Raw -LiteralPath $openCodeJson
  $legacyForward = $legacyInstall.Replace('\', '/')
  $installForward = $InstallDirectory.Replace('\', '/')
  $updatedOpenCodeText = $openCodeText.Replace($legacyForward, $installForward).Replace('Digital Servant planning mode', 'Seneschal planning mode').Replace('Digital Servant build mode', 'Seneschal build mode')
  if ($updatedOpenCodeText -ne $openCodeText) {
    Copy-Item -Force -LiteralPath $openCodeJson -Destination "$openCodeJson.before-seneschal"
    $updatedOpenCodeText | Set-Content -Encoding utf8 -LiteralPath $openCodeJson
  }
  try { Get-Content -Raw -LiteralPath $openCodeJson | ConvertFrom-Json | Out-Null } catch { throw "The migrated OpenCode configuration is not valid JSON. The backup is at $openCodeJson.before-seneschal" }
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Seneschal.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $InstallDirectory 'scripts\launch.ps1') + '"'
$shortcut.WorkingDirectory = $InstallDirectory
$shortcut.IconLocation = (Join-Path $InstallDirectory 'app\favicon.ico') + ',0'
$shortcut.Description = 'Open Seneschal'
$shortcut.Save()

$migrationVerified = $true
if ((Test-Path -LiteralPath $legacyBrowserRuntime) -and -not (Test-Path -LiteralPath (Join-Path $browserRuntime 'start-playwright-mcp.cmd'))) { $migrationVerified = $false }
if ((Test-Path -LiteralPath $legacyBlenderLauncher) -and -not (Test-Path -LiteralPath $blenderLauncher)) { $migrationVerified = $false }
if ((Test-Path -LiteralPath $openCodeJson) -and ((Get-Content -Raw -LiteralPath $openCodeJson).Contains($legacyInstall.Replace('\', '/')))) { $migrationVerified = $false }

if ($migrationVerified) {
  foreach ($obsoleteDesktopItem in @(
    'Digital Servant.lnk',
    'Open AI Workspace.lnk',
    'Seneschal v0.2.1 Beta',
    'Seneschal v0.2.1 Beta 2',
    'Seneschal v0.2.1 Beta 3',
    'Seneschal v0.2.1 Beta 4',
    'Seneschal v0.2.1 Beta 5',
    'Seneschal v0.2.1 Beta 6',
    'Seneschal v0.2.1 Beta 7',
    'seneschal-v0.2.0-beta.1.zip',
    'seneschal-v0.2.1-beta.1.zip',
    'seneschal-v0.2.1-beta.2.zip',
    'seneschal-v0.2.1-beta.3.zip',
    'seneschal-v0.2.1-beta.4.zip',
    'seneschal-v0.2.1-beta.5.zip',
    'seneschal-v0.2.1-beta.6.zip',
    'seneschal-v0.2.1-beta.7.zip',
    'seneschal-v0.2.1-beta.8.zip'
  )) {
    $obsoletePath = Join-Path $desktop $obsoleteDesktopItem
    if (Test-Path -LiteralPath $obsoletePath) { Remove-Item -Recurse -Force -LiteralPath $obsoletePath }
  }
  if ((Test-Path -LiteralPath $legacyInstall) -and ($legacyInstall -ne $InstallDirectory)) {
    try { Remove-Item -Recurse -Force -LiteralPath $legacyInstall } catch { Write-Warning "The legacy installation is still in use and could not be removed: $legacyInstall" }
  }
}

Write-Host ''
Write-Host 'Seneschal is installed.' -ForegroundColor Green
Write-Host "Location: $InstallDirectory"
Write-Host "Desktop shortcut: $shortcutPath"
Write-Host 'Your local instructions and compatible OpenCode configuration were preserved.'
Write-Host 'Legacy Digital Servant agent text was backed up and migrated to Seneschal when detected.'
if ($migrationVerified) { Write-Host 'Legacy Browser/Blender paths were migrated and obsolete Desktop material was removed.' }
Write-Host 'Open the app from the Seneschal desktop shortcut.'
