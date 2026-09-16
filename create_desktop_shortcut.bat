@echo off
title Tao Shortcut OmniVoice Studio ra Desktop
cd /d "%~dp0"

echo Dang tao shortcut OmniVoice Studio tren Desktop...
set "VBS_TEMP=%TEMP%\create_shortcut_%RANDOM%.vbs"
(
echo Set oWS = WScript.CreateObject("WScript.Shell"^)
echo sLinkFile = oWS.SpecialFolders("Desktop"^) ^& "\OmniVoice Studio.lnk"
echo Set oLink = oWS.CreateShortcut(sLinkFile^)
echo oLink.TargetPath = "%~dp0OmniVoiceStudio.exe"
echo oLink.WorkingDirectory = "%~dp0"
echo oLink.IconLocation = "%~dp0OmniVoiceStudio.exe,0"
echo oLink.Description = "OmniVoice Studio - Zero-Shot Voice Workstation"
echo oLink.Save
) > "%VBS_TEMP%"

cscript //nologo "%VBS_TEMP%"
if exist "%VBS_TEMP%" del "%VBS_TEMP%"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ======================================================================
    echo [THANH CONG] Da tao bieu tuong "OmniVoice Studio" ngoai man hinh Desktop!
    echo Ban co the nhap dup chuot vao bieu tuong tren Desktop de mo app ngay.
    echo ======================================================================
) else (
    echo.
    echo [LOI] Khong the tao shortcut.
)
echo.
pause
