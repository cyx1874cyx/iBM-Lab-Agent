@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "UPDATE_SCRIPT=%TEMP%\ibm-lab-agent-update-server-%RANDOM%-%RANDOM%.ps1"
set "UPDATER_URL=https://git.ustc.edu.cn/qbdeng2025/iBM-Lab-Agent/-/raw/main/scripts/update-server.ps1?cache=%RANDOM%"

echo ========================================
echo       iBM Lab Agent server updater
echo ========================================
echo Server: ubuntu@vlab.ustc.edu.cn
echo Source: latest main branch
echo.

echo Downloading the updater from USTC GitLab...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass ^
	-Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $env:UPDATER_URL -OutFile $env:UPDATE_SCRIPT -ErrorAction Stop; $text=[IO.File]::ReadAllText($env:UPDATE_SCRIPT,[Text.Encoding]::UTF8); [IO.File]::WriteAllText($env:UPDATE_SCRIPT,$text,(New-Object Text.UTF8Encoding($true)))"

if errorlevel 1 (
	echo.
	echo [ERROR] Failed to download the updater from USTC GitLab.
	echo Please check the network connection and try again.
	pause
	exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass ^
	-File "%UPDATE_SCRIPT%"

set "UPDATE_EXIT_CODE=%ERRORLEVEL%"
del /f /q "%UPDATE_SCRIPT%" >nul 2>&1
echo.
if "%UPDATE_EXIT_CODE%"=="0" (
	echo Update finished successfully.
) else (
	echo Update failed with exit code %UPDATE_EXIT_CODE%.
)
echo.
pause
exit /b %UPDATE_EXIT_CODE%
