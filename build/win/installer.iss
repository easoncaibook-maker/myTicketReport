#define MyAppName "运维工单系统"
#define MyAppVersion "0.2.0"
#define MyAppPublisher "TicketReport"

[Setup]
AppId={{B7A2E4C1-4F3D-4A62-9C2E-6D5B8A1F0C37}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\TicketReport
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist-installer
OutputBaseFilename=TicketReport-Setup-{#MyAppVersion}
SetupIconFile=app.ico
UninstallDisplayIcon={app}\app.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: checkedonce

[Files]
Source: "app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"
Name: "{autoprograms}\{#MyAppName} 操作手册"; Filename: "{sys}\notepad.exe"; Parameters: """{app}\操作手册.md"""; WorkingDir: "{app}"
Name: "{autoprograms}\{#MyAppName} 停止服务"; Filename: "{app}\stop.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"
Name: "{autoprograms}\{#MyAppName} 切换空库"; Filename: "{app}\switch-to-base.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"""; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent
