@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tunnel-local.ps1" -Action Stop
if errorlevel 1 (
  echo.
  echo Stop failed. No unrelated process is intentionally stopped.
  pause
  exit /b 1
)
echo.
pause
