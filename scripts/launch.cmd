@echo off
setlocal
cd /d "%~dp0.."
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Seneschal needs Node.js 20 or newer.
  echo Download it from https://nodejs.org/
  pause
  exit /b 1
)
node server.js
if errorlevel 1 pause
