@echo off
cd /d "%~dp0"
echo === Solitaire Troyka ===
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found on PATH. Install Node 18+ first.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting server on http://localhost:3000
node server.js
pause
