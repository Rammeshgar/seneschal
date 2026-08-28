$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root 'data'
$settingsPath = Join-Path $data 'settings.json'
$settings = if (Test-Path -LiteralPath $settingsPath) { Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json } else { [pscustomobject]@{} }
$distribution = if ($settings.wslDistribution) { $settings.wslDistribution } else { 'Ubuntu' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$destination = Join-Path $data "backups\$stamp"
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$archive = Join-Path $destination 'opencode-config.tar.gz'
$wslArchive = (& wsl.exe -d $distribution -- wslpath -a -u $archive).Trim()
$safeArchive = $wslArchive.Replace("'", "'\"'\"'")
& wsl.exe -d $distribution -- sh -lc "test -d \"`$HOME/.config/opencode\" && tar -czf '$safeArchive' -C \"`$HOME/.config\" opencode || true"
Copy-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath (Join-Path $data 'instructions') -Destination $destination
Write-Host "Backup saved to $destination"
