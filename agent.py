"""
CoreKit Hardware Agent v3.3 — agent.py (multiplataforma)
Uso:      python agent.py
Compilar Windows: pyinstaller --onefile --noconsole --name CoreKitAgent agent.py
Compilar macOS:   pyinstaller --onefile --windowed --name corekit-agent-macos agent.py
Compilar Linux:   pyinstaller --onefile --name corekit-agent-linux agent.py

v3.3 — Soporte nativo Windows (CIM/PowerShell), macOS (system_profiler),
       Linux (DMI + lsblk + lscpu + lspci). Detecta hardware completo en los 3 OS.
"""
import asyncio, json, subprocess, platform, sys, logging, time, socket, uuid, ctypes, os
import psutil
import websockets

def _ensure_admin():
    if sys.platform != "win32":
        return
    try:
        if ctypes.windll.shell32.IsUserAnAdmin():
            return
        ret = ctypes.windll.shell32.ShellExecuteW(
            None, "runas", sys.executable, f'"{sys.argv[0]}" {" ".join(sys.argv[1:])}', None, 1)
        if ret > 32:
            sys.exit(0)
    except Exception:
        pass

_ensure_admin()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [CoreKit] %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("CoreKitAgent")

PORT = 8765
INTERVAL = 1.0
NO_WIN = 0x08000000 if sys.platform == "win32" else 0
GB = 1024 ** 3

# ─── Instancia única / puerto ─────────────────────────────────────────────────
def _kill_stale_instances():
    me = os.getpid()
    my = {"corekitagent.exe", "corekitagent", os.path.basename(sys.argv[0]).lower()}
    killed = False
    # 1) Por nombre (psutil)
    for p in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            if p.info["pid"] == me:
                continue
            nm = (p.info.get("name") or "").lower()
            cl = " ".join(p.info.get("cmdline") or []).lower()
            if nm in my or "corekitagent" in nm or ("python" in nm and "agent.py" in cl):
                p.kill()
                log.info("Instancia previa detenida (pid=%s)", p.info["pid"])
                killed = True
        except Exception:
            continue
    # 2) Por PID que retiene el puerto (psutil net_connections)
    try:
        for c in psutil.net_connections(kind="inet"):
            if c.laddr and c.laddr.port == PORT and c.pid and c.pid != me:
                try:
                    p = psutil.Process(c.pid)
                    p.kill()
                    log.info("PID %s (que retenía el puerto) detenido", c.pid)
                    killed = True
                except Exception:
                    pass
    except Exception:
        pass
    # 3) taskkill /F como red de seguridad en Windows
    if sys.platform == "win32":
        try:
            subprocess.run(["taskkill", "/F", "/IM", "CoreKitAgent.exe"],
                           capture_output=True, timeout=5, creationflags=NO_WIN)
        except Exception:
            pass
    if killed:
        time.sleep(0.6)

