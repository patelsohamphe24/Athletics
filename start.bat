@echo off
title IIT BHU Athletics - Server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Opening the download page - install the LTS version, then double-click start.bat again.
  start https://nodejs.org/en/download
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm install --omit=dev
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)
set PORT=3000
set ADMIN_PASSWORD=iitbhu11
set SESSION_SECRET=iitbhu-athletics-local-secret-change-me-0123456789
set DATA_DIR=%~dp0data
echo.
echo  Website:  http://localhost:3000
echo  Admin:    click "Admin" and enter the password
echo  Keep this window open while using the site. Close it to stop.
echo.
start "" http://localhost:3000
node server.js
pause
