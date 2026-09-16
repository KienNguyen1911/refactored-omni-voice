@echo off
title Compile OmniVoice Studio Launcher
cd /d "%~dp0"

echo Dang bien dich launcher.cs thanh OmniVoiceStudio.exe...
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /out:OmniVoiceStudio.exe /win32icon:app_icon.ico launcher.cs

if %ERRORLEVEL% EQU 0 (
    echo [THANH CONG] Da tao OmniVoiceStudio.exe thanh cong!
) else (
    echo [LOI] Co loi xay ra khi bien dich!
)
