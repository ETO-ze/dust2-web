@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tunnel-local.ps1" -Action Start %*
if errorlevel 1 (
  echo.
  echo Game startup failed. Read the message above.
  pause
  exit /b 1
)
echo.
pause
