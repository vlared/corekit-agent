@echo off
REM ══════════════════════════════════════════════════════════════════════════
REM  CoreKit Agent — Windows Build Script
REM ══════════════════════════════════════════════════════════════════════════
REM  Genera CoreKitAgent.exe (portable) + CoreKitAgent-Setup.exe (instalador).
REM
REM  Requisitos:
REM    1. Python 3.10+ con pip
REM    2. pip install pyinstaller psutil websockets
REM    3. Inno Setup 6+ instalado (https://jrsoftware.org/isdl.php)
REM       — asegúrate que iscc.exe esté en el PATH o edita ISCC_PATH abajo
REM ══════════════════════════════════════════════════════════════════════════

setlocal enabledelayedexpansion

set VERSION=3.3.0
set APP_NAME=CoreKitAgent
set OUT_DIR=dist
set PUBLIC_DIR=..\public
set ISCC_PATH="C:\Program Files (x86)\Inno Setup 6\iscc.exe"

echo.
echo ══════ Compilando %APP_NAME% v%VERSION% ══════
echo.

REM ── 1) Instalar dependencias ──
pip install --quiet pyinstaller psutil websockets

REM ── 2) Portable .exe ──
pyinstaller --onefile --noconsole --clean ^
  --name "%APP_NAME%" ^
  --distpath "%OUT_DIR%" ^
  agent.py

if not exist "%OUT_DIR%\%APP_NAME%.exe" (
  echo ERROR: PyInstaller no generó el .exe
  exit /b 1
)
echo ✓ %OUT_DIR%\%APP_NAME%.exe (portable)

REM ── 3) Generar script Inno Setup ──
(
  echo [Setup]
  echo AppId={{A3F4E9C2-6B8D-4E1F-9C5A-1F8B7D6E4A2C}}
  echo AppName=CoreKit Agent
  echo AppVersion=%VERSION%
  echo AppPublisher=CoreKit
  echo DefaultDirName={pf}\CoreKit\Agent
  echo DefaultGroupName=CoreKit Agent
  echo UninstallDisplayIcon={app}\%APP_NAME%.exe
  echo OutputDir=.
  echo OutputBaseFilename=CoreKitAgent-Setup
  echo Compression=lzma2
  echo SolidCompression=yes
  echo PrivilegesRequired=admin
  echo ArchitecturesInstallIn64BitMode=x64
  echo.
  echo [Files]
  echo Source: "%APP_NAME%.exe"; DestDir: "{app}"; Flags: ignoreversion
  echo.
  echo [Icons]
  echo Name: "{group}\CoreKit Agent"; Filename: "{app}\%APP_NAME%.exe"
  echo Name: "{group}\Desinstalar CoreKit Agent"; Filename: "{uninstallexe}"
  echo Name: "{userstartup}\CoreKit Agent"; Filename: "{app}\%APP_NAME%.exe"; Tasks: startup
  echo.
  echo [Tasks]
  echo Name: startup; Description: "Iniciar CoreKit Agent al arrancar Windows"; GroupDescription: "Opciones adicionales:"
  echo.
  echo [Run]
  echo Filename: "{app}\%APP_NAME%.exe"; Description: "Iniciar CoreKit Agent"; Flags: nowait postinstall skipifsilent
) > "%OUT_DIR%\installer.iss"

REM ── 4) Compilar instalador con Inno Setup ──
if exist %ISCC_PATH% (
  pushd "%OUT_DIR%"
  %ISCC_PATH% installer.iss
  popd
  echo ✓ %OUT_DIR%\CoreKitAgent-Setup.exe (instalador)
) else (
  echo ⚠  Inno Setup no encontrado en %ISCC_PATH%
  echo    Descarga: https://jrsoftware.org/isdl.php
  echo    Luego ejecuta: %ISCC_PATH% "%OUT_DIR%\installer.iss"
)

REM ── 5) Copiar a public/ ──
if exist "%PUBLIC_DIR%" (
  copy /Y "%OUT_DIR%\%APP_NAME%.exe" "%PUBLIC_DIR%\" >nul
  if exist "%OUT_DIR%\CoreKitAgent-Setup.exe" (
    copy /Y "%OUT_DIR%\CoreKitAgent-Setup.exe" "%PUBLIC_DIR%\" >nul
  )
  echo ✓ Copiado a %PUBLIC_DIR%
)

echo.
echo ════════════════════════════════════
echo   BUILD COMPLETO — v%VERSION%
echo ════════════════════════════════════
dir "%OUT_DIR%\*.exe"
endlocal
