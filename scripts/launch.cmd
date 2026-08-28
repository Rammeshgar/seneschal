@echo off
setlocal
cd /d "%~dp0.."
if not exist "data" mkdir "data"
set "SENESCHAL_LOG=%CD%\data\launcher.log"
> "%SENESCHAL_LOG%" echo [%date% %time%] Starting Seneschal
where node.exe >nul 2>nul
if errorlevel 1 (
  >> "%SENESCHAL_LOG%" echo Node.js 20 or newer was not found.
  powershell.exe -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Seneschal needs Node.js 20 or newer. Download it from https://nodejs.org/.','Seneschal could not start') | Out-Null"
  exit /b 1
)
node server.js >> "%SENESCHAL_LOG%" 2>&1
if errorlevel 1 (
  powershell.exe -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Seneschal could not start. Open Ubuntu once and try again. Details were saved to data\launcher.log.','Seneschal could not start') | Out-Null"
  exit /b 1
)
