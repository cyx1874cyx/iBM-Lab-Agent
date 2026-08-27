@echo off
setlocal EnableExtensions

echo ========================================
echo   iBM Lab Agent - server updater
echo   Server: ubuntu@vlab.ustc.edu.cn
echo ========================================
echo.
echo Downloading and updating on the server...
echo Progress is streamed live from the server.
echo.

REM One ssh command: download the script on the server (with progress bar) and run it.
REM -tt allocates a pty so curl progress and script output stream to this window.
REM URL points to fix/template-list-boundary for testing; switch back to main after merge.
ssh -tt ubuntu@vlab.ustc.edu.cn "curl -fL --progress-bar https://raw.githubusercontent.com/cyx1874cyx/iBM-Lab-Agent/fix/template-list-boundary/scripts/update-agent.sh -o /tmp/update-agent.sh && chmod 700 /tmp/update-agent.sh && bash /tmp/update-agent.sh --ref main"

set "SSH_CODE=%ERRORLEVEL%"
echo.
if "%SSH_CODE%"=="0" (
	echo Update finished successfully.
) else (
	echo Update failed with exit code %SSH_CODE%.
)
echo.
pause
exit /b %SSH_CODE%
