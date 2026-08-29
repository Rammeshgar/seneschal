@echo off
setlocal
set "SENESCHAL_ROOT=%~dp0.."
set "ARTIFACTS=%SENESCHAL_ROOT%\data\browser-artifacts"
if not exist "%ARTIFACTS%" mkdir "%ARTIFACTS%"
set "BRAVE_EXE=%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"
if not exist "%BRAVE_EXE%" set "BRAVE_EXE=%ProgramFiles(x86)%\BraveSoftware\Brave-Browser\Application\brave.exe"
if not exist "%BRAVE_EXE%" set "BRAVE_EXE=%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"
if not exist "%BRAVE_EXE%" (
  echo Brave could not be found. Install Brave or update start-playwright-mcp.cmd with its location. 1>&2
  exit /b 1
)
set "DISPLAY_MODE=--headless"
if exist "%SENESCHAL_ROOT%\data\playwright-visible.flag" set "DISPLAY_MODE="
"%~dp0node_modules\.bin\playwright-mcp.cmd" --browser chrome --executable-path "%BRAVE_EXE%" %DISPLAY_MODE% --isolated --image-responses allow --output-dir "%ARTIFACTS%" --output-max-size 52428800
