@echo off
chcp 65001 >nul
title 股迹启动器
cd /d "%~dp0"

set "PY=python"
where python >nul 2>nul
if errorlevel 1 set "PY=py"
where %PY% >nul 2>nul
if errorlevel 1 goto nopython

start "股迹本地服务器" cmd /k "%PY% -m http.server 8000"
timeout /t 2 >nul
start "" "http://localhost:8000/index.html"
exit /b 0

:nopython
echo.
echo 未找到 Python。
echo 你可以直接双击 index.html 打开（行情接口支持 file:// 跨域），
echo 或安装 Python 3 后再运行本脚本。
echo.
pause
exit /b 1
