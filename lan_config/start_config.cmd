@echo off
setlocal
cd /d "%~dp0"
set MAGIC_START_PATH=/
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\serve.ps1"
endlocal
