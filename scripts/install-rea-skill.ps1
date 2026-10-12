param([string]$InstallDirectory = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$source = Join-Path $InstallDirectory 'config\skills\reverse-engineer-anything'
if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md'))) { throw 'Bundled REA skill is missing.' }
$settings = Get-Content -Raw -LiteralPath (Join-Path $InstallDirectory 'data\settings.json') | ConvertFrom-Json
$distribution = $settings.wslDistribution
$linuxHome = $settings.wslLinuxHome
if (-not $distribution -or $distribution -match '[\\/]' -or -not $linuxHome.StartsWith('/') -or $linuxHome -match '(^|/)\.\.(/|$)') { throw 'Invalid WSL settings; REA skill was not installed.' }
$destinationRoot = Join-Path "\\wsl.localhost\$distribution" (($linuxHome.TrimStart('/') -replace '/', '\') + '\.config\opencode\skills')
$destination = Join-Path $destinationRoot 'reverse-engineer-anything'
if (Test-Path -LiteralPath $destination) { Write-Output 'REA skill already exists; preserved without overwrite.'; return }
New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $destinationRoot -Recurse
if (-not (Test-Path -LiteralPath (Join-Path $destination 'SKILL.md'))) { throw 'REA skill copy could not be verified.' }
Write-Output "REA skill installed: $destination"
