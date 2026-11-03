@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22 或更新版本，再运行此文件。
  pause
  exit /b 1
)
echo 浏览器地址：http://127.0.0.1:17883
echo 请保持本窗口开启。按 Ctrl+C 可退出。
start "" "http://127.0.0.1:17883"
node src/server.mjs
pause
