@echo off
setlocal
cd /d "%~dp0"
if exist "%ProgramFiles%\nodejs\npm.cmd" set "PATH=%ProgramFiles%\nodejs;%PATH%"
start "EMS CONNECT Dev Server" /D "%~dp0" cmd /k "npm.cmd run dev -- --host 127.0.0.1 --strictPort"
timeout /t 5 /nobreak >nul
start "" "http://127.0.0.1:5173/"
