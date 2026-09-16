; Inno Setup Script for OmniVoice Studio Desktop
; Download Inno Setup at: https://jrsoftware.org/isdl.php

#define MyAppName "OmniVoice Studio"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "OmniVoice Team"
#define MyAppURL "https://github.com/k2-fsa/OmniVoice"
#define MyAppExeName "OmniVoiceStudio.exe"

[Setup]
AppId={{D37E84B1-645C-47FB-A57E-69D9F8014E78}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=..\dist_installer
OutputBaseFilename=OmniVoice_Studio_Setup_v{#MyAppVersion}
SetupIconFile=..\app_icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Root executable and assets
Source: "..\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\run_desktop.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\app_icon.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion isreadme

; Core python backend and source code
Source: "..\omnivoice\*"; DestDir: "{app}\omnivoice"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\.venv\*"; DestDir: "{app}\.venv"; Flags: ignoreversion recursesubdirs createallsubdirs

; Exported static web UI
Source: "..\web\out\*"; DestDir: "{app}\web\out"; Flags: ignoreversion recursesubdirs createallsubdirs

; Tools (FFmpeg etc.)
Source: "..\tools\*"; DestDir: "{app}\tools"; Flags: ignoreversion recursesubdirs createallsubdirs

; Empty writable storage directories
Source: "..\voices\*"; DestDir: "{app}\voices"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\outputs\*"; DestDir: "{app}\outputs"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{app}\voices"; Permissions: users-full
Name: "{app}\outputs"; Permissions: users-full

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\app_icon.ico"
Name: "{group}\Gỡ cài đặt {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\app_icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: postinstall nowait skipifsilent
