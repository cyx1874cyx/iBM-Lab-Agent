@echo off
setlocal
rem iBM Lab preview launcher: clear stale processes, then start the dev workbench.
set "REPO=%~dp0..\.."
set "NODE=C:\Users\admin\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" (
  echo Node runtime not found: %NODE%
  pause
  exit /b 1
)
if not exist "%REPO%\scripts\dev-workbench.mjs" (
  echo Workbench script not found: %REPO%\scripts\dev-workbench.mjs
  pause
  exit /b 1
)

rem Kill stale dev-workbench / Electron so the single-instance lock cannot abort startup.
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*dev-workbench.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*electron-next-p1*' } | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1
ping -n 2 127.0.0.1 >nul

cd /d "%REPO%"
"%NODE%" scripts\dev-workbench.mjs
exit /b