def _port_in_use(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()

def _make_server_socket(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try: s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    except Exception: pass
    s.bind(("127.0.0.1", port)); s.listen(16); s.setblocking(False)
    return s

# ─── PowerShell con salida JSON ───────────────────────────────────────────────
def _ps_json(script, timeout=45):
    full = "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='SilentlyContinue';" + script
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", full],
            capture_output=True, text=True, timeout=timeout, creationflags=NO_WIN,
            encoding="utf-8", errors="ignore")
        out = (r.stdout or "").strip()
        if not out:
            log.warning("PowerShell devolvió vacío. stderr=%s", (r.stderr or "")[:200])
            return None
        try:
            return json.loads(out)
        except json.JSONDecodeError as je:
            log.warning("JSON inválido: %s | inicio=%s", je, out[:200])
            return None
    except subprocess.TimeoutExpired:
        log.error("PowerShell tardó más de %ds", timeout)
        return None
    except Exception as e:
        log.error("PS error: %s", e)
        return None

BAD = {"", "to be filled by o.e.m.", "default string", "system product name",
       "system manufacturer", "none", "o.e.m.", "00000000", "not available", "null"}

def _clean(v, default="—"):
    s = str(v).strip() if v is not None else ""
    return default if not s or s.lower() in BAD else s

# ─── Recolección estática vía un solo script PowerShell ───────────────────────
PS_STATIC = r"""
$os   = Get-CimInstance Win32_OperatingSystem
$cs   = Get-CimInstance Win32_ComputerSystem
$csp = Get-CimInstance Win32_ComputerSystemProduct
$msi = $null
try { $msi = Get-CimInstance -Namespace root\WMI -ClassName MS_SystemInformation -ErrorAction SilentlyContinue | Select-Object -First 1 } catch {}
$bb   = Get-CimInstance Win32_BaseBoard
$bios = Get-CimInstance Win32_BIOS
$cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1
$cv   = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$sb   = try { if (Confirm-SecureBootUEFI) {'Activado'} else {'Desactivado'} } catch {'No disponible'}
$fw   = 0
try { $fw = [int](Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control' -Name PEFirmwareType -ErrorAction SilentlyContinue).PEFirmwareType } catch {}
if (-not $fw) {
  try {
    $secboot = Get-CimInstance -Namespace root\Microsoft\Windows\Storage -ClassName MSFT_Disk -ErrorAction SilentlyContinue | Where-Object { $_.IsBoot -eq $true } | Select-Object -First 1
    if ($secboot) { if ($secboot.PartitionStyle -eq "GPT") { $fw = 2 } else { $fw = 1 } }
  } catch {}
}
if (-not $fw) {
  try {
    $bcd = bcdedit /enum '{bootmgr}' 2>$null | Out-String
    if ($bcd -match 'winload\.efi' -or $bcd -match '\.efi') { $fw = 2 }
    elseif ($bcd -match 'winload\.exe') { $fw = 1 }
  } catch {}
}
$ram  = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
          [PSCustomObject]@{ capacity=[int64]$_.Capacity; speed=[int]$_.Speed;
            cspeed=[int]$_.ConfiguredClockSpeed; mfr="$($_.Manufacturer)"; pn="$($_.PartNumber)";
            slot="$($_.DeviceLocator)"; smt=[int]$_.SMBIOSMemoryType; ff=[int]$_.FormFactor;
            ctype=[int]$_.MemoryType } })
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
          [PSCustomObject]@{ name="$($_.Name)"; ram=[int64]$_.AdapterRAM;
            driver="$($_.DriverVersion)"; proc="$($_.VideoProcessor)";
            hres=[int]$_.CurrentHorizontalResolution; vres=[int]$_.CurrentVerticalResolution;
            refresh=[int]$_.CurrentRefreshRate } })
$disks = @(Get-CimInstance Win32_DiskDrive | ForEach-Object {
          [PSCustomObject]@{ idx=[int]$_.Index; model="$($_.Model)"; size=[int64]$_.Size;
            iface="$($_.InterfaceType)"; media="$($_.MediaType)";
            serial="$(($_.SerialNumber).Trim())"; partitions=[int]$_.Partitions;
            status="$($_.Status)"; fw="$($_.FirmwareRevision)"; caption="$($_.Caption)";
            pnpid="$($_.PNPDeviceID)"; sectors=[int64]$_.TotalSectors;
            bytesPerSector=[int]$_.BytesPerSector; cyl=[int64]$_.TotalCylinders;
            heads=[int]$_.TotalHeads; tracks=[int64]$_.TotalTracks } })
# Mapeo partición → disco físico
$diskMap = @{}
try {
  Get-CimInstance Win32_DiskDriveToDiskPartition | ForEach-Object {
    $diskMap[$_.Dependent.DeviceID] = $_.Antecedent.DeviceID
  }
  Get-CimInstance Win32_LogicalDiskToPartition | ForEach-Object {
    $logical = $_.Dependent.DeviceID
    $partid  = $_.Antecedent.DeviceID
    $physical = $diskMap[$partid]
    if ($physical) { $diskMap["LOG_" + $logical] = $physical }
  }
} catch {}
$vols = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
          $phys = $diskMap["LOG_" + $_.DeviceID]
          $diskIdx = -1
          if ($phys) {
            $m = [regex]::Match($phys, '\d+')
            if ($m.Success) { $diskIdx = [int]$m.Value }
          }
          [PSCustomObject]@{ id="$($_.DeviceID)"; fs="$($_.FileSystem)"; vname="$($_.VolumeName)";
            size=[int64]$_.Size; free=[int64]$_.FreeSpace; diskIdx=$diskIdx } })
$pd = @()
try { $pd = @(Get-PhysicalDisk | ForEach-Object {
          [PSCustomObject]@{ num=[int]$_.DeviceID; fn="$($_.FriendlyName)";
            media="$($_.MediaType)"; bus="$($_.BusType)";
            size=[int64]$_.Size; health="$($_.HealthStatus)"; opstatus="$($_.OperationalStatus)";
            spindle=[int]$_.SpindleSpeed; allocSize=[int64]$_.AllocatedSize;
            usage="$($_.Usage)"; mfr="$($_.Manufacturer)";
            partStyle="$($_.PartitionStyle)" } }) } catch {}
$nics = @(Get-CimInstance Win32_NetworkAdapter -Filter "NetEnabled=true" | ForEach-Object {
          $cfg = Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "Index=$($_.Index)";
          [PSCustomObject]@{ name="$($_.NetConnectionID)"; desc="$($_.Name)"; mac="$($_.MACAddress)";
            speed=[int64]$_.Speed; ip=@($cfg.IPAddress) -match '\d+\.\d+\.\d+\.\d+' -join ',' } })
$batt = $null
try {
  $b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
  $bs = Get-CimInstance -Namespace root\WMI -Class BatteryStaticData -ErrorAction SilentlyContinue | Select-Object -First 1
  $bfc = Get-CimInstance -Namespace root\WMI -Class BatteryFullChargedCapacity -ErrorAction SilentlyContinue | Select-Object -First 1
  $bcc = Get-CimInstance -Namespace root\WMI -Class BatteryCycleCount -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($b) {
    $batt = [PSCustomObject]@{
      name="$($b.Name)"; chem="$($b.Chemistry)"; designCap=[int]$bs.DesignedCapacity;
      fullCap=[int]$bfc.FullChargedCapacity; cycles=[int]$bcc.CycleCount;
      mfr="$($bs.ManufactureName)"; serial="$($bs.SerialNumber)";
      voltage=[int]$b.DesignVoltage; status="$($b.Status)";
    }
  }
} catch {}
[PSCustomObject]@{
  osCaption="$($os.Caption)"; osVersion="$($os.Version)"; osBuild="$($os.BuildNumber)";
  osUBR="$($cv.UBR)"; osDisplay="$($cv.DisplayVersion)"; osVendor="$($os.Manufacturer)";
  osArch="$($os.OSArchitecture)"; osInstall="$($os.InstallDate)"; osBoot="$($os.LastBootUpTime)";
  osUser="$($os.RegisteredUser)"; winDir="$($os.WindowsDirectory)"; sysDir="$($os.SystemDirectory)";
  totalVisibleKB=[int64]$os.TotalVisibleMemorySize; locale="$($os.Locale)"; countryCode="$($os.CountryCode)";
  csName="$($cs.Name)"; csMfr="$($cs.Manufacturer)"; csModel="$($cs.Model)";
  csType="$($cs.SystemType)"; csSKU="$($cs.SystemSKUNumber)"; csDomain="$($cs.Domain)";
  csRole="$($cs.PCSystemType)"; csUser="$($cs.UserName)"; csVirt="$($cs.HypervisorPresent)";
  csTotalRAM=[int64]$cs.TotalPhysicalMemory;
  cspIdNum="$($csp.IdentifyingNumber)"; cspVersion="$($csp.Version)"; cspUUID="$($csp.UUID)";
  msiSKU="$($msi.SystemSKU)"; msiFamily="$($msi.SystemFamily)"; msiBaseVer="$($msi.BaseBoardVersion)";
  bbMfr="$($bb.Manufacturer)"; bbProduct="$($bb.Product)"; bbSerial="$($bb.SerialNumber)"; bbVersion="$($bb.Version)";
  biosMfr="$($bios.Manufacturer)"; biosVer="$($bios.SMBIOSBIOSVersion)"; biosDate="$($bios.ReleaseDate)";
  biosSerial="$($bios.SerialNumber)"; smbMaj=[int]$bios.SMBIOSMajorVersion; smbMin=[int]$bios.SMBIOSMinorVersion;
  cpuName="$($cpu.Name)"; cpuMfr="$($cpu.Manufacturer)"; cpuArch=[int]$cpu.Architecture;
  cpuCores=[int]$cpu.NumberOfCores; cpuThreads=[int]$cpu.NumberOfLogicalProcessors;
  cpuMaxClock=[int]$cpu.MaxClockSpeed; cpuSocket="$($cpu.SocketDesignation)"; cpuL2=[int]$cpu.L2CacheSize; cpuL3=[int]$cpu.L3CacheSize;
  cpuId="$($cpu.ProcessorId)"; cpuVirt=[bool]$cpu.VirtualizationFirmwareEnabled;
  secureBoot="$sb"; firmware=[int]$fw;
  ram=$ram; gpus=$gpus; disks=$disks; vols=$vols; pd=$pd; nics=$nics; batt=$batt
} | ConvertTo-Json -Depth 6 -Compress
"""

def _fmt_cimdate(s):
    if not s:
        return "—"
    s = str(s)
    import re
    m = re.search(r"(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?", s)
    if m:
        y, mo, d = m.group(1), m.group(2), m.group(3)
        hh, mm = m.group(4) or "", m.group(5) or ""
        return f"{d}/{mo}/{y}" + (f" {hh}:{mm}" if hh else "")
    m2 = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m2:
        return f"{m2.group(3)}/{m2.group(2)}/{m2.group(1)}"
    return "—"

_STATIC = {}
_PREV_DISK_IO = {}
_PREV_NET_IO = {}
_PREV_T = 0.0

def _build_static_windows():
    d = _ps_json(PS_STATIC)
    if not d:
        return None
    arch_map = {0: "x86", 5: "ARM", 9: "x64", 12: "ARM64"}
    # OS
    caption = _clean(d.get("osCaption"))
    edition = ""
    release = platform.release()
    import re
    m = re.match(r"(?:Microsoft\s+)?Windows\s+(\d+)\s*(.*)", caption, re.I) if caption != "—" else None
    if m:
        release, edition = m.group(1), m.group(2).strip()
    ubr = _clean(d.get("osUBR"), "")
    osver = _clean(d.get("osVersion"))
    if ubr:
        osver = f"{osver}.{ubr}"
    # RAM modules
    ram_mods = []
    for r in d.get("ram") or []:
        cap = int(r.get("capacity") or 0)
        if cap <= 0:
            continue
        spd = int(r.get("cspeed") or r.get("speed") or 0)
        smt = int(r.get("smt") or 0)
        ff  = int(r.get("ff") or 0)
        typ = {26: "DDR4", 34: "DDR5", 24: "DDR3", 20: "DDR2"}.get(smt, "DDR4" if spd >= 2133 else "DDR3")
        # FormFactor: 8=DIMM, 12=SODIMM, 13=FB-DIMM, 24=LPDDR
        form = {8: "DIMM", 12: "SODIMM", 13: "FB-DIMM", 22: "SO-DIMM", 24: "LPDDR"}.get(ff, "DIMM" if ff else "—")
        ram_mods.append({"capacityGB": round(cap / GB, 1), "speedMHz": spd,
                         "manufacturer": _clean(r.get("mfr")), "partNumber": _clean(r.get("pn")),
                         "slot": _clean(r.get("slot")), "memType": typ, "formFactor": form})
    # GPUs
    gpus = []
    for g in d.get("gpus") or []:
        name = _clean(g.get("name"))
        if name == "—":
            continue
        vb = int(g.get("ram") or 0)
        vram = f"{round(vb / GB, 1)} GB" if vb > 0 else "—"
        gpus.append({"name": name, "vram": vram, "driver": _clean(g.get("driver")),
                     "chip": _clean(g.get("proc")),
                     "res": f"{g.get('hres')}×{g.get('vres')}" if g.get("hres") else "",
                     "refresh": f"{g.get('refresh')} Hz" if g.get("refresh") else ""})
    # Physical disks: combine Get-PhysicalDisk (autoritativo MediaType+BusType) con DiskDrive
    pd_list = d.get("pd") or []
    disks = []
    raw_disks = d.get("disks") or []
    vols = d.get("vols") or []
    tot_used = sum(int(v.get("size", 0) or 0) - int(v.get("free", 0) or 0) for v in vols)
    sum_size = sum(int(x.get("size", 0) or 0) for x in raw_disks) or 1

    # Familias conocidas (modelo) → tipo de bus/disco
    HDD_PATTERNS = ("mq01", "mq02", "mq03", "mq04", "mq05",
                    "wd10", "wd20", "wd30", "wd40", "wd50", "wd60", "wd80",
                    "st1000", "st2000", "st3000", "st4000", "st500",
                    "hts", "hdwd", "dt01", "hd103", "hd203", "hd322")
    # Modelos M.2 NVMe: cualquier disco con estos patrones es NVMe
    NVME_PATTERNS = ("nvme", "sn530", "sn570", "sn730", "sn770", "sn850", "sn740", "sn770",
                     "snv2", "snv3", "snvs", "kc3000", "fury renegade", "nv1", "nv2", "nv3",
                     "a2000", "kc2500", "mp510", "mp600", "mp700", "p1", "p2", "p3", "p5",
                     "980", "990", "970 evo", "970 pro", "960 evo", "960 pro",
                     "wd_black sn", "wd blue sn", "wd green sn", "wd red sn",
                     "rocket", "rocket 4", "fire cuda 5", "firecuda 5",
                     "barracuda 5", "samsung pm", "samsung 9a1", "samsung pm9")
    # SSD SATA (no NVMe)
    SATA_SSD_PATTERNS = ("ssd", "solid state", "samsung 8", "samsung 87", "samsung 86",
                         "samsung 870", "samsung 860", "samsung 850", "samsung 840",
                         "crucial mx", "crucial bx", "kingston a", "kingston sa",
                         "wd blue 3d", "wd green 3d", "wd red sa")

    def classify_disk(model: str, pd_media: str, pd_bus: str, spindle: int) -> tuple[str, str]:
        """Devuelve (type, bus_effective)."""
        ml = model.lower()
        bm = (pd_bus or "").lower().strip()
        # 1) BusType NVMe es autoritativo
        if "nvme" in bm:
            return "NVMe", "NVMe"
        # 2) Patrones de modelo NVMe (M.2): refuerzan cuando BusType viene vacío/raro
        for p in NVME_PATTERNS:
            if p in ml:
                return "NVMe", "NVMe"
        # 3) Get-PhysicalDisk.MediaType
        m = pd_media.lower()
        # 4) Patrones SATA SSD
        for p in SATA_SSD_PATTERNS:
            if p in ml:
                return "SSD", "SATA"
        # 5) Patrones HDD
        for p in HDD_PATTERNS:
            if p in ml:
                return "HDD", bm or "SATA"
        # 6) MediaType final
        if m == "ssd":
            return "SSD", bm or "SATA"
        if m == "hdd":
            return "HDD", bm or "SATA"
        # 7) Spindle > 0 = mecánico
        if spindle > 0:
            return "HDD", bm or "SATA"
        # 8) Fallback
        return "SSD", bm or "SATA"

    # Calcular uso por disco a partir del mapeo partición→volumen (NO proporcional)
    used_per_disk = {}
    for v in vols:
        try:
            idx = int(v.get("diskIdx", -1))
            if idx >= 0:
                u = int(v.get("size", 0) or 0) - int(v.get("free", 0) or 0)
                used_per_disk[idx] = used_per_disk.get(idx, 0) + u
        except Exception:
            pass

    def _form_factor(model: str, bus: str, dt: str) -> str:
        ml = (model + " " + bus).lower()
        bl = bus.lower().strip()
        # NVMe SIEMPRE es M.2 NVMe (o U.2) — BusType es autoritativo
        if "nvme" in bl or "nvme" in ml:
            if "u.2" in ml or "u2" in ml: return "U.2 NVMe"
            return "M.2 NVMe PCIe"
        if dt == "NVMe":
            return "M.2 NVMe PCIe"
        if dt == "SSD":
            if "msata" in ml: return "mSATA"
            if "m.2" in ml or "sata m" in ml: return "M.2 SATA"
            if bl == "sata" or "sata" in ml:
                return "2.5\" SATA"
            return "SSD SATA"
        if dt == "HDD":
            if "2.5" in ml or any(p in ml for p in ("mq01","mq02","mq03","mq04","mq05","hts","wd5","wd10sp")): return "2.5\" HDD"
            return "3.5\" HDD"
        return "—"

    for i, dd in enumerate(raw_disks):
        size_b = int(dd.get("size") or 0)
        if size_b <= 0:
            continue
        model = _clean(dd.get("model"))
        idx = int(dd.get("idx", i))
        # Buscar el pd matching por num (index) si está disponible
        pdm = next((p for p in pd_list if int(p.get("num", -1)) == idx), pd_list[i] if i < len(pd_list) else {})
        media = _clean(pdm.get("media"), "")
        bus = _clean(pdm.get("bus"), "")
        spindle = int(pdm.get("spindle") or 0)
        health = _clean(pdm.get("health"), "—")
        opstatus = _clean(pdm.get("opstatus"), "")
        usage = _clean(pdm.get("usage"), "")
        part_style = _clean(pdm.get("partStyle"), "")
        alloc_size = int(pdm.get("allocSize") or 0)
        dt, eff_bus = classify_disk(model, media, bus, spindle)
        # Si el clasificador detectó NVMe pero el bus venía vacío/erróneo, corrígelo
        if dt == "NVMe" and bus.lower() != "nvme":
            bus = "NVMe"
        # Uso real por disco
        used_b = used_per_disk.get(idx, 0)
        if used_b == 0 and tot_used:
            used_b = int(tot_used * (size_b / sum_size))
        # Especificaciones extra
        iface = _clean(dd.get("iface"), "")
        fw_rev = _clean(dd.get("fw"), "")
        sectors = int(dd.get("sectors") or 0)
        bps = int(dd.get("bytesPerSector") or 0)
        status = _clean(dd.get("status"), "")
        partitions_count = int(dd.get("partitions") or 0)
        # Tasa teórica
        bus_speed = ""
        bm = bus.lower()
        if "nvme" in bm:
            bus_speed = "~3500–7000 MB/s (PCIe NVMe)"
        elif bm == "sata":
            bus_speed = "~550 MB/s (SATA III)"
        elif "usb" in bm:
            bus_speed = "~400 MB/s (USB 3.x)"
        disks.append({
            "model": model, "sizeGB": round(size_b / GB, 1), "type": dt,
            "formFactor": _form_factor(model, bus, dt),
            "serial": _clean(dd.get("serial")), "health": health, "bus": bus or "—",
            "interface": iface or "—", "firmware": fw_rev or "—",
            "status": status or "—", "opStatus": opstatus or "—",
            "usage": usage or "—", "partStyle": part_style or "—",
            "partitions": partitions_count, "spindle": spindle,
            "sectors": sectors, "bytesPerSector": bps,
            "allocSizeGB": round(alloc_size / GB, 1) if alloc_size else 0,
            "busSpeed": bus_speed,
            "usedGB": round(used_b / GB, 1), "freeGB": round((size_b - used_b) / GB, 1),
            "usedPct": round(used_b / size_b * 100, 1) if used_b else 0.0,
            "diskIdx": idx,
            "readBytesPS": 0, "writeBytesPS": 0,
        })
    # Logical volumes
    volumes = []
    for v in vols:
        size_b = int(v.get("size") or 0)
        free_b = int(v.get("free") or 0)
        if size_b <= 0:
            continue
        volumes.append({"mount": _clean(v.get("id")), "fs": _clean(v.get("fs")),
                        "label": _clean(v.get("vname"), ""), "sizeGB": round(size_b / GB, 1),
                        "usedGB": round((size_b - free_b) / GB, 1), "freeGB": round(free_b / GB, 1),
                        "usedPct": round((size_b - free_b) / size_b * 100, 1),
                        "diskIdx": int(v.get("diskIdx", -1))})
    # NICs
    nics = []
    for n in d.get("nics") or []:
        nm = _clean(n.get("name"), _clean(n.get("desc")))
        if nm == "—":
            continue
        spd = int(n.get("speed") or 0)
        ls = ""
        if spd > 0:
            ls = f"{round(spd / 1e9, 1)} Gbps" if spd >= 1e9 else f"{round(spd / 1e6)} Mbps"
        nics.append({"name": nm, "desc": _clean(n.get("desc")), "mac": _clean(n.get("mac"), ""),
                     "ip": (n.get("ip") or "").split(",")[0] if n.get("ip") else "",
                     "linkSpeed": ls, "bytesSentPS": 0, "bytesRecvPS": 0})
    fw = int(d.get("firmware") or 0)
    smb = f"{d.get('smbMaj')}.{d.get('smbMin')}" if d.get("smbMaj") else "—"
    try:
        node = uuid.getnode()
        mac_py = ":".join(f"{(node >> i) & 0xff:02X}" for i in range(40, -1, -8))
    except Exception:
        mac_py = "—"
    main_mac = nics[0]["mac"] if nics and nics[0]["mac"] else mac_py
    swap = psutil.swap_memory()
    static = {
        "cpuName": _clean(d.get("cpuName")), "cpuPhysical": int(d.get("cpuCores") or 0) or (psutil.cpu_count(logical=False) or 0),
        "cpuCores": int(d.get("cpuThreads") or 0) or (psutil.cpu_count(logical=True) or 0),
        "cpuArch": arch_map.get(int(d.get("cpuArch") or 9), "x64"),
        "cpuSocket": _clean(d.get("cpuSocket")), "cpuL2KB": int(d.get("cpuL2") or 0),
        "cpuL3KB": int(d.get("cpuL3") or 0), "cpuVirt": bool(d.get("cpuVirt")),
        "cpuMaxClock": int(d.get("cpuMaxClock") or 0),
        "totalRamGB": round(int(d.get("csTotalRAM") or psutil.virtual_memory().total) / GB, 1),
        "swapTotalGB": round(swap.total / GB, 1),
        "ramModules": ram_mods, "gpus": gpus,
        "gpuName": gpus[0]["name"] if gpus else "—", "gpuVram": gpus[0]["vram"] if gpus else "—",
        "disksBase": disks, "volumes": volumes, "netBase": nics,
        "osName": "Windows", "osRelease": release, "osVersion": osver, "osEdition": edition,
        "osDisplayVersion": _clean(d.get("osDisplay")), "osVendor": _clean(d.get("osVendor")),
        "osInstallDate": _fmt_cimdate(d.get("osInstall")), "osLastBoot": _fmt_cimdate(d.get("osBoot")),
        "regOwner": _clean(d.get("osUser")), "winDir": _clean(d.get("winDir")), "sysDir": _clean(d.get("sysDir")),
        "locale": _clean(d.get("locale")),
        "boardSerial": _clean(d.get("bbSerial"), _clean(d.get("biosSerial"))),
        "boardVendor": _clean(d.get("bbMfr")), "boardModel": _clean(d.get("bbProduct")),
        "systemVendor": _clean(d.get("csMfr")), "systemModel": _clean(d.get("csModel")),
        "systemType": _clean(d.get("csType")),
        "systemSKU": _clean(d.get("csSKU"), _clean(d.get("msiSKU"), _clean(d.get("cspIdNum"), _clean(d.get("msiFamily"))))),
        "domain": _clean(d.get("csDomain")), "hostname": _clean(d.get("csName"), socket.gethostname()),
        "macAddress": main_mac,
        "biosVendor": _clean(d.get("biosMfr")), "biosVersion": _clean(d.get("biosVer")),
        "biosDate": _fmt_cimdate(d.get("biosDate")), "smbiosVersion": smb,
        "biosMode": "UEFI" if fw == 2 else "Legacy BIOS" if fw == 1 else "—",
        "secureBoot": _clean(d.get("secureBoot")), "pythonVersion": platform.python_version(),
    }
    # Battery extras
    b = d.get("batt") or {}
    chem_map = {1: "Otro", 2: "Desconocida", 3: "Plomo-ácido", 4: "Níquel-Cadmio (NiCd)",
                5: "Níquel-Metal Hidruro (NiMH)", 6: "Ion-Litio (Li-Ion)",
                7: "Zinc-Aire", 8: "Polímero de Litio (LiPo)"}
    design = int(b.get("designCap") or 0)
    full = int(b.get("fullCap") or 0)
    cycles = int(b.get("cycles") or 0)
    if design or full or cycles:
        wear = round((1 - full / design) * 100, 1) if design and full else None
        static["batteryName"] = _clean(b.get("name"), "")
        static["batteryMfr"] = _clean(b.get("mfr"), "")
        static["batteryChemistry"] = chem_map.get(int(b.get("chem") or 0), "—")
        static["batteryDesignCapacityMWh"] = design
        static["batteryFullCapacityMWh"] = full
        static["batteryCycles"] = cycles
        static["batteryWearPct"] = wear
        static["batteryVoltageMV"] = int(b.get("voltage") or 0)
    return static

def _run_cmd(args, timeout=8):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="ignore")
        return r.stdout or ""
    except Exception:
        return ""

