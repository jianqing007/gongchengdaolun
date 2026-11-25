@echo off
chcp 65001 >nul
title 股迹启动器
cd /d "%~dp0"

set "PY=python"
where python >nul 2>nul
if errorlevel 1 set "PY=py"
where %PY% >nul 2>nul
if errorlevel 1 goto nopython

echo [1/2] 正在自动更新行情快照（增量，一般 10-30 秒，请稍候）...
%PY% tools\build_snapshot.py --update
if errorlevel 1 (
    echo     快照更新未成功（可能断网或接口临时不可用），将继续使用现有快照启动。
    echo     页面顶部会显示实际的数据日期，联网后再次启动即可补上。
) else (
    echo     快照更新完成。
)

echo [2/2] 启动本地服务器并打开浏览器...
start "股迹本地服务器" cmd /k "%PY% -m http.server 8000"
timeout /t 2 >nul
start "" "http://localhost:8000/index.html"
exit /b 0

:nopython
echo.
echo 未找到 Python。
echo 你可以直接双击 index.html 打开（行情接口支持 file:// 跨域），
echo 此时会使用项目内置的快照数据，实时行情不受影响。
echo 或安装 Python 3 后再运行本脚本（启动时会自动更新快照）。
echo.
pause
exit /b 1
