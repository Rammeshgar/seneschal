[CmdletBinding(SupportsShouldProcess)]
param([string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'DigitalServant'))

$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Digital Servant.lnk'
if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut }
if (Test-Path -LiteralPath $InstallDirectory) {
  Write-Host "The application remains at $InstallDirectory so your settings and backups are recoverable."
  Write-Host 'Delete that folder manually if you no longer need its local data.'
}
Write-Host 'Desktop shortcut removed. OpenCode and provider credentials were not changed.'
