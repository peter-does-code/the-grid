@echo off
rem Dobbeltklik for at starte The Grid (udviklerudgaven fra kildekoden).
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
if not exist "node_modules\electron\dist\electron.exe" (
  echo The Grid is not installed yet. Run "npm install" in this folder first.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
