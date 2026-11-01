param(
  [ValidateSet('backup','status','verify','restore-isolated')][string]$Operation = 'backup',
  [string]$BackupID
)
$ErrorActionPreference = 'Stop'
$worker = Join-Path $PSScriptRoot 'backup-manager.cjs'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$arguments = @($worker, $Operation)
if ($Operation -in @('verify','restore-isolated')) {
  if ($BackupID -notmatch '^backup-\d{8}T\d{9}Z-[a-f0-9]{16}$') { throw 'Provide the backup ID shown in Seneschal Settings.' }
  $arguments += $BackupID
} elseif ($BackupID) { throw 'This operation does not accept a backup ID.' }
& $node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Backup operation failed. No live history or sign-in files were replaced.' }
