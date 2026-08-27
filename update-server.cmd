@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "SCRIPT_ROOT=%~dp0"
set "UPDATE_SCRIPT=%SCRIPT_ROOT%scripts\update-server.ps1"

if not exist "%UPDATE_SCRIPT%" (
	echo [ERROR] Cannot find: %UPDATE_SCRIPT%
	echo Please run this file from a complete iBM-Lab-Agent checkout.
	pause
	exit /b 1
)

echo ========================================
echo       iBM Lab Agent server updater
echo ========================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass ^
	-File "%UPDATE_SCRIPT%"

set "UPDATE_EXIT_CODE=%ERRORLEVEL%"
echo.
if "%UPDATE_EXIT_CODE%"=="0" (
	echo Update finished successfully.
) else (
	echo Update failed with exit code %UPDATE_EXIT_CODE%.
)
echo.
pause
exit /b %UPDATE_EXIT_CODE%
