@echo off
title Build OmniVoice Frontend
cd /d "%~dp0"
echo ======================================================================
echo             Build Next.js Frontend thanh Static Files (out/)
echo ======================================================================
echo.

:: Add portable Node.js to PATH if present
if exist "C:\Program Files\nodejs" (
    set "PATH=C:\Program Files\nodejs;%PATH%"
)
if exist "%LOCALAPPDATA%\Programs\node" (
    set "PATH=%LOCALAPPDATA%\Programs\node;%PATH%"
)

cd web
echo Dang bien dich Frontend Next.js (output: export)...
call npm run build

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [LOI] Build frontend that bai! Vui long kiem tra lai ma nguon.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ======================================================================
echo [THANH CONG] Giao dien da duoc build vao thu muc web\out!
echo FastAPI se tu dong phuc vu giao dien nay ma khong can Node.js.
echo ======================================================================
echo.
pause
