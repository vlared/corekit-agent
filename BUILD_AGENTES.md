# CoreKit Agent — Cómo crear los 3 ejecutables

Coloca los archivos generados en `public/` de tu proyecto Next.js con estos nombres exactos:
- `public/CoreKitAgent.exe`
- `public/CoreKitAgent.dmg`
- `public/corekit-agent.AppImage`

═══════════════════════════════════════════════════════════════════════════
## 1. WINDOWS — CoreKitAgent.exe
═══════════════════════════════════════════════════════════════════════════

**Ejecutar en Windows 10/11:**

```powershell
# 1) Instala Python 3.10+ desde https://www.python.org/downloads/
# 2) Abre PowerShell EN LA CARPETA donde está agent.py
python -m pip install --upgrade pip
python -m pip install pyinstaller psutil websockets

pyinstaller --onefile --noconsole --clean --name CoreKitAgent agent.py

# El .exe queda en: dist\CoreKitAgent.exe
copy dist\CoreKitAgent.exe ..\public\
```

═══════════════════════════════════════════════════════════════════════════
## 2. macOS — CoreKitAgent.dmg
═══════════════════════════════════════════════════════════════════════════

**Ejecutar en un Mac (macOS 11+):**

```bash
# 1) Instala Homebrew si no lo tienes: https://brew.sh
brew install python create-dmg
python3 -m pip install pyinstaller psutil websockets

# 2) Compila el .app
pyinstaller --onefile --windowed --clean \
  --name CoreKitAgent \
  --osx-bundle-identifier com.corekit.agent \
  agent.py

# 3) Empaqueta como .dmg
create-dmg \
  --volname "CoreKit Agent" \
  --window-size 500 320 \
  --icon-size 96 \
  --icon "CoreKitAgent.app" 130 150 \
  --app-drop-link 370 150 \
  dist/CoreKitAgent.dmg \
  dist/CoreKitAgent.app

cp dist/CoreKitAgent.dmg ../public/
```

═══════════════════════════════════════════════════════════════════════════
## 3. LINUX — corekit-agent.AppImage
═══════════════════════════════════════════════════════════════════════════

**Ejecutar en Linux x86_64 (Ubuntu 20+, Fedora 36+, Debian 11+):**

```bash
# 1) Dependencias
sudo apt install -y python3-pip                       # Ubuntu/Debian
# o: sudo dnf install -y python3-pip                  # Fedora/RHEL

pip3 install --user pyinstaller psutil websockets

# 2) Descarga appimagetool
wget -O appimagetool "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
chmod +x appimagetool

# 3) Compila el binario
pyinstaller --onefile --clean --name corekit-agent agent.py

# 4) Estructura AppDir
mkdir -p CoreKitAgent.AppDir/usr/bin
cp dist/corekit-agent CoreKitAgent.AppDir/usr/bin/

cat > CoreKitAgent.AppDir/AppRun <<'EOF'
#!/bin/bash
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/corekit-agent" "$@"
EOF
chmod +x CoreKitAgent.AppDir/AppRun

cat > CoreKitAgent.AppDir/corekit-agent.desktop <<'EOF'
[Desktop Entry]
Name=CoreKit Agent
Exec=corekit-agent
Icon=corekit-agent
Type=Application
Categories=System;
EOF

# Icono placeholder (1x1 PNG). Reemplázalo por tu logo real si quieres:
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90\x77\x53\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x35\x81\x84\x00\x00\x00\x00IEND\xaeB`\x82' > CoreKitAgent.AppDir/corekit-agent.png

# 5) Genera el .AppImage
ARCH=x86_64 ./appimagetool CoreKitAgent.AppDir corekit-agent.AppImage

cp corekit-agent.AppImage ../public/
```

═══════════════════════════════════════════════════════════════════════════
## Comprobación final
═══════════════════════════════════════════════════════════════════════════

Después de compilar y copiar los archivos, tu carpeta `public/` debe contener:

```
public/
├─ CoreKitAgent.exe          ← Windows
├─ CoreKitAgent.dmg          ← macOS
└─ corekit-agent.AppImage    ← Linux
```

El modal de descarga en el frontend los servirá automáticamente al hacer clic
en el logo correspondiente.
