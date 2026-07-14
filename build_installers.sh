#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# CoreKit Agent — Cross-platform Installer Builder
# ══════════════════════════════════════════════════════════════════════════════
# Genera los binarios e instaladores para Windows, macOS y Linux desde agent.py.
#
# Uso:
#   ./build_installers.sh windows   → CoreKitAgent.exe + CoreKitAgent-Setup.exe
#   ./build_installers.sh macos     → CoreKitAgent.dmg + CoreKitAgent.pkg
#   ./build_installers.sh linux     → .deb + .rpm + .AppImage
#   ./build_installers.sh all       → todos (según OS actual)
#
# Requisitos por plataforma:
#   Windows: pyinstaller, Inno Setup (iscc.exe en PATH)
#   macOS  : pyinstaller, create-dmg (brew install create-dmg), pkgbuild (nativo)
#   Linux  : pyinstaller, fpm (gem install fpm), appimagetool
# ══════════════════════════════════════════════════════════════════════════════

set -e

AGENT_SRC="agent.py"
VERSION="3.3.0"
OUT_DIR="./dist"
PUBLIC_DIR="../public"          # ajusta si tu Next.js está en otra ruta
APP_NAME="CoreKitAgent"
BUNDLE_ID="com.corekit.agent"
MAINTAINER="CoreKit <soporte@corekit.local>"
DESCRIPTION="CoreKit Hardware Agent — recopila datos físicos del hardware localmente vía WebSocket"

mkdir -p "$OUT_DIR"

