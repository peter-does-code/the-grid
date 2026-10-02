@echo off
rem Dobbeltklik for at starte The Grid (udviklerudgaven fra kildekoden).
rem Mangler pakkerne i node_modules, hentes de automatisk med npm install.
rem Filen skal blive ASCII: cmd.exe laeser den i ANSI-tegnsaettet.
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="

if exist "node_modules\electron\dist\electron.exe" goto run

echo The Grid runs on Node.js and needs a few packages (Electron, Butterchurn) before it can start.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on this computer.
  echo Install Node.js 22.12 or newer from https://nodejs.org/ and run this file again.
  echo.
  pause
  exit /b 1
)

echo Fetching the packages now with "npm install" (a few minutes the first time)...
echo.
call npm install
if errorlevel 1 (
  echo.
  echo "npm install" failed. Check the messages above, fix the problem and run this file again.
  echo.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Fetching Electron...
  call node node_modules\electron\install.js
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo Electron could not be downloaded. Check your internet connection and run this file again.
  echo.
  pause
  exit /b 1
)
echo.
echo Done. Starting The Grid.

:run
start "" "node_modules\electron\dist\electron.exe" .
