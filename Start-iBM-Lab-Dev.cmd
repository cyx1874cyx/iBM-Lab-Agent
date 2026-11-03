@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\start-workbench.ps1"
if errorlevel 1 (
  echo iBM Lab could not start. See the error above and workbench preparation logs.
  pause
)