def _build_static_macos():
    """macOS via system_profiler + sysctl."""
    out = _run_cmd(["system_profiler", "-json", "SPHardwareDataType", "SPSoftwareDataType",
                    "SPDisplaysDataType", "SPNVMeDataType", "SPSerialATADataType",
                    "SPMemoryDataType", "SPPowerDataType", "SPNetworkDataType"], 30)
    try:
        data = json.loads(out) if out else {}
    except Exception:
        data = {}
    hw = (data.get("SPHardwareDataType") or [{}])[0]
    sw = (data.get("SPSoftwareDataType") or [{}])[0]
    mem_items = data.get("SPMemoryDataType") or []
    # CPU
    cpu_name = hw.get("chip_type") or hw.get("cpu_type") or platform.processor() or "—"
    cores_total = int(hw.get("number_processors", "0").split()[0] if isinstance(hw.get("number_processors"), str) else hw.get("number_processors") or 0) or (psutil.cpu_count(logical=False) or 0)
    threads = psutil.cpu_count(logical=True) or cores_total
    # RAM modules
    ram_mods = []
    for chunk in mem_items:
        for item in (chunk.get("_items") or []):
            try:
                size_str = (item.get("dimm_size") or "0 GB").split()
                cap = float(size_str[0]) if size_str else 0
                if cap <= 0:
                    continue
                spd_str = (item.get("dimm_speed") or "0 MHz").split()
                ram_mods.append({
                    "capacityGB": cap, "speedMHz": int(spd_str[0]) if spd_str and spd_str[0].isdigit() else 0,
                    "manufacturer": item.get("dimm_manufacturer") or "—",
                    "partNumber": item.get("dimm_part_number") or "—",
                    "slot": item.get("_name") or "—",
                    "memType": item.get("dimm_type") or "DDR4",
                    "formFactor": "SODIMM" if "MacBook" in (hw.get("machine_name") or "") else "DIMM",
                })
            except Exception:
                continue
    # GPUs
    gpus = []
    for g in data.get("SPDisplaysDataType") or []:
        nm = g.get("sppci_model") or g.get("_name") or ""
        if not nm:
            continue
        vram_str = g.get("spdisplays_vram") or g.get("spdisplays_vram_shared") or ""
        gpus.append({"name": nm, "vram": vram_str or "—",
                     "driver": g.get("spdisplays_metalfamily") or "Metal",
                     "chip": g.get("sppci_device_type") or "—",
                     "res": "", "refresh": ""})
    # Disks vía NVMe + SATA
    disks = []
    def parse_macos_disks(items, kind):
        for it in items:
            for d in (it.get("_items") or []):
                size = d.get("size_in_bytes") or 0
                try:
                    size_b = int(size)
                except Exception:
                    size_b = 0
                if size_b <= 0:
                    continue
                model = d.get("device_model") or d.get("_name") or "—"
                disks.append({
                    "model": model, "sizeGB": round(size_b / GB, 1),
                    "type": "NVMe" if kind == "nvme" else "SSD",
                    "formFactor": "M.2 NVMe PCIe" if kind == "nvme" else "2.5\" SATA",
                    "serial": d.get("device_serial") or "—",
                    "health": "Healthy", "bus": "NVMe" if kind == "nvme" else "SATA",
                    "interface": d.get("bsd_name") or "—",
                    "firmware": d.get("device_revision") or "—",
                    "status": "OK", "opStatus": "OK", "usage": "Auto", "partStyle": "GPT",
                    "partitions": 0, "spindle": 0, "sectors": 0, "bytesPerSector": 512,
                    "allocSizeGB": 0,
                    "busSpeed": "~3500–7000 MB/s (PCIe NVMe)" if kind == "nvme" else "~550 MB/s (SATA III)",
                    "usedGB": 0, "freeGB": round(size_b / GB, 1), "usedPct": 0.0,
                    "diskIdx": len(disks), "readBytesPS": 0, "writeBytesPS": 0,
                })
    parse_macos_disks(data.get("SPNVMeDataType") or [], "nvme")
    parse_macos_disks(data.get("SPSerialATADataType") or [], "sata")
    # Volumes vía psutil
    volumes = []
    for part in psutil.disk_partitions(all=False):
        try:
            u = psutil.disk_usage(part.mountpoint)
            volumes.append({"mount": part.mountpoint, "fs": part.fstype, "label": "",
                            "sizeGB": round(u.total / GB, 1), "usedGB": round(u.used / GB, 1),
                            "freeGB": round(u.free / GB, 1), "usedPct": round(u.percent, 1),
                            "diskIdx": -1})
        except Exception:
            pass
    # NICs
    nics = []
    try:
        node = uuid.getnode()
        mac_py = ":".join(f"{(node >> i) & 0xff:02X}" for i in range(40, -1, -8))
    except Exception:
        mac_py = "—"
    for name, addrs in psutil.net_if_addrs().items():
        if name == "lo0":
            continue
        ip = next((a.address for a in addrs if a.family == socket.AF_INET and not a.address.startswith("127.")), "")
        if not ip:
            continue
        mac_addr = next((a.address for a in addrs if getattr(a.family, "name", "") in ("AF_LINK", "AF_PACKET")), "")
        nics.append({"name": name, "desc": name, "mac": mac_addr or mac_py, "ip": ip,
                     "linkSpeed": "", "bytesSentPS": 0, "bytesRecvPS": 0})
    return {
        "cpuName": cpu_name, "cpuPhysical": cores_total, "cpuCores": threads,
        "cpuArch": platform.machine() or "arm64", "cpuSocket": "Integrated",
        "cpuL2KB": 0, "cpuL3KB": 0, "cpuVirt": True,
        "cpuMaxClock": 0,
        "totalRamGB": round(psutil.virtual_memory().total / GB, 1),
        "swapTotalGB": round(psutil.swap_memory().total / GB, 1),
        "ramModules": ram_mods, "gpus": gpus,
        "gpuName": gpus[0]["name"] if gpus else "—", "gpuVram": gpus[0]["vram"] if gpus else "—",
        "disksBase": disks, "volumes": volumes, "netBase": nics,
        "osName": "macOS", "osRelease": sw.get("os_version", "").split()[1] if sw.get("os_version") else platform.release(),
        "osVersion": sw.get("os_version") or platform.version(),
        "osEdition": sw.get("os_version", "").split("(")[0].strip() if sw.get("os_version") else "",
        "osDisplayVersion": sw.get("os_version") or "—",
        "osVendor": "Apple Inc.",
        "osInstallDate": "—",
        "osLastBoot": time.strftime("%d/%m/%Y %H:%M", time.localtime(psutil.boot_time())),
        "regOwner": sw.get("user_name") or "—", "winDir": "/System", "sysDir": "/usr/bin",
        "locale": sw.get("preferred_language") or "—",
        "boardSerial": hw.get("serial_number") or "—",
        "boardVendor": "Apple Inc.", "boardModel": hw.get("machine_model") or "—",
        "systemVendor": "Apple Inc.", "systemModel": hw.get("machine_name") or hw.get("machine_model") or "—",
        "systemType": platform.machine(), "systemSKU": hw.get("model_number") or "—",
        "domain": "WORKGROUP",
        "hostname": socket.gethostname(),
        "macAddress": nics[0]["mac"] if nics else mac_py,
        "biosVendor": "Apple Inc.", "biosVersion": hw.get("boot_rom_version") or "—",
        "biosDate": "—", "smbiosVersion": "—", "biosMode": "UEFI",
        "secureBoot": "Activado" if hw.get("activation_lock_status") else "—",
        "pythonVersion": platform.python_version(),
    }