# ─────────────────────────────────────────────
# WINDOWS: .exe portable + .exe instalador (Inno Setup)
# ─────────────────────────────────────────────
build_windows() {
  echo "══════ Compilando para Windows ══════"
  pyinstaller --onefile --noconsole --clean \
    --name "$APP_NAME" \
    --distpath "$OUT_DIR" \
    "$AGENT_SRC"
  echo "✓ $OUT_DIR/$APP_NAME.exe (portable)"

  # Generar script Inno Setup
  cat > "$OUT_DIR/installer.iss" <<EOF
[Setup]
AppId={{A3F4E9C2-6B8D-4E1F-9C5A-1F8B7D6E4A2C}
AppName=CoreKit Agent
AppVersion=$VERSION
AppPublisher=CoreKit
DefaultDirName={pf}\CoreKit\Agent
DefaultGroupName=CoreKit Agent
UninstallDisplayIcon={app}\\$APP_NAME.exe
OutputDir=.
OutputBaseFilename=CoreKitAgent-Setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64

[Files]
Source: "$APP_NAME.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\\CoreKit Agent"; Filename: "{app}\\$APP_NAME.exe"
Name: "{group}\\Desinstalar CoreKit Agent"; Filename: "{uninstallexe}"
Name: "{userstartup}\\CoreKit Agent"; Filename: "{app}\\$APP_NAME.exe"; Tasks: startup

[Tasks]
Name: startup; Description: "Iniciar CoreKit Agent al arrancar Windows"; GroupDescription: "Opciones adicionales:"

[Run]
Filename: "{app}\\$APP_NAME.exe"; Description: "Iniciar CoreKit Agent"; Flags: nowait postinstall skipifsilent
EOF

  if command -v iscc &>/dev/null; then
    (cd "$OUT_DIR" && iscc installer.iss)
    echo "✓ $OUT_DIR/CoreKitAgent-Setup.exe (instalador)"
  else
    echo "⚠  Inno Setup (iscc) no encontrado. Ejecuta manualmente: iscc $OUT_DIR/installer.iss"
  fi
}

# ─────────────────────────────────────────────
# macOS: .dmg + .pkg
# ─────────────────────────────────────────────
build_macos() {
  echo "══════ Compilando para macOS ══════"
  pyinstaller --onefile --windowed --clean \
    --name "$APP_NAME" \
    --osx-bundle-identifier "$BUNDLE_ID" \
    --distpath "$OUT_DIR" \
    "$AGENT_SRC"
  echo "✓ $OUT_DIR/$APP_NAME.app"

  # ── .dmg vía create-dmg ──
  if command -v create-dmg &>/dev/null; then
    rm -f "$OUT_DIR/$APP_NAME.dmg"
    create-dmg \
      --volname "CoreKit Agent $VERSION" \
      --window-pos 200 120 --window-size 600 380 \
      --icon-size 100 --icon "$APP_NAME.app" 175 190 \
      --app-drop-link 425 190 \
      --hide-extension "$APP_NAME.app" \
      "$OUT_DIR/$APP_NAME.dmg" \
      "$OUT_DIR/$APP_NAME.app" || true
    echo "✓ $OUT_DIR/$APP_NAME.dmg"
  else
    echo "⚠  create-dmg no encontrado. Instala con: brew install create-dmg"
  fi

  # ── .pkg vía pkgbuild (nativo macOS) ──
  if command -v pkgbuild &>/dev/null; then
    ROOT_DIR="$OUT_DIR/pkg_root/Applications"
    mkdir -p "$ROOT_DIR"
    cp -R "$OUT_DIR/$APP_NAME.app" "$ROOT_DIR/"

    # Script post-instalación: crear LaunchAgent para arranque automático
    SCRIPTS_DIR="$OUT_DIR/pkg_scripts"
    mkdir -p "$SCRIPTS_DIR"
    cat > "$SCRIPTS_DIR/postinstall" <<'PLIST_EOF'
#!/bin/bash
PLIST="/Library/LaunchDaemons/com.corekit.agent.plist"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.corekit.agent</string>
  <key>ProgramArguments</key>
  <array><string>/Applications/CoreKitAgent.app/Contents/MacOS/CoreKitAgent</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
chmod 644 "$PLIST"
launchctl load "$PLIST" 2>/dev/null || true
exit 0
PLIST_EOF
    chmod +x "$SCRIPTS_DIR/postinstall"

    pkgbuild \
      --root "$OUT_DIR/pkg_root" \
      --identifier "$BUNDLE_ID" \
      --version "$VERSION" \
      --install-location "/" \
      --scripts "$SCRIPTS_DIR" \
      "$OUT_DIR/$APP_NAME.pkg"
    echo "✓ $OUT_DIR/$APP_NAME.pkg"

    rm -rf "$OUT_DIR/pkg_root" "$OUT_DIR/pkg_scripts"
  fi
}

# ─────────────────────────────────────────────
# Linux: .deb + .rpm + .AppImage
# ─────────────────────────────────────────────
build_linux() {
  echo "══════ Compilando para Linux ══════"
  pyinstaller --onefile --clean \
    --name "corekit-agent" \
    --distpath "$OUT_DIR" \
    "$AGENT_SRC"
  BIN="$OUT_DIR/corekit-agent"
  echo "✓ $BIN"

  # systemd unit para arranque automático
  UNIT_DIR="$OUT_DIR/systemd_pkg/etc/systemd/system"
  BIN_DIR="$OUT_DIR/systemd_pkg/usr/local/bin"
  mkdir -p "$UNIT_DIR" "$BIN_DIR"
  cp "$BIN" "$BIN_DIR/corekit-agent"
  chmod +x "$BIN_DIR/corekit-agent"
  cat > "$UNIT_DIR/corekit-agent.service" <<EOF
[Unit]
Description=CoreKit Hardware Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/corekit-agent
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
EOF

  # ── .deb + .rpm vía fpm ──
  if command -v fpm &>/dev/null; then
    (cd "$OUT_DIR" && fpm -s dir -t deb -n corekit-agent -v "$VERSION" \
      -m "$MAINTAINER" --description "$DESCRIPTION" \
      --license "MIT" --url "https://corekit.local" \
      --deb-systemd systemd_pkg/etc/systemd/system/corekit-agent.service \
      --after-install <(echo -e '#!/bin/bash\nsystemctl daemon-reload\nsystemctl enable --now corekit-agent.service') \
      -C systemd_pkg .)
    echo "✓ $OUT_DIR/corekit-agent_${VERSION}_amd64.deb"

    (cd "$OUT_DIR" && fpm -s dir -t rpm -n corekit-agent -v "$VERSION" \
      -m "$MAINTAINER" --description "$DESCRIPTION" \
      --license "MIT" --url "https://corekit.local" \
      --after-install <(echo -e '#!/bin/bash\nsystemctl daemon-reload\nsystemctl enable --now corekit-agent.service') \
      -C systemd_pkg .)
    echo "✓ $OUT_DIR/corekit-agent-${VERSION}-1.x86_64.rpm"
  else
    echo "⚠  fpm no encontrado. Instala con: gem install --no-document fpm"
  fi

  # ── .AppImage ──
  if command -v appimagetool &>/dev/null; then
    APPDIR="$OUT_DIR/CoreKitAgent.AppDir"
    rm -rf "$APPDIR"
    mkdir -p "$APPDIR/usr/bin"
    cp "$BIN" "$APPDIR/usr/bin/corekit-agent"
    chmod +x "$APPDIR/usr/bin/corekit-agent"
    cat > "$APPDIR/AppRun" <<'APPRUN'
#!/bin/bash
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/corekit-agent" "$@"
APPRUN
    chmod +x "$APPDIR/AppRun"
    cat > "$APPDIR/corekit-agent.desktop" <<EOF
[Desktop Entry]
Name=CoreKit Agent
Exec=corekit-agent
Icon=corekit-agent
Type=Application
Categories=System;
EOF
    # Icono placeholder 1x1 (reemplaza con tu logo real)
    printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90\x77\x53\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x35\x81\x84\x00\x00\x00\x00IEND\xaeB`\x82' > "$APPDIR/corekit-agent.png"
    (cd "$OUT_DIR" && ARCH=x86_64 appimagetool CoreKitAgent.AppDir corekit-agent.AppImage)
    echo "✓ $OUT_DIR/corekit-agent.AppImage"
  else
    echo "⚠  appimagetool no encontrado. Descarga: https://github.com/AppImage/AppImageKit/releases"
  fi

  rm -rf "$OUT_DIR/systemd_pkg" "$OUT_DIR/CoreKitAgent.AppDir"
}

# ─────────────────────────────────────────────
# Copiar a public/ del Next.js
# ─────────────────────────────────────────────
copy_to_public() {
  if [ -d "$PUBLIC_DIR" ]; then
    echo "══════ Copiando a $PUBLIC_DIR ══════"
    # Windows
    [ -f "$OUT_DIR/$APP_NAME.exe" ]         && cp "$OUT_DIR/$APP_NAME.exe" "$PUBLIC_DIR/"
    [ -f "$OUT_DIR/CoreKitAgent-Setup.exe" ] && cp "$OUT_DIR/CoreKitAgent-Setup.exe" "$PUBLIC_DIR/"
    # macOS
    [ -f "$OUT_DIR/$APP_NAME.dmg" ] && cp "$OUT_DIR/$APP_NAME.dmg" "$PUBLIC_DIR/"
    [ -f "$OUT_DIR/$APP_NAME.pkg" ] && cp "$OUT_DIR/$APP_NAME.pkg" "$PUBLIC_DIR/"
    # Linux
    for f in "$OUT_DIR"/corekit-agent*.deb; do [ -f "$f" ] && cp "$f" "$PUBLIC_DIR/corekit-agent.deb"; done
    for f in "$OUT_DIR"/corekit-agent*.rpm; do [ -f "$f" ] && cp "$f" "$PUBLIC_DIR/corekit-agent.rpm"; done
    [ -f "$OUT_DIR/corekit-agent.AppImage" ] && cp "$OUT_DIR/corekit-agent.AppImage" "$PUBLIC_DIR/"
    echo "✓ Instaladores copiados a $PUBLIC_DIR"
  fi
}

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
case "${1:-}" in
  windows) build_windows ;;
  macos)   build_macos ;;
  linux)   build_linux ;;
  all)
    OS="$(uname -s)"
    case "$OS" in
      Darwin) build_macos ;;
      Linux)  build_linux ;;
      MINGW*|CYGWIN*|MSYS*) build_windows ;;
      *) echo "OS desconocido: $OS"; exit 1 ;;
    esac
    ;;
  *)
    echo "Uso: $0 {windows|macos|linux|all}"
    echo ""
    echo "Ejemplos:"
    echo "  $0 all       # Detecta OS actual y compila"
    echo "  $0 windows   # Solo Windows (requiere estar en Windows)"
    echo "  $0 macos     # Solo macOS (requiere estar en macOS)"
    echo "  $0 linux     # Solo Linux (requiere estar en Linux)"
    exit 1 ;;
esac

copy_to_public
echo ""
echo "════════════════════════════════════"
echo "  BUILD COMPLETO — v$VERSION"
echo "════════════════════════════════════"
ls -lah "$OUT_DIR"/*.{exe,dmg,pkg,deb,rpm,AppImage} 2>/dev/null || true
