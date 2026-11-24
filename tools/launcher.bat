@echo off
rem 本文件是 GBK 编码，每行 CRLF。不要改成 UTF-8 或 LF：cmd.exe 解析含多字节字符的批处理会错行。
rem 改完后运行 node tools\check-launchers.mjs 检查。
rem 根目录的「打开游戏.bat」调用它：检查 Node.js 和依赖，再打开游戏。
rem 本仓库的 dev server 已经开着（端口 5188）时只打开浏览器，否则启动 dev server 并自动打开浏览器。
rem 等 5 秒用 ping，不用 timeout：stdin 被重定向时 timeout 马上退出。
setlocal
cd /d "%~dp0.."
title 万物皆可撸

echo ============================================
echo   万物皆可撸：打开游戏
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :no_node

echo [1/3] 检查环境
for /f "delims=" %%v in ('node -v') do echo       Node.js %%v
echo       需要 v20.19 或更新版本（vite 8 的要求）。
echo.

echo [2/3] 检查依赖
node tools\deps-stale.mjs
if errorlevel 2 goto :stale
if errorlevel 1 goto :no_modules
echo       依赖是最新的，跳过 npm install。
goto :start

:no_modules
echo       没有 node_modules，开始 npm install...
goto :need_install

:stale
echo       package.json 有更新，依赖已过期，开始 npm install...

:need_install
call npm install
if errorlevel 1 goto :install_failed
echo       依赖安装完成。

:start
echo.
echo [3/3] 打开游戏
node tools\dev-open.mjs
if errorlevel 2 goto :port_busy
if errorlevel 1 goto :serve
echo       dev server 已经开着，已在浏览器打开上面的地址。本窗口 5 秒后关闭。
ping -n 6 127.0.0.1 >nul
exit /b 0

:serve
echo       启动 dev server，浏览器会自动打开。停止：在本窗口按 Ctrl+C。
echo.
call npm run dev -- --open http://127.0.0.1:5188/
echo.
echo [万物皆可撸] dev server 已停止。
goto :end

:port_busy
echo 出错：端口 5188 被别的程序占用了。
echo         关掉占用它的程序后再试，或者在命令行运行 npx vite --port 5190。
goto :end

:no_node
echo 出错：没有找到 Node.js。
echo         请安装 Node.js v20.19 或更新版本：https://nodejs.org/
goto :end

:install_failed
echo.
echo 出错：npm install 失败。请看上面的错误信息。

:end
echo.
echo 按任意键关闭本窗口。
pause >nul