def _build_static_linux():
    """Linux via /sys/class/dmi + lscpu + lsblk + dmidecode."""
    def _read(path, default="—"):
        try:
            return open(path).read().strip() or default
        except Exception:
            return default

    cpu_name = "—"
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("model name"):
                    cpu_name = line.split(":", 1)[1].strip(); break
    except Exception:
        pass
    # lscpu
    lscpu_out = _run_cmd(["lscpu"])
    lscpu = {}
    for line in lscpu_out.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            lscpu[k.strip()] = v.strip()
    l2 = 0; l3 = 0
    try:
        if "L2 cache" in lscpu:
            s = lscpu["L2 cache"].split()[0]
            l2 = int(float(s) * (1024 if "M" in lscpu["L2 cache"] else 1))
        if "L3 cache" in lscpu:
            s = lscpu["L3 cache"].split()[0]
            l3 = int(float(s) * (1024 if "M" in lscpu["L3 cache"] else 1))
    except Exception:
        pass
    # Discos vía lsblk
    disks = []
    lsblk = _run_cmd(["lsblk", "-J", "-O", "-b"])
    try:
        lb = json.loads(lsblk) if lsblk else {}
    except Exception:
        lb = {}
    for d in lb.get("blockdevices", []):
        if d.get("type") != "disk":
            continue
        size_b = int(d.get("size") or 0)
        if size_b <= 0:
            continue
        model = (d.get("model") or "").strip() or d.get("name") or "—"
        rota = d.get("rota") in (True, "1", 1)
        tran = (d.get("tran") or "").lower()
        if "nvme" in tran or "nvme" in d.get("name", "").lower():
            dt = "NVMe"; bus = "NVMe"; ff = "M.2 NVMe PCIe"
        elif rota:
            dt = "HDD"; bus = tran or "SATA"; ff = "3.5\" HDD"
        else:
            dt = "SSD"; bus = tran or "SATA"; ff = "2.5\" SATA"
        disks.append({
            "model": model, "sizeGB": round(size_b / GB, 1), "type": dt, "formFactor": ff,
            "serial": d.get("serial") or "—",
            "health": "Healthy", "bus": bus,
            "interface": tran or "—",
            "firmware": d.get("rev") or "—",
            "status": "OK", "opStatus": "OK", "usage": "Auto",
            "partStyle": d.get("pttype") or "—",
            "partitions": len(d.get("children") or []), "spindle": 7200 if rota else 0,
            "sectors": int(d.get("size") or 0) // int(d.get("phy-sec") or 512),
            "bytesPerSector": int(d.get("phy-sec") or 512),
            "allocSizeGB": 0,
            "busSpeed": "~3500–7000 MB/s (PCIe NVMe)" if dt == "NVMe" else "~550 MB/s (SATA III)" if not rota else "~150 MB/s (HDD)",
            "usedGB": 0, "freeGB": round(size_b / GB, 1), "usedPct": 0.0,
            "diskIdx": len(disks), "readBytesPS": 0, "writeBytesPS": 0,
        })
    # Volumes
    volumes = []
    for part in psutil.disk_partitions(all=False):
        if any(part.mountpoint.startswith(x) for x in ("/snap", "/boot/efi", "/proc", "/sys")):
            continue
        try:
            u = psutil.disk_usage(part.mountpoint)
            volumes.append({"mount": part.mountpoint, "fs": part.fstype, "label": "",
                            "sizeGB": round(u.total / GB, 1), "usedGB": round(u.used / GB, 1),
                            "freeGB": round(u.free / GB, 1), "usedPct": round(u.percent, 1),
                            "diskIdx": -1})
        except Exception:
            pass
    # NICs
    nics = []
    try:
        node = uuid.getnode()
        mac_py = ":".join(f"{(node >> i) & 0xff:02X}" for i in range(40, -1, -8))
    except Exception:
        mac_py = "—"
    for name, addrs in psutil.net_if_addrs().items():
        if name == "lo":
            continue
        ip = next((a.address for a in addrs if a.family == socket.AF_INET and not a.address.startswith("127.")), "")
        if not ip:
            continue
        mac_addr = next((a.address for a in addrs if getattr(a.family, "name", "") in ("AF_LINK", "AF_PACKET")), "")
        nics.append({"name": name, "desc": name, "mac": mac_addr or mac_py, "ip": ip,
                     "linkSpeed": "", "bytesSentPS": 0, "bytesRecvPS": 0})
    # DMI info
    boot_mode = "UEFI" if os.path.exists("/sys/firmware/efi") else "Legacy BIOS"
    # GPU vía lspci
    gpus = []
    lspci = _run_cmd(["lspci", "-nn"])
    for line in lspci.splitlines():
        if "VGA" in line or "3D controller" in line or "Display controller" in line:
            name = line.split(":", 2)[-1].strip()
            gpus.append({"name": name, "vram": "—", "driver": "—", "chip": "—", "res": "", "refresh": ""})
    return {
        "cpuName": cpu_name, "cpuPhysical": psutil.cpu_count(logical=False) or 0,
        "cpuCores": psutil.cpu_count(logical=True) or 0,
        "cpuArch": platform.machine() or "x86_64",
        "cpuSocket": lscpu.get("Socket(s)", "—"),
        "cpuL2KB": l2, "cpuL3KB": l3,
        "cpuVirt": lscpu.get("Virtualization", "") != "",
        "cpuMaxClock": int(float(lscpu.get("CPU max MHz", "0").split(",")[0] or 0)) if lscpu.get("CPU max MHz") else 0,
        "totalRamGB": round(psutil.virtual_memory().total / GB, 1),
        "swapTotalGB": round(psutil.swap_memory().total / GB, 1),
        "ramModules": [], "gpus": gpus,
        "gpuName": gpus[0]["name"] if gpus else "—", "gpuVram": gpus[0]["vram"] if gpus else "—",
        "disksBase": disks, "volumes": volumes, "netBase": nics,
        "osName": "Linux", "osRelease": _read("/etc/os-release").split("PRETTY_NAME=")[-1].split("\n")[0].strip('"') or platform.release(),
        "osVersion": platform.version(),
        "osEdition": _read("/etc/os-release").split("NAME=")[-1].split("\n")[0].strip('"') if "NAME=" in _read("/etc/os-release") else "",
        "osDisplayVersion": _read("/etc/os-release").split("VERSION_ID=")[-1].split("\n")[0].strip('"') if "VERSION_ID=" in _read("/etc/os-release") else "—",
        "osVendor": "GNU/Linux",
        "osInstallDate": "—",
        "osLastBoot": time.strftime("%d/%m/%Y %H:%M", time.localtime(psutil.boot_time())),
        "regOwner": os.environ.get("USER") or "—",
        "winDir": "/usr", "sysDir": "/usr/bin",
        "locale": os.environ.get("LANG") or "—",
        "boardSerial": _read("/sys/class/dmi/id/board_serial", _read("/sys/class/dmi/id/product_serial")),
        "boardVendor": _read("/sys/class/dmi/id/board_vendor"),
        "boardModel": _read("/sys/class/dmi/id/board_name"),
        "systemVendor": _read("/sys/class/dmi/id/sys_vendor"),
        "systemModel": _read("/sys/class/dmi/id/product_name"),
        "systemType": platform.machine(),
        "systemSKU": _read("/sys/class/dmi/id/product_sku"),
        "domain": "WORKGROUP",
        "hostname": socket.gethostname(),
        "macAddress": nics[0]["mac"] if nics else mac_py,
        "biosVendor": _read("/sys/class/dmi/id/bios_vendor"),
        "biosVersion": _read("/sys/class/dmi/id/bios_version"),
        "biosDate": _read("/sys/class/dmi/id/bios_date"),
        "smbiosVersion": "—", "biosMode": boot_mode,
        "secureBoot": "—",
        "pythonVersion": platform.python_version(),
    }

