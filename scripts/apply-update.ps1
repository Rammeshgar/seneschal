param([Parameter(Mandatory=$true)][string]$Root, [Parameter(Mandatory=$true)][string]$Archive, [int]$ServerPID)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$Archive = [IO.Path]::GetFullPath($Archive)
if (-not $Archive.StartsWith(($Root + '\data\update-'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid staging directory' }
$stage = Split-Path -Parent $Archive
$log = Join-Path $Root 'data\update.log'
$extract = Join-Path $stage 'extracted'
$backup = Join-Path $stage 'backup'
$managed = @('server.js','package.json','app','scripts','extensions','docs','README.md','CHANGELOG.md','LICENSE','NOTICE.md','SECURITY.md')
$changed = @()
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    $bytes = 0
    foreach ($entry in $zip.Entries) {
      $bytes += $entry.Length
      if ($bytes -gt 500MB) { throw 'Expanded release exceeds limit' }
      $destination = [IO.Path]::GetFullPath((Join-Path $extract $entry.FullName))
      if (-not $destination.StartsWith(($extract + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe ZIP entry' }
    }
  } finally { $zip.Dispose() }
  [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $extract)
  $sources = @(Get-ChildItem -LiteralPath $extract -Filter 'package.json' -Recurse | Where-Object { Test-Path -LiteralPath (Join-Path $_.Directory.FullName 'server.js') })
  if ($sources.Count -ne 1) { throw 'Release must contain exactly one Seneschal application' }
  $source = $sources[0].Directory.FullName
  $package = Get-Content -Raw -LiteralPath $sources[0].FullName | ConvertFrom-Json
  if ($package.name -ne 'seneschal-ai' -or -not (Test-Path -LiteralPath (Join-Path $source 'app\index.html'))) { throw 'Invalid release layout' }
  $process = Get-Process -Id $ServerPID -ErrorAction SilentlyContinue
  if ($process) { if (-not $process.WaitForExit(30000)) { throw 'Seneschal did not stop; no files changed' } }
  New-Item -ItemType Directory -Path $backup | Out-Null
  foreach ($name in $managed) {
    $from = Join-Path $source $name
    if (-not (Test-Path -LiteralPath $from)) { continue }
    $target = Join-Path $Root $name
    if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination (Join-Path $backup $name) -Recurse }
    $changed += $name
    if ((Get-Item -LiteralPath $from).PSIsContainer) {
      New-Item -ItemType Directory -Force -Path $target | Out-Null
      Get-ChildItem -LiteralPath $from | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force }
    } else { Copy-Item -LiteralPath $from -Destination $target -Force }
  }
  Add-Content -LiteralPath $log -Value "$(Get-Date): Updated to $($package.version). Backup: $backup"
} catch {
  foreach ($name in $changed) {
    $saved = Join-Path $backup $name
    $target = Join-Path $Root $name
    if (Test-Path -LiteralPath $saved) { Copy-Item -LiteralPath $saved -Destination $Root -Recurse -Force }
  }
  Add-Content -LiteralPath $log -Value "$(Get-Date): Update failed: $($_.Exception.Message). Backup: $backup"
} finally {
  Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', ('"' + (Join-Path $Root 'scripts\launch.ps1') + '"')) -WindowStyle Hidden
}
