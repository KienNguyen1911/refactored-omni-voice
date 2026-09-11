@echo off
title Stop OmniVoice Studio
echo ======================================================================
echo                  Dang tat OmniVoice Studio...
echo ======================================================================
echo.

:: Tat cac tien trinh dang lang nghe tren cong 8000 (Backend) va 3000 (Frontend)
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000, 3000 -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {} }"

:: Tat bo sung cac cua so CMD OmniVoice neu con chay ngam
taskkill /F /FI "WINDOWTITLE eq OmniVoice Backend API*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq OmniVoice WebUI*" >nul 2>&1

echo Da tat thanh cong Backend (Port 8000) va WebUI (Port 3000)!
echo ======================================================================
ping 127.0.0.1 -n 3 >nul