def _build_static_fallback():
    """Generic fallback via psutil (used when native collection fails)."""
    swap = psutil.swap_memory()
    disks = []
    seen = set()
    for part in psutil.disk_partitions(all=False):
        if part.device in seen:
            continue
        seen.add(part.device)
        try:
            u = psutil.disk_usage(part.mountpoint)
            disks.append({"model": part.device, "sizeGB": round(u.total / GB, 1), "type": part.fstype or "Volume",
                          "serial": "—", "health": "—", "bus": "—", "usedGB": round(u.used / GB, 1),
                          "freeGB": round(u.free / GB, 1), "usedPct": round(u.percent, 1),
                          "readBytesPS": 0, "writeBytesPS": 0})
        except Exception:
            pass
    try:
        node = uuid.getnode()
        mac = ":".join(f"{(node >> i) & 0xff:02X}" for i in range(40, -1, -8))
    except Exception:
        mac = "—"
    return {
        "cpuName": platform.processor() or "—", "cpuPhysical": psutil.cpu_count(logical=False) or 0,
        "cpuCores": psutil.cpu_count(logical=True) or 0, "cpuArch": platform.machine() or "x64",
        "cpuSocket": "—", "cpuL2KB": 0, "cpuL3KB": 0, "cpuVirt": False, "cpuMaxClock": 0,
        "totalRamGB": round(psutil.virtual_memory().total / GB, 1), "swapTotalGB": round(swap.total / GB, 1),
        "ramModules": [], "gpus": [], "gpuName": "—", "gpuVram": "—",
        "disksBase": disks, "volumes": [], "netBase": [],
        "osName": platform.system(), "osRelease": platform.release(), "osVersion": platform.version(),
        "osEdition": "", "osDisplayVersion": "—", "osVendor": "—", "osInstallDate": "—",
        "osLastBoot": time.strftime("%d/%m/%Y %H:%M", time.localtime(psutil.boot_time())),
        "regOwner": "—", "winDir": "—", "sysDir": "—", "locale": "—",
        "boardSerial": "—", "boardVendor": "—", "boardModel": "—", "systemVendor": "—", "systemModel": "—",
        "systemType": "—", "systemSKU": "—", "domain": "—", "hostname": socket.gethostname(), "macAddress": mac,
        "biosVendor": "—", "biosVersion": "—", "biosDate": "—", "smbiosVersion": "—", "biosMode": "—",
        "secureBoot": "—", "pythonVersion": platform.python_version(),
    }

