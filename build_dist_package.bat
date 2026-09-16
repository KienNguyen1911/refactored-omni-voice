@echo off
title Dong goi OmniVoice Studio (Che ma nguon .pyc)
cd /d "%~dp0"

echo ======================================================================
echo    Tien trinh dong goi OmniVoice Studio khong kem ma nguon .py
echo ======================================================================
echo.

.\.venv\Scripts\python.exe tools\package_app.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [LOI] Co loi trong qua trinh dong goi!
)
echo.
pause
