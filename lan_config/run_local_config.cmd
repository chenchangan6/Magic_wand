@echo off
setlocal
cd /d "%~dp0lan_config"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\serve.ps1"
endlocal