def load_static():
    global _STATIC
    log.info("Recopilando hardware…")
    s = None
    try:
        if sys.platform == "win32":
            log.info("Plataforma: Windows (CIM/PowerShell)")
            s = _build_static_windows()
        elif sys.platform == "darwin":
            log.info("Plataforma: macOS (system_profiler)")
            s = _build_static_macos()
        elif sys.platform.startswith("linux"):
            log.info("Plataforma: Linux (DMI + lsblk + lscpu)")
            s = _build_static_linux()
    except Exception as e:
        log.error("Recolección nativa falló: %s", e)
        s = None
    if not s:
        log.info("Usando fallback psutil básico.")
        s = _build_static_fallback()
    _STATIC = s
    log.info("Listo: %s | %s GB | %d discos | host=%s | serial=%s",
             _STATIC["cpuName"], _STATIC["totalRamGB"], len(_STATIC["disksBase"]),
             _STATIC["hostname"], _STATIC["boardSerial"])

async def handler(ws):
    global _PREV_DISK_IO, _PREV_NET_IO, _PREV_T
    log.info("✅ Conectado: %s", ws.remote_address)
    try:
        while True:
            now = time.monotonic()
            dt = max(now - _PREV_T, 0.1) if _PREV_T else 1.0
            _PREV_T = now
            bat = psutil.sensors_battery()
            freq = psutil.cpu_freq()
            vm = psutil.virtual_memory()
            swap = psutil.swap_memory()
            cur_disk = psutil.disk_io_counters(perdisk=True) or {}
            # Calcular I/O por disco (psutil usa keys "PhysicalDrive0", "PhysicalDrive1"...)
            per_disk_rw = {}
            for key, io in cur_disk.items():
                prev = _PREV_DISK_IO.get(key)
                if not prev:
                    continue
                r = max(0, io.read_bytes - prev.read_bytes)
                w = max(0, io.write_bytes - prev.write_bytes)
                import re as _re
                m = _re.search(r"(\d+)$", key)
                idx = int(m.group(1)) if m else -1
                per_disk_rw[idx] = (r, w)
            _PREV_DISK_IO = dict(cur_disk)
            disks_live = []
            for dd in _STATIC["disksBase"]:
                nd = dict(dd)
                r, w = per_disk_rw.get(int(dd.get("diskIdx", -1)), (0, 0))
                nd["readBytesPS"] = round(r / dt)
                nd["writeBytesPS"] = round(w / dt)
                disks_live.append(nd)
            cur_net = psutil.net_io_counters(pernic=True) or {}
            nics_live = []
            for a in _STATIC["netBase"]:
                na = dict(a)
                io = cur_net.get(a["name"]); pio = _PREV_NET_IO.get(a["name"])
                if io and pio:
                    na["bytesSentPS"] = max(0, round((io.bytes_sent - pio.bytes_sent) / dt))
                    na["bytesRecvPS"] = max(0, round((io.bytes_recv - pio.bytes_recv) / dt))
                nics_live.append(na)
            _PREV_NET_IO = dict(cur_net)
            temps = {}
            try:
                for chip, entries in (psutil.sensors_temperatures() or {}).items():
                    for e in entries:
                        if e.current:
                            temps[f"{chip}/{e.label or 'temp'}"] = round(e.current, 1)
            except Exception:
                pass
            payload = {
                "cpu_usage": psutil.cpu_percent(interval=None),
                "cpu_per_core": psutil.cpu_percent(percpu=True),
                "ram_usage": vm.percent, "ram_used_gb": round(vm.used / GB, 2),
                "ram_available_gb": round(vm.available / GB, 2),
                "swap_usage": swap.percent, "swap_used_gb": round(swap.used / GB, 2),
                "battery": round(bat.percent, 1) if bat else "N/A",
                "battery_plugged": bat.power_plugged if bat else None,
                "battery_secsleft": bat.secsleft if bat and bat.secsleft not in (psutil.POWER_TIME_UNLIMITED, psutil.POWER_TIME_UNKNOWN) else None,
                "cpu_freq_mhz": round(freq.current) if freq else None,
                "cpu_freq_max_mhz": (round(freq.max) if freq and freq.max else None) or (_STATIC.get("cpuMaxClock") or None),
                "uptime_secs": int(time.time() - psutil.boot_time()),
                "temps": temps, "disks": disks_live, "netAdapters": nics_live,
                **{k: v for k, v in _STATIC.items() if k not in ("disksBase", "netBase")},
            }
            await ws.send(json.dumps(payload, default=str))
            await asyncio.sleep(INTERVAL)
    except websockets.exceptions.ConnectionClosed:
        log.info("❌ Desconectado: %s", ws.remote_address)
    except Exception as e:
        log.error("Error: %s", e)

async def main():
    # Mata cualquier instancia previa ANTES de intentar nada
    log.info("Verificando puerto %d…", PORT)
    if _port_in_use(PORT):
        log.info("Puerto %d ocupado; deteniendo todo lo que lo retenga…", PORT)
        _kill_stale_instances()
        for _ in range(15):
            if not _port_in_use(PORT):
                break
            time.sleep(0.4)
        if _port_in_use(PORT):
            log.error("El puerto sigue ocupado por otro proceso. Reinicia el equipo o ciérralo manualmente.")
            return
    load_static()
    log.info("📡 Escuchando en ws://localhost:%d", PORT)
    sock = None
    for _ in range(5):
        try:
            sock = _make_server_socket(PORT); break
        except OSError:
            _kill_stale_instances(); time.sleep(1.0)
    if sock is None:
        log.error("No se pudo abrir el puerto %d.", PORT); return
    async with websockets.serve(handler, sock=sock, ping_interval=20, ping_timeout=20):
        await asyncio.get_running_loop().create_future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
