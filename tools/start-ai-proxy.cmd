@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
if exist "ai-local-proxy.config.json" goto run
echo 首次运行：请输入中转接口地址，即原来填在网页“设置”Base URL 里的地址，例如 https://www.example.com/v1
set /p "TARGET=> "
node ai-local-proxy.mjs --target "!TARGET!" %*
goto end
:run
node ai-local-proxy.mjs %*
goto end
:nonode
echo 未找到 Node.js，请先安装 https://nodejs.org/
:end
pause
