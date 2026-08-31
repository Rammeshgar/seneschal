$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root 'data'
$log = Join-Path $data 'launcher.log'
$runLog = Join-Path $data "launcher-$PID.log"
New-Item -ItemType Directory -Force -Path $data | Out-Null
Add-Content -Encoding utf8 -LiteralPath $log -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting Seneschal (launcher $PID)"

try {
  $node = Get-Command node.exe -ErrorAction Stop
  Push-Location $root
  try {
    & $node.Source (Join-Path $root 'server.js') *>> $runLog
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($exitCode -ne 0) { throw "Seneschal exited with code $exitCode." }
} catch {
  Add-Content -Encoding utf8 -LiteralPath $runLog -Value $_.Exception.Message
  Add-Content -Encoding utf8 -LiteralPath $log -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Launch failed; see $runLog"
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "Seneschal could not start. Details were saved to $runLog",
    'Seneschal could not start'
  ) | Out-Null
  exit 1
}
