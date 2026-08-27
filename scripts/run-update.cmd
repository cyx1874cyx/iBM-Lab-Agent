@echo off
setlocal EnableExtensions
chcp 65001 >nul

echo ========================================
echo   iBM Lab Agent - server updater
echo   Server: ubuntu@vlab.ustc.edu.cn
echo ========================================
echo.
echo 远端下载与执行均在服务器上进行,进度条会实时显示在本窗口。

REM 一条 ssh 命令搞定:远端下载脚本(带进度条)→ 执行。
REM -tt 分配伪终端,curl 的进度条和脚本输出都会转发到本窗口。
REM 注意:URL 当前指向 fix/template-list-boundary 分支(测试用);合并到 main 后改回 main。
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
