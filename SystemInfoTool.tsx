"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import React from "react";
import { createPortal } from "react-dom";
import { useApp } from "@/context/AppContext";
import {
  Cpu, MemoryStick, HardDrive, Wifi, HelpCircle, X, Printer,
  CheckCircle2, Activity, Monitor, Layers, Globe, Battery, Info,
  Sparkles, Zap, BarChart3, Download, MonitorSmartphone,
  Network, Shield, Server, PlugZap, AlertCircle,
} from "lucide-react";

/* ══════════════════════ TYPES ══════════════════════ */
type Tab = "essential" | "engineering";
type AgentStatus = "disconnected" | "connecting" | "connected" | "error";

interface SystemSnapshot {
  os: string; osVersionHint: string; browser: string; browserVersion: string;
  arch: string; cpuCores: number; deviceMemoryGB: number | null;
  gpuRenderer: string; gpuVendor: string; webglVersion: string;
  screenW: number; screenH: number; screenAvailW: number; screenAvailH: number;
  dpr: number; colorDepth: number; touchPoints: number;
  connectionType: string; connectionDownlink: number | null; connectionRtt: number | null;
  saveData: boolean; language: string; languages: string[];
  timezone: string; cookiesEnabled: boolean;
  storageEstimateGB: number | null; storageUsedGB: number | null;
  batteryLevel: number | null; batteryCharging: boolean | null;
  online: boolean; hdr: boolean; reducedMotion: boolean; prefersDark: boolean;
}

interface DiskInfo {
  model: string; sizeGB: number; type: string; serial?: string; health?: string; bus?: string;
  formFactor?: string; interface?: string; firmware?: string;
  status?: string; opStatus?: string; usage?: string; partStyle?: string;
  partitions?: number; spindle?: number; sectors?: number; bytesPerSector?: number;
  allocSizeGB?: number; busSpeed?: string; diskIdx?: number;
  usedGB?: number; freeGB?: number; usedPct?: number;
  readBytesPS?: number; writeBytesPS?: number;
}
interface RamModule {
  capacityGB: number; speedMHz: number; manufacturer: string;
  partNumber: string; memType?: string; slot?: string; formFactor?: string;
}
interface NetAdapter {
  name: string; mac?: string; linkSpeed?: string; desc?: string; ip?: string;
  bytesSentPS?: number; bytesRecvPS?: number;
}
interface GpuInfo { name: string; vram: string; driver?: string; chip?: string; res?: string; refresh?: string }
interface VolumeInfo { mount: string; fs: string; label?: string; sizeGB: number; usedGB: number; freeGB: number; usedPct: number; diskIdx?: number }

interface AgentPayload {
  cpu_usage: number; ram_usage: number; ram_used_gb: number; ram_available_gb?: number;
  swap_usage?: number; swap_used_gb?: number; swapTotalGB?: number;
  battery: number | "N/A"; battery_plugged: boolean | null; battery_secsleft?: number | null;
  cpu_freq_mhz: number | null; cpu_freq_max_mhz?: number | null;
  cpu_per_core?: number[]; temps?: Record<string, number>; uptime_secs?: number;
  cpuName: string; cpuCores: number; cpuPhysical: number; cpuArch?: string;
  cpuSocket?: string; cpuL2KB?: number; cpuL3KB?: number; cpuVirt?: boolean; cpuMaxClock?: number;
  totalRamGB: number; ramModules: RamModule[];
  boardSerial: string; boardModel?: string; boardVendor?: string;
  systemModel?: string; systemVendor?: string;
  macAddress?: string; hostname?: string;
  disks: DiskInfo[]; volumes?: VolumeInfo[];
  gpus?: GpuInfo[]; gpuName?: string; gpuVram?: string;
  netAdapters?: NetAdapter[];
  osName: string; osVersion: string; osRelease: string; osEdition?: string; osDisplayVersion?: string;
  osVendor?: string; osInstallDate?: string; osLastBoot?: string; winDir?: string; sysDir?: string; regOwner?: string; locale?: string;
  biosVendor?: string; biosVersion?: string; biosDate?: string; smbiosVersion?: string;
  biosMode?: string; secureBoot?: string; systemType?: string; systemSKU?: string; domain?: string;
  pythonVersion?: string;
  batteryName?: string; batteryMfr?: string; batteryChemistry?: string;
  batteryDesignCapacityMWh?: number; batteryFullCapacityMWh?: number;
  batteryCycles?: number; batteryWearPct?: number; batteryVoltageMV?: number;
}

interface HistoryPoint { t: number; cpu: number; ram: number }

/* ══════════════════════ CONSTANTS ══════════════════════ */
const IC = "var(--brand-purple,#6366f1)";
const WS_URL = "ws://localhost:8765";
const HISTORY_MAX = 60;
const RECONNECT_MS = 2500;

/* ══════════════════════ BROWSER DATA ══════════════════════ */
function detectBrowser(ua: string) {
  const p: [RegExp, string][] = [
    [/Edg\/([\d.]+)/, "Edge"], [/OPR\/([\d.]+)/, "Opera"],
    [/Chrome\/([\d.]+)/, "Chrome"], [/Firefox\/([\d.]+)/, "Firefox"],
    [/Version\/([\d.]+).*Safari/, "Safari"],
  ];
  for (const [re, name] of p) { const m = ua.match(re); if (m) return { browser: name, version: m[1] }; }
  return { browser: "—", version: "—" };
}
function detectOS(ua: string, plat: string) {
  if (/Windows NT 10\.0/.test(ua)) return { os: "Windows", hint: "10 / 11" };
  if (/Windows NT 6\.3/.test(ua)) return { os: "Windows", hint: "8.1" };
  if (/Windows NT 6\.1/.test(ua)) return { os: "Windows", hint: "7" };
  if (/Windows/.test(ua)) return { os: "Windows", hint: "—" };
  if (/Mac OS X (\d+)[_.](\d+)/.test(ua)) { const m = ua.match(/Mac OS X (\d+)[_.](\d+)/); return { os: "macOS", hint: m ? `${m[1]}.${m[2]}` : "—" }; }
  if (/Android (\d+)/.test(ua)) { const m = ua.match(/Android (\d+)/); return { os: "Android", hint: m ? m[1] : "—" }; }
  if (/iPhone|iPad/.test(ua)) return { os: "iOS / iPadOS", hint: "—" };
  if (/Linux/.test(ua)) return { os: "Linux", hint: plat || "—" };
  return { os: plat || "—", hint: "—" };
}
function getGPU() {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return { renderer: "—", vendor: "—", webglVersion: "—" };
    const d = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: (d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) as string || "—",
      vendor: (d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)) as string || "—",
      webglVersion: gl.getParameter(gl.VERSION) as string || "—",
    };
  } catch { return { renderer: "—", vendor: "—", webglVersion: "—" }; }
}
async function collectSnapshot(): Promise<SystemSnapshot> {
  const ua = navigator.userAgent;
  const { browser, version } = detectBrowser(ua);
  const { os, hint } = detectOS(ua, (navigator as unknown as { platform: string }).platform ?? "");
  const gpu = getGPU();
  const conn = (navigator as unknown as { connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean } }).connection;
  let storageEstimateGB: number | null = null, storageUsedGB: number | null = null;
  try { const e = await navigator.storage?.estimate(); if (e?.quota) storageEstimateGB = +(e.quota / 1e9).toFixed(1); if (e?.usage) storageUsedGB = +(e.usage / 1e9).toFixed(2); } catch { /**/ }
  let batteryLevel: number | null = null, batteryCharging: boolean | null = null;
  try { const b = await (navigator as unknown as { getBattery?: () => Promise<{ level: number; charging: boolean }> }).getBattery?.(); if (b) { batteryLevel = Math.round(b.level * 100); batteryCharging = b.charging; } } catch { /**/ }
  return {
    os, osVersionHint: hint, browser, browserVersion: version,
    arch: /Win64|x64|WOW64/.test(ua) ? "x64" : /ARM/i.test(ua) ? "ARM" : "x86",
    cpuCores: navigator.hardwareConcurrency || 0,
    deviceMemoryGB: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
    gpuRenderer: gpu.renderer, gpuVendor: gpu.vendor, webglVersion: gpu.webglVersion,
    screenW: screen.width, screenH: screen.height,
    screenAvailW: screen.availWidth, screenAvailH: screen.availHeight,
    dpr: devicePixelRatio || 1, colorDepth: screen.colorDepth,
    touchPoints: navigator.maxTouchPoints || 0,
    connectionType: conn?.effectiveType ?? "—",
    connectionDownlink: conn?.downlink ?? null, connectionRtt: conn?.rtt ?? null,
    saveData: !!conn?.saveData, language: navigator.language,
    languages: [...(navigator.languages || [navigator.language])],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cookiesEnabled: navigator.cookieEnabled, storageEstimateGB, storageUsedGB,
    batteryLevel, batteryCharging, online: navigator.onLine,
    hdr: matchMedia?.("(dynamic-range: high)").matches ?? false,
    reducedMotion: matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    prefersDark: matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  };
}

/* ══════════════════════ HELPERS ══════════════════════ */
function cleanDiskModel(m: string): string {
  return m.replace(/^fixed (hard disk media|media)\s*/i, "").replace(/^(disk drive|hard disk)\s*/i, "").trim() || m;
}
function fmtBytes(b: number): string {
  if (b < 1024) return `${b.toFixed(1)} B/s`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB/s`;
  return `${(b / 1024 / 1024).toFixed(2)} MB/s`;
}
function diskType(model: string): "nvme" | "ssd" | "hdd" {
  const m = model.toLowerCase();
  if (m.includes("nvme") || m.includes("m.2")) return "nvme";
  if (m.includes("ssd") || m.includes("solid")) return "ssd";
  return "hdd";
}

/* ══════════════════════ SUB-COMPONENTS ══════════════════════ */

function Sparkline({ data, color, h = 44 }: { data: number[]; color: string; h?: number }) {
  if (data.length < 2) return <div style={{ height: h, background: "rgba(148,163,184,0.06)", borderRadius: 6 }} />;
  const W = 300;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * W).toFixed(1)},${(h - Math.min(v, 100) / 100 * h).toFixed(1)}`).join(" ");
  const id = `sg${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block", borderRadius: 6 }}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.28" /><stop offset="100%" stopColor={color} stopOpacity="0.02" /></linearGradient></defs>
      <polygon points={`0,${h} ${pts} ${W},${h}`} fill={`url(#${id})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Ring({ v, color, label, sub, size = 90 }: { v: number; color: string; label: string; sub?: string; size?: number }) {
  const R = size * 0.38; const C = 2 * Math.PI * R; const cx = size / 2;
  const sw = size * 0.082;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cx} r={R} fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth={sw} />
        <circle cx={cx} cy={cx} r={R} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(v, 100) / 100)} strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cx})`} style={{ transition: "stroke-dashoffset 0.6s ease" }} />
        <text x={cx} y={sub ? cx - 5 : cx + 1} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: size * 0.15, fontWeight: 900, fontFamily: "monospace", fill: color }}>{Math.round(v)}%</text>
        {sub && <text x={cx} y={cx + size * 0.135} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: size * 0.08, fill: "var(--text-muted)", fontFamily: "monospace" }}>{sub}</text>}
      </svg>
      <p style={{ fontSize: 9.5, fontWeight: 700, color: "var(--text-muted)", textAlign: "center", margin: 0 }}>{label}</p>
    </div>
  );
}

function Bar({ v, color, label, valLabel, thin }: { v: number; color: string; label: string; valLabel: string; thin?: boolean }) {
  return (
    <div style={{ marginBottom: thin ? 5 : 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: thin ? 9.5 : 10, fontWeight: 600, color: "var(--text-muted)" }}>{label}</span>
        <span style={{ fontSize: thin ? 9.5 : 10.5, fontWeight: 800, fontFamily: "monospace", color }}>{valLabel}</span>
      </div>
      <div style={{ height: thin ? 4 : 5, background: "rgba(148,163,184,0.14)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(v, 100)}%`, background: color, borderRadius: 999, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

function DiskBadge({ model }: { model: string }) {
  const t = diskType(model);
  if (t === "nvme") return <span style={{ fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 999, border: "1px solid rgba(139,92,246,0.4)", background: "rgba(139,92,246,0.12)", color: "#a78bfa", fontFamily: "monospace" }}>NVMe</span>;
  if (t === "ssd") return <span style={{ fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 999, border: "1px solid rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.1)", color: "#34d399", fontFamily: "monospace" }}>SSD</span>;
  return <span style={{ fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 999, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.1)", color: "#fbbf24", fontFamily: "monospace" }}>HDD</span>;
}

function Badge({ label, color = IC }: { label: string; color?: string }) {
  return <span style={{ fontSize: 8, fontWeight: 800, padding: "2px 6px", borderRadius: 999, border: `1px solid ${color}44`, background: `${color}18`, color, fontFamily: "monospace", letterSpacing: "0.04em" }}>{label}</span>;
}

function StatBox({ value, unit, label, color = IC }: { value: string; unit?: string; label: string; color?: string }) {
  return (
    <div style={{ background: "rgba(99,102,241,0.05)", borderRadius: 10, padding: "10px 8px", textAlign: "center", border: "1px solid rgba(99,102,241,0.1)" }}>
      <p style={{ margin: 0, fontSize: 16, fontWeight: 900, fontFamily: "monospace", color }}>
        {value}<span style={{ fontSize: 9, marginLeft: 2, fontWeight: 700 }}>{unit}</span>
      </p>
      <p style={{ margin: "2px 0 0", fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>{label}</p>
    </div>
  );
}

function PrintBlock({ title, badge, rows, wide }: { title: string; badge?: string; rows: { k: string; v: string }[]; wide?: boolean }) {
  const cols = wide ? 2 : 4;
  if (wide) {
    return (
      <table className={"si-pb-t si-pb-wide"}>
        <thead>
          <tr>
            <th colSpan={cols} className="si-pb-h-th">
              <span>{title}</span>
              {badge && <em>{badge}</em>}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="si-pb-tr">
              <td className="si-pb-k">{r.k}</td>
              <td className="si-pb-v">{r.v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  // 4-col: pares clave/valor
  const pairs: { k: string; v: string }[][] = [];
  for (let i = 0; i < rows.length; i += 2) {
    pairs.push([rows[i], rows[i + 1] || { k: "", v: "" }]);
  }
  return (
    <table className="si-pb-t">
      <thead>
        <tr>
          <th colSpan={cols} className="si-pb-h-th">
            <span>{title}</span>
            {badge && <em>{badge}</em>}
          </th>
        </tr>
      </thead>
      <tbody>
        {pairs.map((p, i) => (
          <tr key={i} className="si-pb-tr">
            <td className="si-pb-k">{p[0].k}</td>
            <td className="si-pb-v">{p[0].v}</td>
            <td className="si-pb-k">{p[1].k}</td>
            <td className="si-pb-v">{p[1].v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SH({ icon, title, badge, onHelp }: { icon: React.ReactNode; title: string; badge?: React.ReactNode; onHelp?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.18)", color: IC, flexShrink: 0 }}>{icon}</div>
      <p style={{ fontSize: 12.5, fontWeight: 900, color: "var(--text-main)", flex: 1, margin: 0 }}>{title}</p>
      {onHelp && (
        <button onClick={onHelp} style={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid var(--border-split)", background: "transparent", color: IC, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }} title="¿Qué tipo es y cuál comprar?">
          <HelpCircle style={{ width: 12, height: 12 }} />
        </button>
      )}
      {badge}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "5px 0", borderBottom: "1px solid var(--border-split)", gap: 8 }}>
      <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0, maxWidth: "50%" }}>{k}</span>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-main)", textAlign: "right", wordBreak: "break-all", fontFamily: "monospace" }}>{v}</span>
    </div>
  );
}

function RamStick({ speed, type, gb }: { speed: number; type: string; gb: number }) {
  return (
    <svg viewBox="0 0 200 46" style={{ width: "100%", maxWidth: 180, display: "block" }}>
      <rect x="2" y="12" width="196" height="24" rx="2.5" fill="#14532d" stroke="#22c55e" strokeWidth="0.7" />
      <rect x="6" y="15" width="85" height="8" rx="1.5" fill="#166534" />
      <text x="9" y="21.5" style={{ fontSize: 5.5, fill: "#86efac", fontFamily: "monospace", fontWeight: 700 }}>{type} {gb}GB@{speed}MHz</text>
      {[0,1,2,3,4,5,6,7].map(i => <rect key={i} x={100+i*11} y="15" width="9" height="8" rx="1.2" fill="#1e3a5f" stroke="#3b82f6" strokeWidth="0.5" />)}
      {[0,1,2,3,4,5,6,7].map(i => <rect key={i} x={100+i*11} y="26" width="9" height="8" rx="1.2" fill="#1e3a5f" stroke="#3b82f6" strokeWidth="0.5" />)}
      {Array.from({length:32},(_,i) => <rect key={i} x={6+i*5.9} y="36" width="2.8" height="7" rx="0.4" fill="#ca8a04" />)}
      <rect x="88" y="34" width="5" height="9" rx="1" fill="var(--bg-surface,#fff)" />
      <rect x="2" y="34" width="196" height="2" fill="#166534" />
    </svg>
  );
}

function NvmeSVG() {
  return (
    <svg viewBox="0 0 220 50" style={{ width: "100%", maxWidth: 200, display: "block" }}>
      <rect x="2" y="14" width="216" height="22" rx="3" fill="#1e3a8a" stroke="#3b82f6" strokeWidth="0.8" />
      <rect x="6" y="17" width="62" height="16" rx="1.5" fill="#1e293b" stroke="#475569" strokeWidth="0.4" />
      <text x="9" y="27" style={{ fontSize: 6, fill: "#93c5fd", fontFamily: "monospace", fontWeight: 700 }}>NAND Flash</text>
      <rect x="72" y="17" width="56" height="16" rx="1.5" fill="#1e293b" stroke="#475569" strokeWidth="0.4" />
      <text x="75" y="27" style={{ fontSize: 6, fill: "#93c5fd", fontFamily: "monospace", fontWeight: 700 }}>NAND Flash</text>
      <rect x="132" y="17" width="38" height="16" rx="1.5" fill="#7c2d12" stroke="#ea580c" strokeWidth="0.4" />
      <text x="138" y="27" style={{ fontSize: 5.5, fill: "#fdba74", fontFamily: "monospace", fontWeight: 700 }}>Controller</text>
      <rect x="174" y="20" width="22" height="10" rx="1" fill="#374151" />
      <text x="176" y="27" style={{ fontSize: 5, fill: "#d1d5db", fontFamily: "monospace", fontWeight: 700 }}>DRAM</text>
      {Array.from({length:38},(_,i) => <rect key={i} x={4+i*5.7} y="36" width="2.6" height="6" rx="0.3" fill="#ca8a04" />)}
      <rect x="106" y="34" width="6" height="10" rx="1" fill="var(--bg-surface,#fff)" />
      <text x="2" y="11" style={{ fontSize: 5, fill: "#6366f1", fontFamily: "monospace", fontWeight: 800 }}>M.2 NVMe PCIe</text>
    </svg>
  );
}

function SsdSataSVG() {
  return (
    <svg viewBox="0 0 220 60" style={{ width: "100%", maxWidth: 200, display: "block" }}>
      <rect x="2" y="6" width="216" height="48" rx="3" fill="#1f2937" stroke="#4b5563" strokeWidth="0.8" />
      <rect x="2" y="6" width="216" height="14" rx="3" fill="#374151" />
      <text x="8" y="16" style={{ fontSize: 6.5, fill: "#a78bfa", fontFamily: "monospace", fontWeight: 800 }}>SSD SATA 2.5"</text>
      <rect x="10" y="24" width="40" height="22" rx="2" fill="#0f172a" stroke="#1e293b" strokeWidth="0.4" />
      <text x="14" y="37" style={{ fontSize: 5, fill: "#94a3b8", fontFamily: "monospace" }}>NAND</text>
      <rect x="54" y="24" width="40" height="22" rx="2" fill="#0f172a" stroke="#1e293b" strokeWidth="0.4" />
      <text x="58" y="37" style={{ fontSize: 5, fill: "#94a3b8", fontFamily: "monospace" }}>NAND</text>
      <rect x="98" y="24" width="40" height="22" rx="2" fill="#0f172a" stroke="#1e293b" strokeWidth="0.4" />
      <text x="102" y="37" style={{ fontSize: 5, fill: "#94a3b8", fontFamily: "monospace" }}>NAND</text>
      <rect x="142" y="24" width="40" height="22" rx="2" fill="#0f172a" stroke="#1e293b" strokeWidth="0.4" />
      <text x="146" y="37" style={{ fontSize: 5, fill: "#94a3b8", fontFamily: "monospace" }}>NAND</text>
      <rect x="186" y="24" width="26" height="22" rx="2" fill="#7c2d12" stroke="#ea580c" strokeWidth="0.4" />
      <text x="190" y="37" style={{ fontSize: 5, fill: "#fdba74", fontFamily: "monospace", fontWeight: 700 }}>Ctrl</text>
      <rect x="180" y="48" width="34" height="6" fill="#0a0a0a" />
      <text x="183" y="53" style={{ fontSize: 4, fill: "#10b981", fontFamily: "monospace" }}>SATA III</text>
    </svg>
  );
}

function HddSVG() {
  return (
    <svg viewBox="0 0 220 60" style={{ width: "100%", maxWidth: 200, display: "block" }}>
      <rect x="2" y="4" width="216" height="52" rx="3" fill="#27272a" stroke="#52525b" strokeWidth="0.8" />
      <circle cx="80" cy="30" r="22" fill="#0f172a" stroke="#3f3f46" strokeWidth="0.6" />
      <circle cx="80" cy="30" r="18" fill="none" stroke="#a1a1aa" strokeWidth="0.3" opacity="0.7" />
      <circle cx="80" cy="30" r="13" fill="none" stroke="#a1a1aa" strokeWidth="0.3" opacity="0.5" />
      <circle cx="80" cy="30" r="8" fill="none" stroke="#a1a1aa" strokeWidth="0.3" opacity="0.3" />
      <circle cx="80" cy="30" r="3" fill="#71717a" />
      <line x1="155" y1="10" x2="92" y2="28" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="155" cy="10" r="3" fill="#52525b" />
      <rect x="120" y="38" width="80" height="14" rx="1.5" fill="#18181b" stroke="#3f3f46" strokeWidth="0.4" />
      <text x="124" y="47" style={{ fontSize: 6, fill: "#fbbf24", fontFamily: "monospace", fontWeight: 800 }}>HDD 3.5"</text>
      <text x="6" y="13" style={{ fontSize: 5, fill: "#a78bfa", fontFamily: "monospace", fontWeight: 700 }}>Mecánico (platos giratorios)</text>
    </svg>
  );
}

function DiskSVG({ type }: { type: string }) {
  const t = type.toLowerCase();
  if (t.includes("nvme")) return <NvmeSVG />;
  if (t.includes("ssd") || t.includes("solid")) return <SsdSataSVG />;
  return <HddSVG />;
}

function RadarWaiting() {
  return (
    <svg width="68" height="68" viewBox="0 0 68 68">
      <circle cx="34" cy="34" r="28" fill="none" stroke="rgba(99,102,241,0.1)" strokeWidth="1" />
      <circle cx="34" cy="34" r="19" fill="none" stroke="rgba(99,102,241,0.18)" strokeWidth="1" />
      <circle cx="34" cy="34" r="9" fill="none" stroke="rgba(99,102,241,0.28)" strokeWidth="1" />
      <circle cx="34" cy="34" r="3" fill={IC} />
      <path d="M34 34 L34 6" stroke={IC} strokeWidth="1.6" strokeLinecap="round" className="si-rsw" />
      <circle cx="34" cy="34" r="28" fill="none" stroke="rgba(99,102,241,0.22)" strokeWidth="1.3" className="si-rrg" />
    </svg>
  );
}

/* ══════════════════════ COPY ══════════════════════ */
const C = {
  ES: {
    title: "Información del Sistema | CoreKit",
    heroT: "Auditoría de Hardware", heroS: "Conecta el Agente CoreKit para datos físicos reales en tiempo real.",
    dlBtn: "Descargar Agente CoreKit (.exe)",
    s1: "1. Descarga", s1d: "Archivo portable, sin instalación.",
    s2: "2. Ejecuta", s2d: "Doble clic — corre en segundo plano.",
    s3: "3. Specs en vivo", s3d: "La página se conecta automáticamente.",
    searching: "Buscando agente en puerto 8765…", retrying: "Reintentando conexión…",
    liveBadge: "AGENTE ACTIVO · DATOS REALES",
    tabE: "Vista Esencial", tabI: "Módulo de Ingeniería",
    printEssBtn: "Imprimir Vista Esencial", printEngBtn: "Imprimir Módulo Ingeniería",
    secDevice: "Dispositivo", secOS: "Sistema Operativo",
    secCPU: "Procesador", secRAM: "Memoria RAM", secDisk: "Almacenamiento",
    secGPU: "Tarjeta Gráfica", secDisplay: "Pantalla",
    secNet: "Red", secBatt: "Batería",
    idNote: "Usa el Número de Serie y Nombre del equipo para descargar drivers oficiales o comprar repuestos 100% compatibles.",
    serialLabel: "N.º de Serie", hostLabel: "Nombre del equipo", macLabel: "MAC Address",
    phys: "Físicos", logical: "Lógicos", freqCur: "Freq. actual", freqMax: "Freq. máx.",
    coreAct: "Actividad por núcleo",
    total: "Total", used: "En uso", free: "Libre",
    ramSlot: "Slot", ramSugT: "Ampliar RAM recomendado",
    ramSugB: "Tienes menos de 16 GB. Se recomienda 16–32 GB en Dual-Channel para maximizar el rendimiento.",
    ramVis: "Módulos detectados",
    dUsed: "usado", dFree: "libre", dRead: "Lectura", dWrite: "Escritura",
    diskNA: "Sin datos — ejecuta el agente como Administrador",
    resPhys: "Resolución", resAvail: "Disponible", dpr: "Pixel ratio", depth: "Profundidad color",
    netType: "Tipo de red", downlink: "Downlink", rtt: "RTT",
    recv: "↓ Recibido", sent: "↑ Enviado",
    charging: "Cargando", discharging: "Sin cargar", battNA: "No disponible",
    engLive: "Monitor en Tiempo Real",
    engCores: "Actividad por Núcleo (CPU)",
    engDiskIO: "I/O de Discos",
    engNetIO: "Tráfico de Red",
    engRaw: "Datos Físicos — Agente (psutil)",
    engBrowser: "Entorno del Navegador",
    note: "«psutil» = datos físicos reales. Las demás = APIs del navegador.",
    reportEssT: "FICHA TÉCNICA — VISTA ESENCIAL · COREKIT",
    reportEngT: "FICHA TÉCNICA — MÓDULO DE INGENIERÍA · COREKIT",
    reportS: "Documento de referencia técnica. Emitido para soporte, drivers y reparación.",
    reportDate: "Fecha del diagnóstico",
    ad: "Espacio publicitario",
    help: {
      title: "¿Cómo funciona?",
      s: [
        ["Descarga el Agente", "Haz clic en «Descargar» y ejecuta el .exe. Sin instalación, solo doble clic."],
        ["Conexión automática", "En segundos la página detecta el agente y muestra datos físicos reales."],
        ["Vista Esencial", "Dispositivo, OS, CPU, RAM, discos, GPU, pantalla y red en un vistazo organizado."],
        ["Módulo de Ingeniería", "Gráficos en tiempo real, I/O de discos y red, tablas técnicas en dos columnas."],
        ["Dos reportes", "Botones separados para imprimir la Vista Esencial y el Módulo de Ingeniería como fichas profesionales."],
      ], close: "¡Entendido!",
    },
  },
  EN: {
    title: "System Information | CoreKit",
    heroT: "Hardware Audit", heroS: "Connect the CoreKit Agent for real-time physical data.",
    dlBtn: "Download CoreKit Agent (.exe)",
    s1: "1. Download", s1d: "Portable file, no install.",
    s2: "2. Run", s2d: "Double-click — runs in background.",
    s3: "3. Live Specs", s3d: "Page connects automatically.",
    searching: "Searching agent on port 8765…", retrying: "Retrying connection…",
    liveBadge: "AGENT ACTIVE · REAL DATA",
    tabE: "Essential View", tabI: "Engineering Module",
    printEssBtn: "Print Essential View", printEngBtn: "Print Engineering Module",
    secDevice: "Device", secOS: "Operating System",
    secCPU: "Processor", secRAM: "RAM Memory", secDisk: "Storage",
    secGPU: "Graphics Card", secDisplay: "Display",
    secNet: "Network", secBatt: "Battery",
    idNote: "Use the Serial Number and device name to download official drivers or buy 100% compatible parts.",
    serialLabel: "Serial No.", hostLabel: "Device name", macLabel: "MAC Address",
    phys: "Physical", logical: "Logical", freqCur: "Cur. freq.", freqMax: "Max freq.",
    coreAct: "Per-core activity",
    total: "Total", used: "Used", free: "Free",
    ramSlot: "Slot", ramSugT: "RAM upgrade recommended",
    ramSugB: "You have less than 16 GB. Upgrading to 16–32 GB Dual-Channel is recommended.",
    ramVis: "Detected modules",
    dUsed: "used", dFree: "free", dRead: "Read", dWrite: "Write",
    diskNA: "No data — run agent as Administrator",
    resPhys: "Resolution", resAvail: "Available", dpr: "Pixel ratio", depth: "Color depth",
    netType: "Network type", downlink: "Downlink", rtt: "RTT",
    recv: "↓ Received", sent: "↑ Sent",
    charging: "Charging", discharging: "Not charging", battNA: "Not available",
    engLive: "Real-Time Monitor",
    engCores: "Per-Core Activity (CPU)",
    engDiskIO: "Disk I/O",
    engNetIO: "Network Traffic",
    engRaw: "Physical Data — Agent (psutil)",
    engBrowser: "Browser Environment",
    note: "«psutil» = real physical data. Others = browser APIs.",
    reportEssT: "TECHNICAL SHEET — ESSENTIAL VIEW · COREKIT",
    reportEngT: "TECHNICAL SHEET — ENGINEERING MODULE · COREKIT",
    reportS: "Technical reference document. Issued for support, drivers and repairs.",
    reportDate: "Diagnosis date",
    ad: "Advertisement",
    help: {
      title: "How does it work?",
      s: [
        ["Download the Agent", "Click «Download» and run the .exe. No install, just double-click."],
        ["Auto-connect", "Within seconds the page detects the agent and shows real physical data."],
        ["Essential View", "Device, OS, CPU, RAM, disks, GPU, display and network at a glance."],
        ["Engineering Module", "Real-time charts, disk and network I/O, two-column technical tables."],
        ["Two reports", "Separate buttons to print the Essential View and Engineering Module as professional sheets."],
      ], close: "Got it!",
    },
  },
};

/* ══════════════════════ COMPONENT ══════════════════════ */
export default function SystemInfoTool() {
  const { lang } = useApp();
  const t = C[lang];

  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("essential");
  const [showHelp, setShowHelp] = useState(false);
  const [helpVis, setHelpVis] = useState(false);
  const openHelp = () => { setShowHelp(true); requestAnimationFrame(() => setHelpVis(true)); };
  const closeHelp = () => { setHelpVis(false); setTimeout(() => setShowHelp(false), 200); };
  const [infoModal, setInfoModal] = useState<"ram" | "disk" | null>(null);
  const [infoVis, setInfoVis] = useState(false);
  const openInfo = (k: "ram" | "disk") => { setInfoModal(k); requestAnimationFrame(() => setInfoVis(true)); };
  const closeInfo = () => { setInfoVis(false); setTimeout(() => setInfoModal(null), 200); };
  const [dlModal, setDlModal] = useState(false);
  const [dlVis, setDlVis] = useState(false);
  const openDl = () => { setDlModal(true); requestAnimationFrame(() => setDlVis(true)); };
  const closeDl = () => { setDlVis(false); setTimeout(() => setDlModal(false), 200); };

  useEffect(() => { document.title = t.title; }, [t.title]);
  useEffect(() => { collectSnapshot().then(setSnap); }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const rcRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountRef = useRef(true);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("disconnected");
  const [agentData, setAgentData] = useState<AgentPayload | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [printMode, setPrintMode] = useState<"essential" | "engineering" | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const scheduleReconnect = useCallback(() => {
    if (!mountRef.current) return;
    if (rcRef.current) clearTimeout(rcRef.current);
    rcRef.current = setTimeout(() => { if (mountRef.current) doConnect(); }, RECONNECT_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doConnect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;
    setAgentStatus("connecting");
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => { if (mountRef.current) setAgentStatus("connected"); };
    ws.onmessage = (e) => {
      if (!mountRef.current) return;
      try {
        const d = JSON.parse(e.data as string) as AgentPayload;
        setAgentData(d);
        setHistory(prev => { const n = [...prev, { t: Date.now(), cpu: d.cpu_usage, ram: d.ram_usage }]; return n.length > HISTORY_MAX ? n.slice(-HISTORY_MAX) : n; });
      } catch { /**/ }
    };
    ws.onerror = () => { /**/ };
    ws.onclose = () => {
      if (!mountRef.current) return;
      wsRef.current = null;
      setAgentStatus(p => p === "connected" ? "error" : "disconnected");
      scheduleReconnect();
    };
  }, [scheduleReconnect]);

  useEffect(() => {
    mountRef.current = true; doConnect();
    return () => { mountRef.current = false; if (rcRef.current) clearTimeout(rcRef.current); if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (agentStatus !== "connected") scheduleReconnect(); }, [agentStatus, scheduleReconnect]);

  const handlePrintEssential = useCallback(() => {
    setPrintMode("essential");
    if (typeof document !== "undefined") {
      document.body.classList.remove("si-printing-engineering");
      document.body.classList.add("si-printing-essential");
    }
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        setPrintMode(null);
        if (typeof document !== "undefined") {
          document.body.classList.remove("si-printing-essential");
        }
      }, 300);
    }, 120);
  }, []);
  const handlePrintEngineering = useCallback(() => {
    setPrintMode("engineering");
    if (typeof document !== "undefined") {
      document.body.classList.remove("si-printing-essential");
      document.body.classList.add("si-printing-engineering");
    }
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        setPrintMode(null);
        if (typeof document !== "undefined") {
          document.body.classList.remove("si-printing-engineering");
        }
      }, 300);
    }, 120);
  }, []);

  /* derived */
  const cpuHist = history.map(p => p.cpu);
  const ramHist = history.map(p => p.ram);
  const agBatt = typeof agentData?.battery === "number" ? agentData.battery : null;
  const isLive = agentStatus === "connected";

  const cpuC = (v: number) => v > 80 ? "#ef4444" : v > 55 ? "#f59e0b" : "#6366f1";
  const ramC = (v: number) => v > 85 ? "#ef4444" : v > 65 ? "#f59e0b" : "#10b981";
  const diskC = (v: number) => v > 85 ? "#ef4444" : v > 65 ? "#f59e0b" : "#10b981";

  const brows = useMemo(() => {
    if (!snap) return [];
    return [
      { k: "Navegador", v: `${snap.browser} ${snap.browserVersion}` },
      { k: "Arquitectura (UA)", v: snap.arch },
      { k: "CPU lógicos (browser)", v: String(snap.cpuCores) },
      { k: "RAM aprox. (browser)", v: snap.deviceMemoryGB ? `${snap.deviceMemoryGB} GB` : "—" },
      { k: "GPU Renderer (WebGL)", v: snap.gpuRenderer },
      { k: "GPU Vendor (WebGL)", v: snap.gpuVendor },
      { k: "WebGL Version", v: snap.webglVersion },
      { k: "Resolución física", v: `${snap.screenW} × ${snap.screenH}` },
      { k: "Resolución disponible", v: `${snap.screenAvailW} × ${snap.screenAvailH}` },
      { k: "Pixel ratio (DPR)", v: `${snap.dpr}x` },
      { k: "Profundidad color", v: `${snap.colorDepth}-bit` },
      { k: "HDR", v: snap.hdr ? "Sí" : "No" },
      { k: "Touch points", v: String(snap.touchPoints) },
      { k: "Tipo de red", v: snap.connectionType },
      { k: "Downlink estimado", v: snap.connectionDownlink !== null ? `${snap.connectionDownlink} Mbps` : "—" },
      { k: "RTT estimado", v: snap.connectionRtt !== null ? `${snap.connectionRtt} ms` : "—" },
      { k: "Ahorro de datos", v: snap.saveData ? "Sí" : "No" },
      { k: "Online", v: snap.online ? "Sí" : "No" },
      { k: "Idioma principal", v: snap.language },
      { k: "Idiomas configurados", v: snap.languages.join(", ") },
      { k: "Zona horaria", v: snap.timezone },
      { k: "Cookies habilitadas", v: snap.cookiesEnabled ? "Sí" : "No" },
      { k: "Storage cuota", v: snap.storageEstimateGB ? `${snap.storageEstimateGB} GB` : "—" },
      { k: "Storage usado", v: snap.storageUsedGB ? `${snap.storageUsedGB} GB` : "—" },
      { k: "Prefiere tema oscuro", v: snap.prefersDark ? "Sí" : "No" },
      { k: "Menos animación", v: snap.reducedMotion ? "Sí" : "No" },
    ];
  }, [snap]);

  const bHalf = Math.ceil(brows.length / 2);
  const browsL = brows.slice(0, bHalf);
  const browsR = brows.slice(bHalf);

  const agSections = useMemo(() => {
    if (!agentData) return [] as { title: string; rows: { k: string; v: string }[] }[];
    const fmtCap = (g: number) => g >= 1000 ? `${(g / 1024).toFixed(2)} TB` : `${g} GB`;
    const sections: { title: string; rows: { k: string; v: string }[] }[] = [];

    sections.push({ title: "Identidad del Equipo", rows: [
      { k: "Hostname", v: agentData.hostname || "—" },
      { k: "Serial placa base", v: agentData.boardSerial || "—" },
      { k: "MAC Address principal", v: agentData.macAddress || "—" },
      { k: "Fabricante sistema", v: agentData.systemVendor || "—" },
      { k: "Modelo sistema", v: agentData.systemModel || "—" },
      { k: "SKU del sistema", v: agentData.systemSKU || "—" },
      { k: "Tipo de sistema", v: agentData.systemType || "—" },
      { k: "Dominio / Grupo", v: agentData.domain || "—" },
    ]});

    sections.push({ title: "Placa Base y BIOS", rows: [
      { k: "Fabricante placa base", v: agentData.boardVendor || "—" },
      { k: "Modelo placa base", v: agentData.boardModel || "—" },
      { k: "BIOS — Fabricante", v: agentData.biosVendor || "—" },
      { k: "BIOS — Versión", v: agentData.biosVersion || "—" },
      { k: "BIOS — Modo", v: agentData.biosMode || "—" },
      { k: "SMBIOS", v: agentData.smbiosVersion || "—" },
      { k: "Arranque seguro", v: agentData.secureBoot || "—" },
    ]});

    sections.push({ title: "Sistema Operativo", rows: [
      { k: "Nombre", v: `${agentData.osName} ${agentData.osRelease}` },
      { k: "Edición", v: agentData.osEdition || "—" },
      { k: "Versión (DisplayVersion)", v: agentData.osDisplayVersion && agentData.osDisplayVersion !== "—" ? agentData.osDisplayVersion : "—" },
      { k: "Build completo", v: agentData.osVersion.slice(0, 60) },
      { k: "Instalación Windows", v: agentData.osInstallDate || "—" },
      { k: "Último arranque", v: agentData.osLastBoot || "—" },
      { k: "Usuario registrado", v: agentData.regOwner || "—" },
      { k: "Directorio Windows", v: agentData.winDir || "—" },
      { k: "Configuración regional", v: agentData.locale || "—" },
    ]});

    sections.push({ title: "Procesador (CPU)", rows: [
      { k: "Modelo", v: agentData.cpuName },
      { k: "Físicos / Lógicos", v: `${agentData.cpuPhysical} / ${agentData.cpuCores}` },
      { k: "Frecuencia actual", v: agentData.cpu_freq_mhz ? `${agentData.cpu_freq_mhz} MHz` : "—" },
      { k: "Frecuencia máxima", v: agentData.cpu_freq_max_mhz ? `${agentData.cpu_freq_max_mhz} MHz` : "—" },
      { k: "Arquitectura", v: agentData.cpuArch || "—" },
      { k: "Socket", v: agentData.cpuSocket || "—" },
      { k: "Caché L2", v: agentData.cpuL2KB ? `${(agentData.cpuL2KB / 1024).toFixed(1)} MB` : "—" },
      { k: "Caché L3", v: agentData.cpuL3KB ? `${(agentData.cpuL3KB / 1024).toFixed(1)} MB` : "—" },
      { k: "Virtualización", v: agentData.cpuVirt === undefined ? "—" : agentData.cpuVirt ? "Habilitada" : "Deshabilitada" },
      { k: "Uso actual", v: `${agentData.cpu_usage.toFixed(1)}%` },
    ]});

    sections.push({ title: "Memoria RAM", rows: [
      { k: "Total instalada", v: `${agentData.totalRamGB} GB` },
      { k: "En uso", v: `${agentData.ram_used_gb} GB (${agentData.ram_usage.toFixed(1)}%)` },
      { k: "Disponible", v: agentData.ram_available_gb !== undefined ? `${agentData.ram_available_gb} GB` : `${(agentData.totalRamGB - agentData.ram_used_gb).toFixed(1)} GB` },
      { k: "Módulos detectados", v: String(agentData.ramModules.length) },
      ...agentData.ramModules.map((m, i) => ({ k: `Slot ${i+1}`, v: `${m.capacityGB}GB · ${m.speedMHz}MHz · ${m.memType || ""}${m.formFactor && m.formFactor !== "—" ? " " + m.formFactor : ""} · ${m.manufacturer} ${m.partNumber}` })),
      { k: "Swap — Total", v: agentData.swapTotalGB !== undefined ? `${agentData.swapTotalGB} GB` : "—" },
      { k: "Swap — En uso", v: agentData.swap_used_gb !== undefined ? `${agentData.swap_used_gb} GB (${(agentData.swap_usage ?? 0).toFixed(1)}%)` : "—" },
    ]});

    sections.push({ title: "Gráficos (GPU)", rows: [
      ...(agentData.gpus || []).flatMap((g, i) => [
        { k: `GPU ${i+1} — Modelo`, v: g.name },
        { k: `GPU ${i+1} — VRAM`, v: g.vram || "—" },
        { k: `GPU ${i+1} — Driver`, v: g.driver || "—" },
        { k: `GPU ${i+1} — Chip`, v: g.chip || "—" },
      ]),
    ]});

    // Una sub-tabla por disco
    agentData.disks.forEach((d, i) => {
      sections.push({ title: `Disco ${i+1}: ${cleanDiskModel(d.model).slice(0, 32)}`, rows: [
        { k: "Modelo", v: cleanDiskModel(d.model) },
        { k: "Tipo", v: `${d.type}${d.formFactor && d.formFactor !== "—" ? " · " + d.formFactor : ""}` },
        { k: "Capacidad", v: fmtCap(d.sizeGB) },
        { k: "Uso", v: d.usedPct !== undefined ? `${fmtCap(d.usedGB ?? 0)} (${d.usedPct.toFixed(1)}%)` : "—" },
        { k: "Libre", v: fmtCap(d.freeGB ?? 0) },
        { k: "Bus", v: d.bus || "—" },
        { k: "Interfaz", v: d.interface || "—" },
        { k: "Velocidad bus", v: d.busSpeed || "—" },
        { k: "Salud", v: d.health || "—" },
        { k: "Estado", v: `${d.status || "—"}${d.opStatus && d.opStatus !== "—" ? " · " + d.opStatus : ""}` },
        { k: "Firmware", v: d.firmware || "—" },
        { k: "Número de serie", v: d.serial || "—" },
        { k: "Uso del sistema", v: d.usage || "—" },
        { k: "Estilo de partición", v: d.partStyle || "—" },
        { k: "Particiones", v: String(d.partitions ?? 0) },
        { k: "Sectores", v: d.sectors ? `${d.sectors.toLocaleString()} × ${d.bytesPerSector || 512} B` : "—" },
      ]});
    });

    if (agentData.volumes && agentData.volumes.length > 0) {
      sections.push({ title: "Unidades Lógicas (Particiones)", rows:
        agentData.volumes.map(v => {
          const phys = agentData.disks.find(d => d.diskIdx === v.diskIdx);
          return { k: `${v.mount}${v.label ? " (" + v.label + ")" : ""}`, v: `${v.fs} · ${fmtCap(v.sizeGB)} · ${v.usedPct.toFixed(0)}% usado${phys ? " → " + cleanDiskModel(phys.model) : ""}` };
        })
      });
    }

    sections.push({ title: "Batería", rows: [
      { k: "Nivel actual", v: agBatt !== null ? `${agBatt}%` : "—" },
      { k: "Estado", v: agentData.battery_plugged === null ? "—" : agentData.battery_plugged ? t.charging : t.discharging },
      { k: "Autonomía estimada", v: agentData.battery_secsleft ? `${Math.floor(agentData.battery_secsleft / 3600)}h ${Math.floor((agentData.battery_secsleft % 3600) / 60)}m` : "—" },
      { k: "Ciclos de carga", v: agentData.batteryCycles !== undefined && agentData.batteryCycles > 0 ? String(agentData.batteryCycles) : "—" },
      { k: "Desgaste", v: agentData.batteryWearPct !== undefined && agentData.batteryWearPct !== null ? `${agentData.batteryWearPct}%` : "—" },
      { k: "Capacidad de diseño", v: agentData.batteryDesignCapacityMWh ? `${(agentData.batteryDesignCapacityMWh / 1000).toFixed(1)} Wh` : "—" },
      { k: "Capacidad máxima actual", v: agentData.batteryFullCapacityMWh ? `${(agentData.batteryFullCapacityMWh / 1000).toFixed(1)} Wh` : "—" },
      { k: "Química", v: agentData.batteryChemistry || "—" },
      { k: "Fabricante", v: agentData.batteryMfr || "—" },
    ]});

    if (agentData.netAdapters && agentData.netAdapters.length > 0) {
      sections.push({ title: "Adaptadores de Red", rows:
        agentData.netAdapters.flatMap((n, i) => [
          { k: `Adaptador ${i+1} — Nombre`, v: n.name },
          { k: `Adaptador ${i+1} — Descripción`, v: n.desc || "—" },
          { k: `Adaptador ${i+1} — MAC`, v: n.mac || "—" },
          { k: `Adaptador ${i+1} — IP local`, v: n.ip || "—" },
          { k: `Adaptador ${i+1} — Velocidad`, v: n.linkSpeed || "—" },
        ])
      });
    }

    if (agentData.temps && Object.keys(agentData.temps).length > 0) {
      sections.push({ title: "Sensores de Temperatura", rows:
        Object.entries(agentData.temps).map(([k, v]) => ({ k, v: `${v} °C` }))
      });
    }

    return sections;
  }, [agentData, agBatt, t]);

  // Mantengo agRows como flat para compatibilidad con código existente
  const agRows = useMemo(() => agSections.flatMap(s => s.rows), [agSections]);

  const agHalf = Math.ceil(agRows.length / 2);
  const agL = agRows.slice(0, agHalf);
  const agR = agRows.slice(agHalf);

  /* ════════════════════════ RENDER ════════════════════════ */
  return (
    <>
      <style>{`
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes scIn{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes aPulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,0.55)}100%{box-shadow:0 0 0 10px rgba(16,185,129,0)}}
        @keyframes rSweep{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes rRing{0%{r:0;opacity:0.7}100%{r:32;opacity:0}}
        @keyframes st1{0%,60%,100%{opacity:.3;transform:scale(1)}5%,25%{opacity:1;transform:scale(1.07)}}
        @keyframes st2{0%,20%,85%,100%{opacity:.3;transform:scale(1)}30%,52%{opacity:1;transform:scale(1.07)}}
        @keyframes st3{0%,42%,100%{opacity:.3;transform:scale(1)}55%,76%{opacity:1;transform:scale(1.07)}}
        @keyframes glow1{0%,60%,100%{box-shadow:none}5%,25%{box-shadow:0 0 0 5px rgba(99,102,241,0.2)}}
        @keyframes glow2{0%,20%,85%,100%{box-shadow:none}30%,52%{box-shadow:0 0 0 5px rgba(99,102,241,0.2)}}
        @keyframes glow3{0%,42%,100%{box-shadow:none}55%,76%{box-shadow:0 0 0 5px rgba(99,102,241,0.2)}}
        .si-rsw{transform-origin:34px 34px;animation:rSweep 2.4s linear infinite;}
        .si-rrg{transform-origin:34px 34px;animation:rRing 2.4s ease-out infinite;}
        .si-aDot{animation:aPulse 1.5s ease-out infinite;}
        .si-spin{animation:spin 0.85s linear infinite;}
        .si-a1{animation:st1 3s ease-in-out infinite;}.si-g1{animation:glow1 3s ease-in-out infinite;}
        .si-a2{animation:st2 3s ease-in-out infinite;}.si-g2{animation:glow2 3s ease-in-out infinite;}
        .si-a3{animation:st3 3s ease-in-out infinite;}.si-g3{animation:glow3 3s ease-in-out infinite;}
        .si-tab{transition:all 0.17s ease;}
        .si-c{border-radius:12px;border:1px solid var(--border-split);background:var(--bg-surface);padding:14px;}

        /* ─── PRINT BASE — DINÁMICO, N páginas según contenido ─── */
        @media print{
          @page { size: A4; margin: 10mm; }
          *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;box-sizing:border-box!important;}
          html,body{margin:0!important;padding:0!important;background:#fff!important;color:#0f172a!important;
            font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif!important;}
          /* Ocultar todo lo que no es el reporte activo */
          body.si-printing-essential > *:not(.si-pr-portal),
          body.si-printing-engineering > *:not(.si-pr-portal){display:none!important;}
          body.si-printing-essential .si-pr-eng,
          body.si-printing-engineering .si-pr-ess{display:none!important;}
          .si-pr-portal{display:block!important;width:100%;}
          .si-pr{display:block!important;width:100%;background:#fff;padding:0;margin:0;}
          .si-pr.si-pr-hide{display:none!important;}
          .si-wm{display:none!important;}

          /* HEADER simple con <table> — evita display:table en div */
          table.si-ph{
            width:100%!important;border-collapse:collapse!important;
            background:#312e81!important;color:#fff!important;
            margin:0 0 8px 0!important;
            border-bottom:3px solid #6366f1!important;
            page-break-after:avoid!important;break-after:avoid!important;
          }
          table.si-ph td{padding:10px 12px!important;vertical-align:middle!important;border:none!important;}
          table.si-ph td.si-ph-r{text-align:right!important;}
          .si-ph-icon-cell{width:56px!important;}
          .si-ph-icon{
            display:inline-block;width:38px;height:38px;border-radius:6px;
            background:rgba(255,255,255,0.18)!important;
            border:1.5px solid rgba(255,255,255,0.35)!important;
            text-align:center;line-height:38px;
          }
          .si-ph h1{font-size:12px!important;font-weight:900;color:#fff!important;
            letter-spacing:0.04em;margin:0 0 2px;text-transform:uppercase;}
          .si-ph p{font-size:7.5px!important;color:#c7d2fe!important;margin:0;line-height:1.4;}
          .si-ph .lbl{font-size:7px!important;color:#e0e7ff!important;letter-spacing:0.05em;}
          .si-ph .val{display:block;color:#fff!important;font-size:9px!important;
            font-family:'SF Mono',Menlo,monospace;font-weight:700;margin-top:1px;}

          /* Chips de meta */
          .si-pmeta{
            display:block!important;width:100%;
            margin:0 0 6px;padding:5px 8px;
            background:#f8fafc!important;
            border:1px solid #e2e8f0!important;
            page-break-inside:avoid!important;break-inside:avoid!important;
            page-break-after:avoid!important;
          }
          .si-pmeta-chip{
            display:inline-block;vertical-align:middle;
            font-size:7px;color:#475569!important;
            padding:2px 6px;margin:1px 2px 1px 0;
            background:#fff!important;
            border:1px solid #cbd5e1!important;border-radius:999px;font-weight:600;
          }
          .si-pmeta-chip strong{color:#1e3a8a!important;font-family:'SF Mono',Menlo,monospace;font-weight:700;}

          /* ════════ DATA SHEET: cada bloque es una <table> HTML nativa ════════
             La tabla es hijo directo de .si-pr — sin wrappers <div>.
             Chrome pagina tablas nativamente: thead se repite en cada página,
             tbody parte fila por fila. */
          table.si-pb-t{
            width:100%!important;
            border-collapse:collapse!important;border-spacing:0!important;
            table-layout:fixed!important;
            margin:0 0 5px 0!important;
            page-break-inside:auto!important;break-inside:auto!important;
          }
          table.si-pb-t thead{display:table-header-group!important;}
          table.si-pb-t tbody{display:table-row-group!important;}
          table.si-pb-t tr{
            page-break-inside:avoid!important;break-inside:avoid!important;
          }
          table.si-pb-t thead tr{
            page-break-after:avoid!important;break-after:avoid!important;
          }
          .si-pb-h-th{
            padding:4px 8px!important;
            background:#eef2ff!important;color:#312e81!important;
            border-left:3px solid #6366f1!important;
            border-bottom:1.5px solid #6366f1!important;
            text-align:left!important;font-weight:normal!important;
          }
          .si-pb-h-th span{
            display:inline-block;
            font-size:8.5px;font-weight:900;color:#312e81!important;
            letter-spacing:0.06em;text-transform:uppercase;
            vertical-align:middle;
          }
          .si-pb-h-th em{
            display:inline-block;margin-left:6px;
            font-style:normal;font-size:7px;color:#6366f1!important;
            background:#fff!important;padding:1px 6px;border-radius:999px;
            border:1px solid #c7d2fe!important;font-family:'SF Mono',Menlo,monospace;
            vertical-align:middle;
          }
          table.si-pb-t td{
            padding:2.5px 7px!important;
            font-size:7.5px!important;
            border:1px solid #e2e8f0!important;
            line-height:1.35!important;vertical-align:top!important;
            word-wrap:break-word!important;overflow-wrap:break-word!important;
          }
          .si-pb-k{
            color:#64748b!important;font-weight:600!important;
            background:#fafafa!important;
            width:22%;
          }
          .si-pb-v{
            color:#0f172a!important;font-weight:700!important;
            font-family:'SF Mono',Menlo,monospace!important;
            word-break:break-word!important;
            width:28%;
          }
          .si-pb-wide .si-pb-k{width:30%!important;}
          .si-pb-wide .si-pb-v{width:70%!important;}

          /* Footer al final, en flujo natural */
          .si-pf{
            display:block!important;width:100%;
            margin-top:8px;padding-top:5px;
            border-top:2px solid #6366f1!important;
            font-size:7px;color:#64748b!important;
            font-family:'SF Mono',Menlo,monospace!important;
          }
          .si-pf-l{display:inline-block;width:60%;vertical-align:top;}
          .si-pf-r{display:inline-block;width:39%;vertical-align:top;text-align:right;}
          .si-pf strong{color:#312e81!important;}
        }
        .si-ph,.si-print-body,.si-pmeta,.si-pf{display:none;}
        .si-pr{display:none;}
      `}</style>

      {/* ══════════════ PRINT ROOTS via Portal (rendered to document.body) ══════════════ */}
      {mounted && createPortal(
        <div className="si-pr-portal">
      <div id="si-print-ess" className={"si-pr si-pr-ess" + (printMode === "essential" ? "" : " si-pr-hide")}>
        <div className="si-wm">COREKIT</div>
        <table className="si-ph"><tbody><tr>
          <td className="si-ph-icon-cell">
            <span className="si-ph-icon"><Cpu style={{ width: 20, height: 20, color: "#fff" }} /></span>
          </td>
          <td>
            <h1>FICHA TÉCNICA — VISTA ESENCIAL · COREKIT</h1>
            <p>Documento de referencia técnica · Identificación, configuración y estado del equipo.</p>
          </td>
          <td className="si-ph-r">
            <div className="lbl">FECHA DEL DIAGNÓSTICO</div>
            <span className="val">{new Date().toLocaleString(lang === "ES" ? "es-ES" : "en-US", { dateStyle: "short", timeStyle: "medium" })}</span>
            <div className="lbl" style={{ marginTop: 3 }}>REPORTE</div>
            <span className="val">ESSENTIAL · v3.3</span>
          </td>
        </tr></tbody></table>
        {agentData && (
          <>
            <div className="si-pmeta">
              <span className="si-pmeta-chip">🖥️ <strong>{agentData.hostname || "—"}</strong></span>
              <span className="si-pmeta-chip">S/N: <strong>{agentData.boardSerial || "—"}</strong></span>
              <span className="si-pmeta-chip">MAC: <strong>{agentData.macAddress || "—"}</strong></span>
              <span className="si-pmeta-chip">{agentData.systemVendor || ""} <strong>{agentData.systemModel || "—"}</strong></span>
              <span className="si-pmeta-chip">{agentData.osEdition || agentData.osName} <strong>{agentData.osDisplayVersion || agentData.osRelease}</strong></span>
            </div>

            <PrintBlock title="🏷️ IDENTIDAD DEL EQUIPO" badge={"5 campos"} rows={[
              { k: "Nombre del equipo", v: agentData.hostname || "—" },
              { k: "Número de serie", v: agentData.boardSerial || "—" },
              { k: "MAC Address", v: agentData.macAddress || "—" },
              { k: "Tipo de sistema", v: agentData.systemType || "—" },
              { k: "Dominio / Grupo", v: agentData.domain || "—" },
            ]} />

            <PrintBlock title="🧩 PLACA BASE · BIOS · SISTEMA" badge={"10 campos"} rows={[
              { k: "Fabricante (sistema)", v: agentData.systemVendor || "—" },
              { k: "Modelo (sistema)", v: agentData.systemModel || "—" },
              { k: "Fabricante placa base", v: agentData.boardVendor || "—" },
              { k: "Modelo placa base", v: agentData.boardModel || "—" },
              { k: "SKU del sistema", v: agentData.systemSKU || "—" },
              { k: "BIOS — Fabricante", v: agentData.biosVendor || "—" },
              { k: "BIOS — Versión", v: agentData.biosVersion || "—" },
              { k: "Modo BIOS", v: agentData.biosMode || "—" },
              { k: "SMBIOS", v: agentData.smbiosVersion || "—" },
              { k: "Arranque seguro", v: agentData.secureBoot || "—" },
            ]} />

            <PrintBlock title="🪟 SISTEMA OPERATIVO" badge={"7 campos"} rows={[
              { k: "Nombre", v: `${agentData.osName} ${agentData.osRelease}` },
              { k: "Edición", v: agentData.osEdition || "—" },
              { k: "Versión (Display)", v: agentData.osDisplayVersion || "—" },
              { k: "Build", v: agentData.osVersion },
              { k: "Arquitectura", v: agentData.cpuArch || "—" },
              { k: "Fecha instalación", v: agentData.osInstallDate || "—" },
              { k: "Último arranque", v: agentData.osLastBoot || "—" },
            ]} />

            <PrintBlock title="⚙️ PROCESADOR (CPU)" badge={"9 campos"} rows={[
              { k: "Modelo", v: agentData.cpuName },
              { k: "Núcleos físicos / lógicos", v: `${agentData.cpuPhysical} / ${agentData.cpuCores}` },
              { k: "Frecuencia actual", v: agentData.cpu_freq_mhz ? `${agentData.cpu_freq_mhz} MHz` : "—" },
              { k: "Frecuencia máxima", v: agentData.cpu_freq_max_mhz ? `${agentData.cpu_freq_max_mhz} MHz` : "—" },
              { k: "Arquitectura", v: agentData.cpuArch || "—" },
              { k: "Socket", v: agentData.cpuSocket || "—" },
              { k: "Caché L2 / L3", v: `${agentData.cpuL2KB ? (agentData.cpuL2KB / 1024).toFixed(1) + " MB" : "—"} / ${agentData.cpuL3KB ? (agentData.cpuL3KB / 1024).toFixed(1) + " MB" : "—"}` },
              { k: "Virtualización", v: agentData.cpuVirt === undefined ? "—" : agentData.cpuVirt ? "Habilitada" : "Deshabilitada" },
              { k: "Uso actual", v: `${agentData.cpu_usage.toFixed(1)}%` },
            ]} />

            <PrintBlock title="🧠 MEMORIA RAM" badge={`${agentData.ramModules.length} módulo(s)`} rows={[
              { k: "Total instalada", v: `${agentData.totalRamGB} GB` },
              { k: "En uso", v: `${agentData.ram_used_gb} GB (${agentData.ram_usage.toFixed(1)}%)` },
              { k: "Disponible", v: agentData.ram_available_gb !== undefined ? `${agentData.ram_available_gb} GB` : "—" },
              { k: "Módulos detectados", v: String(agentData.ramModules.length) },
              ...agentData.ramModules.map((m, i) => ({ k: `Slot ${i+1}`, v: `${m.capacityGB} GB · ${m.speedMHz} MHz · ${m.memType || ""}${m.formFactor && m.formFactor !== "—" ? " " + m.formFactor : ""} · ${m.manufacturer} ${m.partNumber}` })),
              { k: "Swap — Total / Uso", v: `${agentData.swapTotalGB ?? "—"} GB / ${agentData.swap_used_gb ?? "—"} GB` },
            ]} />

            {agentData.gpus && agentData.gpus.length > 0 && (
              <PrintBlock title="🎮 GRÁFICOS (GPU)" badge={`${agentData.gpus.length} GPU(s)`} rows={
                agentData.gpus.flatMap((g, i) => [
                  { k: `GPU ${i+1} — Modelo`, v: g.name },
                  { k: `GPU ${i+1} — VRAM`, v: g.vram || "—" },
                  { k: `GPU ${i+1} — Driver`, v: g.driver || "—" },
                  { k: `GPU ${i+1} — Chip`, v: g.chip || "—" },
                ])
              } />
            )}

            {agentData.disks.map((d, i) => {
              const fmtCap = (g: number) => g >= 1000 ? `${(g / 1024).toFixed(2)} TB` : `${g.toFixed(0)} GB`;
              return (
                <PrintBlock key={i} wide title={`💾 DISCO ${i+1}: ${cleanDiskModel(d.model)}`} badge={d.type} rows={[
                  { k: "Modelo", v: cleanDiskModel(d.model) },
                  { k: "Tipo / Factor de forma", v: `${d.type}${d.formFactor && d.formFactor !== "—" ? " · " + d.formFactor : ""}` },
                  { k: "Capacidad total", v: fmtCap(d.sizeGB) },
                  { k: "Espacio usado", v: d.usedPct !== undefined ? `${fmtCap(d.usedGB ?? 0)} (${d.usedPct.toFixed(1)}%)` : "—" },
                  { k: "Espacio libre", v: fmtCap(d.freeGB ?? 0) },
                  { k: "Bus / Interfaz", v: `${d.bus || "—"}${d.interface && d.interface !== d.bus ? " · " + d.interface : ""}` },
                  { k: "Velocidad teórica", v: d.busSpeed || "—" },
                  { k: "Salud", v: d.health || "—" },
                  { k: "Firmware", v: d.firmware || "—" },
                  { k: "Número de serie", v: d.serial || "—" },
                  { k: "Estilo / Particiones", v: `${d.partStyle || "—"} · ${d.partitions ?? 0} partición(es)` },
                ]} />
              );
            })}

            {agentData.volumes && agentData.volumes.length > 0 && (
              <PrintBlock title="📂 UNIDADES LÓGICAS (PARTICIONES)" badge={`${agentData.volumes.length} unidad(es)`} rows={
                agentData.volumes.flatMap(v => {
                  const fmtCap = (g: number) => g >= 1000 ? `${(g/1024).toFixed(2)} TB` : `${g.toFixed(0)} GB`;
                  const phys = agentData.disks.find(d => d.diskIdx === v.diskIdx);
                  return [
                    { k: `${v.mount} — FS / Etiqueta`, v: `${v.fs}${v.label ? " · " + v.label : ""}` },
                    { k: `${v.mount} — Capacidad / Uso`, v: `${fmtCap(v.sizeGB)} · ${v.usedPct.toFixed(0)}% usado` },
                    { k: `${v.mount} — Libre`, v: fmtCap(v.freeGB) },
                    { k: `${v.mount} — Disco físico`, v: phys ? `${cleanDiskModel(phys.model)} (${phys.type})` : "—" },
                  ];
                })
              } />
            )}

            {agentData.netAdapters && agentData.netAdapters.length > 0 && (
              <PrintBlock title="🌐 ADAPTADORES DE RED" badge={`${agentData.netAdapters.length}`} rows={
                agentData.netAdapters.flatMap((n, i) => [
                  { k: `Adaptador ${i+1} — Nombre`, v: n.name },
                  { k: `Adaptador ${i+1} — IP local`, v: n.ip || "—" },
                  { k: `Adaptador ${i+1} — MAC`, v: n.mac || "—" },
                  { k: `Adaptador ${i+1} — Velocidad`, v: n.linkSpeed || "—" },
                ])
              } />
            )}

            <PrintBlock title="🔋 BATERÍA" badge={agentData.batteryCycles !== undefined ? "completo" : "básico"} rows={[
              { k: "Nivel actual", v: agBatt !== null ? `${agBatt}%` : "—" },
              { k: "Estado", v: agentData.battery_plugged === null ? "—" : agentData.battery_plugged ? t.charging : t.discharging },
              { k: "Ciclos de carga", v: agentData.batteryCycles !== undefined && agentData.batteryCycles > 0 ? String(agentData.batteryCycles) : "—" },
              { k: "Desgaste", v: agentData.batteryWearPct !== undefined && agentData.batteryWearPct !== null ? `${agentData.batteryWearPct}%` : "—" },
              { k: "Capacidad de diseño", v: agentData.batteryDesignCapacityMWh ? `${(agentData.batteryDesignCapacityMWh / 1000).toFixed(1)} Wh` : "—" },
              { k: "Capacidad máxima actual", v: agentData.batteryFullCapacityMWh ? `${(agentData.batteryFullCapacityMWh / 1000).toFixed(1)} Wh` : "—" },
              { k: "Química", v: agentData.batteryChemistry || "—" },
              { k: "Voltaje de diseño", v: agentData.batteryVoltageMV ? `${(agentData.batteryVoltageMV / 1000).toFixed(2)} V` : "—" },
            ]} />
          </>
        )}
        <div className="si-pf">
          <span className="si-pf-l">CoreKit Diagnostic Suite · <strong>{agentData?.hostname || "—"}</strong> · S/N {agentData?.boardSerial || "—"}</span>
          <span className="si-pf-r">Generado el <strong>{new Date().toLocaleDateString(lang === "ES" ? "es-ES" : "en-US")}</strong></span>
        </div>
      </div>

      {/* ══════════════ PRINT ROOT — ENGINEERING ══════════════ */}
      {/* ══════════════ PRINT ROOT — ENGINEERING (Data Sheet completo) ══════════════ */}
      <div id="si-print-eng" className={"si-pr si-pr-eng" + (printMode === "engineering" ? "" : " si-pr-hide")}>
        <div className="si-wm">COREKIT</div>
        <table className="si-ph"><tbody><tr>
          <td className="si-ph-icon-cell">
            <span className="si-ph-icon"><Layers style={{ width: 20, height: 20, color: "#fff" }} /></span>
          </td>
          <td>
            <h1>FICHA TÉCNICA — MÓDULO DE INGENIERÍA · COREKIT</h1>
            <p>Documento técnico exhaustivo emitido por el agente local. Hardware completo, telemetría y entorno del navegador.</p>
          </td>
          <td className="si-ph-r">
            <div className="lbl">FECHA DEL DIAGNÓSTICO</div>
            <span className="val">{new Date().toLocaleString(lang === "ES" ? "es-ES" : "en-US", { dateStyle: "short", timeStyle: "medium" })}</span>
            <div className="lbl" style={{ marginTop: 3 }}>REPORTE</div>
            <span className="val">ENGINEERING · v3.3</span>
          </td>
        </tr></tbody></table>
        {agentData && (
          <>
            <div className="si-pmeta">
              <span className="si-pmeta-chip">🖥️ <strong>{agentData.hostname || "—"}</strong></span>
              <span className="si-pmeta-chip">S/N: <strong>{agentData.boardSerial || "—"}</strong></span>
              <span className="si-pmeta-chip">{agentData.systemVendor || ""} <strong>{agentData.systemModel || "—"}</strong></span>
              <span className="si-pmeta-chip">CPU: <strong>{agentData.cpuName}</strong></span>
              <span className="si-pmeta-chip">RAM: <strong>{agentData.totalRamGB} GB</strong></span>
              <span className="si-pmeta-chip">Discos: <strong>{agentData.disks.length}</strong></span>
              <span className="si-pmeta-chip">Adaptadores red: <strong>{agentData.netAdapters?.length ?? 0}</strong></span>
            </div>

            {agSections.map((sec, sIdx) => (
              <PrintBlock key={sIdx} wide={sec.title.startsWith("Disco")} title={sec.title.toUpperCase()} badge={`${sec.rows.length} campos`} rows={sec.rows} />
            ))}

            {brows.length > 0 && (
              <PrintBlock title="🌐 ENTORNO DEL NAVEGADOR" badge={`${brows.length} campos`} rows={brows} />
            )}
          </>
        )}
        <div className="si-pf">
          <span className="si-pf-l">CoreKit Diagnostic Suite · <strong>{agentData?.hostname || "—"}</strong> · S/N {agentData?.boardSerial || "—"}</span>
          <span className="si-pf-r">Generado el <strong>{new Date().toLocaleDateString(lang === "ES" ? "es-ES" : "en-US")}</strong></span>
        </div>
      </div>
        </div>,
        document.body
      )}

      {/* ══════════════ SCREEN UI ══════════════ */}
      <div className="w-full max-w-[100vw] px-4 md:px-8 mt-6 md:mt-8 pb-12 mx-auto flex gap-5 items-start" style={{ animation: "fadeIn 0.3s ease" }}>
        <div className="flex-1 min-w-0 space-y-3">

          {/* ─── WAITING STATE ─── */}
          {!isLive && (
            <div className="space-y-3" style={{ animation: "scIn 0.25s ease" }}>
              <div className="si-c" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "22px 20px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(99,102,241,0.1)", border: "1.5px solid rgba(99,102,241,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: IC }}>
                      <Cpu style={{ width: 20, height: 20 }} />
                    </div>
                    <div>
                      <p style={{ fontSize: 15, fontWeight: 900, color: "var(--text-main)", margin: 0 }}>{t.heroT}</p>
                      <p style={{ fontSize: 10.5, color: "var(--text-muted)", margin: 0 }}>{t.heroS}</p>
                    </div>
                  </div>
                  <button onClick={openDl} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 18px", borderRadius: 12, background: "linear-gradient(135deg,#6366f1,#8b5cf6 55%,#a78bfa)", boxShadow: "0 8px 24px rgba(99,102,241,0.42)", color: "#fff", fontWeight: 900, fontSize: 12.5, border: "none", cursor: "pointer", width: "fit-content" }}>
                    <Download style={{ width: 15, height: 15 }} />{t.dlBtn}
                    <span style={{ fontSize: 8.5, fontWeight: 700, background: "rgba(255,255,255,0.2)", padding: "2px 6px", borderRadius: 999, marginLeft: 2 }}>v3.2 · ~9MB</span>
                  </button>
                  <p style={{ fontSize: 9, color: "var(--text-muted)", margin: 0 }}>Windows · macOS · Linux · 64-bit · Sin instalación</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", borderTop: "1px solid var(--border-split)" }}>
                  {[
                    { a: "si-a1", g: "si-g1", icon: <Download style={{ width: 16, height: 16 }} />, ti: t.s1, de: t.s1d },
                    { a: "si-a2", g: "si-g2", icon: <Zap style={{ width: 16, height: 16 }} />, ti: t.s2, de: t.s2d },
                    { a: "si-a3", g: "si-g3", icon: <BarChart3 style={{ width: 16, height: 16 }} />, ti: t.s3, de: t.s3d },
                  ].map((s, i) => (
                    <div key={i} className={s.g} style={{ padding: "14px 12px", borderLeft: i > 0 ? "1px solid var(--border-split)" : "none", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 6 }}>
                      <div className={s.a} style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(99,102,241,0.09)", border: "1.5px solid rgba(99,102,241,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: IC }}>
                        {s.icon}
                      </div>
                      <p style={{ fontSize: 11, fontWeight: 900, color: "var(--text-main)", margin: 0 }}>{s.ti}</p>
                      <p style={{ fontSize: 9.5, color: "var(--text-muted)", margin: 0, lineHeight: 1.4 }}>{s.de}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="si-c" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 14 }}>
                <RadarWaiting />
                <div>
                  <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-main)", margin: "0 0 3px" }}>{t.searching}</p>
                  {agentStatus === "error" && <p style={{ fontSize: 10, color: "#f59e0b", margin: "0 0 2px" }}>{t.retrying}</p>}
                  <p style={{ fontSize: 9, color: "var(--text-muted)", margin: 0, fontFamily: "monospace" }}>ws://localhost:8765</p>
                </div>
              </div>
              {snap && (
                <div className="si-c" style={{ padding: 12 }}>
                  <p style={{ fontSize: 9, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 9px" }}>Datos del navegador</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6 }}>
                    {[
                      { k: t.secOS, v: `${snap.os} ${snap.osVersionHint}` },
                      { k: "Navegador", v: `${snap.browser} ${snap.browserVersion}` },
                      { k: "CPU lógicos", v: snap.cpuCores ? `${snap.cpuCores} núcleos` : "—" },
                      { k: "GPU (WebGL)", v: snap.gpuRenderer.slice(0, 38) + (snap.gpuRenderer.length > 38 ? "…" : "") },
                    ].map((r, idx) => (
                      <div key={idx} style={{ background: "rgba(99,102,241,0.04)", borderRadius: 8, padding: "7px 9px", border: "1px solid rgba(99,102,241,0.1)" }}>
                        <p style={{ fontSize: 8.5, fontWeight: 700, color: "var(--text-muted)", margin: "0 0 2px", textTransform: "uppercase" }}>{r.k}</p>
                        <p style={{ fontSize: 10.5, fontWeight: 700, fontFamily: "monospace", color: "var(--text-main)", margin: 0, wordBreak: "break-word" }}>{r.v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── CONNECTED STATE ─── */}
          {isLive && agentData && (
            <>
              {/* Status bar */}
              <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 13px", borderRadius: 12, background: "rgba(16,185,129,0.07)", border: "1.5px solid rgba(16,185,129,0.32)", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(16,185,129,0.13)", border: "1.5px solid rgba(16,185,129,0.36)", borderRadius: 999, padding: "3px 10px" }}>
                  <span className="si-aDot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
                  <span style={{ fontSize: 8.5, fontWeight: 900, color: "#10b981", fontFamily: "monospace", letterSpacing: "0.1em" }}>{t.liveBadge}</span>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: "#10b981", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agentData.cpuName}</span>
                <button onClick={openHelp} style={{ width: 26, height: 26, borderRadius: "50%", border: "1px solid var(--border-split)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <HelpCircle style={{ width: 13, height: 13 }} />
                </button>
                <button onClick={handlePrintEssential} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, background: tab === "essential" ? IC : "transparent", border: `1px solid ${tab === "essential" ? IC : "var(--border-split)"}`, color: tab === "essential" ? "#fff" : "var(--text-muted)", fontWeight: 700, fontSize: 10.5, cursor: "pointer" }}>
                  <Printer style={{ width: 11, height: 11 }} />{tab === "essential" ? t.printEssBtn : t.printEngBtn}
                </button>
                {tab === "engineering" && (
                  <button onClick={handlePrintEngineering} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, background: IC, border: "none", color: "#fff", fontWeight: 700, fontSize: 10.5, cursor: "pointer" }}>
                    <Printer style={{ width: 11, height: 11 }} />{t.printEngBtn}
                  </button>
                )}
              </div>

              {/* Tabs */}
              <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 12, border: "1px solid var(--border-split)", background: "var(--bg-surface)" }}>
                {(["essential", "engineering"] as Tab[]).map(tid => (
                  <button key={tid} onClick={() => setTab(tid)} className="si-tab"
                    style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 0", borderRadius: 9, fontSize: 11.5, fontWeight: 900, border: "none", cursor: "pointer", background: tab === tid ? IC : "transparent", color: tab === tid ? "#fff" : "var(--text-muted)" }}>
                    {tid === "essential" ? <Sparkles style={{ width: 13, height: 13 }} /> : <Layers style={{ width: 13, height: 13 }} />}
                    {tid === "essential" ? t.tabE : t.tabI}
                  </button>
                ))}
              </div>

              {/* ══ ESSENTIAL ══ */}
              {tab === "essential" && (
                <div style={{ animation: "scIn 0.2s ease" }} className="space-y-3">

                  {/* ROW 1: Device identity (FIRST — most searched) */}
                  <div className="si-c" style={{ background: "linear-gradient(135deg,rgba(99,102,241,0.05),rgba(139,92,246,0.03))", borderColor: "rgba(99,102,241,0.18)" }}>
                    <SH icon={<Shield style={{ width: 14, height: 14 }} />} title={t.secDevice} badge={<Badge label="psutil" color="#10b981" />} />
                    <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 9, lineHeight: 1.5 }}>
                      <Info style={{ width: 10, height: 10, display: "inline", marginRight: 3, verticalAlign: "middle" }} />{t.idNote}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7 }}>
                      {[
                        { k: t.hostLabel, v: agentData.hostname || "—" },
                        { k: t.serialLabel, v: agentData.boardSerial },
                        { k: t.macLabel, v: agentData.macAddress || "—" },
                      ].map((r, idx) => (
                        <div key={idx} style={{ background: "var(--bg-surface)", borderRadius: 7, padding: "8px 10px", border: "1px solid var(--border-split)" }}>
                          <p style={{ fontSize: 8, fontWeight: 700, color: "var(--text-muted)", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.06em" }}>{r.k}</p>
                          <p style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace", color: "var(--text-main)", margin: 0, wordBreak: "break-all" }}>{r.v}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ROW 2: OS (full width, no browser data) */}
                  <div className="si-c">
                    <SH icon={<Globe style={{ width: 14, height: 14 }} />} title={t.secOS} badge={<Badge label="psutil" color="#10b981" />} />
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <p style={{ fontSize: 20, fontWeight: 900, color: "var(--text-main)", margin: "0 0 3px", lineHeight: 1.1 }}>
                          {agentData.osName} {agentData.osRelease}
                          {agentData.osEdition ? <span style={{ fontSize: 14, fontWeight: 800, color: IC, marginLeft: 6 }}>{agentData.osEdition}</span> : null}
                        </p>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          {agentData.osDisplayVersion && agentData.osDisplayVersion !== "—" && (
                            <span style={{ fontSize: 10, fontWeight: 800, fontFamily: "monospace", color: "#10b981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 6, padding: "2px 7px" }}>versión {agentData.osDisplayVersion}</span>
                          )}
                          <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>Build {agentData.osVersion}</span>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, minWidth: 300 }}>
                        <div style={{ background: "rgba(99,102,241,0.05)", borderRadius: 8, padding: "7px 10px" }}>
                          <p style={{ fontSize: 8, fontWeight: 700, color: "var(--text-muted)", margin: "0 0 2px", textTransform: "uppercase" }}>Arquitectura</p>
                          <p style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace", color: "var(--text-main)", margin: 0 }}>{agentData.cpuArch || "x64"}</p>
                        </div>
                        <div style={{ background: "rgba(99,102,241,0.05)", borderRadius: 8, padding: "7px 10px" }}>
                          <p style={{ fontSize: 8, fontWeight: 700, color: "var(--text-muted)", margin: "0 0 2px", textTransform: "uppercase" }}>Fabricante / Modelo</p>
                          <p style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace", color: "var(--text-main)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${agentData.systemVendor || agentData.boardVendor || "—"} ${agentData.systemModel || agentData.boardModel || ""}`.trim() || "—"}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ROW 2b: Placa base / BIOS / Sistema (systeminfo) */}
                  <div className="si-c">
                    <SH icon={<Server style={{ width: 14, height: 14 }} />} title="Placa Base · BIOS · Sistema" badge={<Badge label="psutil" color="#10b981" />} />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 7 }}>
                      {[
                        { k: "Fabricante placa base", v: agentData.boardVendor || "—" },
                        { k: "Modelo placa base", v: agentData.boardModel || "—" },
                        { k: "Modelo del sistema", v: agentData.systemModel || "—" },
                        { k: "SKU del sistema", v: agentData.systemSKU || "—" },
                        { k: "BIOS — Fabricante", v: agentData.biosVendor || "—" },
                        { k: "BIOS — Versión", v: agentData.biosVersion || "—" },
                        { k: "Modo BIOS", v: agentData.biosMode || "—" },
                        { k: "SMBIOS", v: agentData.smbiosVersion || "—" },
                        { k: "Arranque seguro", v: agentData.secureBoot || "—" },
                        { k: "Tipo de sistema", v: agentData.systemType || "—" },
                        { k: "Dominio / Grupo", v: agentData.domain || "—" },
                      ].map((r, idx) => (
                        <div key={idx} style={{ background: "rgba(99,102,241,0.04)", borderRadius: 7, padding: "6px 8px", border: "1px solid rgba(99,102,241,0.08)" }}>
                          <p style={{ fontSize: 7.5, fontWeight: 700, color: "var(--text-muted)", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{r.k}</p>
                          <p style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: "var(--text-main)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.v}>{r.v}</p>
                        </div>
                      ))}
                    </div>
                    {(agentData.osInstallDate || agentData.osLastBoot || agentData.uptime_secs) && (
                      <div style={{ display: "flex", gap: 14, marginTop: 9, flexWrap: "wrap", paddingTop: 9, borderTop: "1px solid var(--border-split)" }}>
                        {agentData.osInstallDate && agentData.osInstallDate !== "—" && <span style={{ fontSize: 9.5, color: "var(--text-muted)" }}>Instalación Windows: <strong style={{ color: "var(--text-main)", fontFamily: "monospace" }}>{agentData.osInstallDate}</strong></span>}
                        {agentData.osLastBoot && agentData.osLastBoot !== "—" && <span style={{ fontSize: 9.5, color: "var(--text-muted)" }}>Último arranque: <strong style={{ color: "var(--text-main)", fontFamily: "monospace" }}>{agentData.osLastBoot}</strong></span>}
                        {agentData.uptime_secs ? <span style={{ fontSize: 9.5, color: "var(--text-muted)" }}>Encendido hace: <strong style={{ color: "#10b981", fontFamily: "monospace" }}>{Math.floor(agentData.uptime_secs / 3600)}h {Math.floor((agentData.uptime_secs % 3600) / 60)}m</strong></span> : null}
                      </div>
                    )}
                  </div>

                  {/* ROW 3: CPU + RAM */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {/* CPU */}
                    <div className="si-c">
                      <SH icon={<Cpu style={{ width: 14, height: 14 }} />} title={t.secCPU} badge={<Badge label="psutil" color="#10b981" />} />
                      <p style={{ fontSize: 11.5, fontWeight: 800, fontFamily: "monospace", color: "var(--text-main)", margin: "0 0 10px", wordBreak: "break-word" }}>{agentData.cpuName}</p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
                        <StatBox value={String(agentData.cpuPhysical)} label={t.phys} />
                        <StatBox value={String(agentData.cpuCores)} label={t.logical} />
                        <StatBox value={agentData.cpu_freq_mhz ? String(agentData.cpu_freq_mhz) : "—"} unit="MHz" label={t.freqCur} color="#f59e0b" />
                        <StatBox value={agentData.cpu_freq_max_mhz ? String(agentData.cpu_freq_max_mhz) : "—"} unit="MHz" label={t.freqMax} color="#10b981" />
                      </div>
                      {(agentData.cpuSocket || agentData.cpuL3KB || agentData.cpuVirt !== undefined) && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                          {agentData.cpuSocket && agentData.cpuSocket !== "—" && <span style={{ fontSize: 9, color: "var(--text-muted)", background: "rgba(99,102,241,0.05)", borderRadius: 6, padding: "3px 8px" }}>Socket: <strong style={{ fontFamily: "monospace" }}>{agentData.cpuSocket}</strong></span>}
                          {agentData.cpuL3KB ? <span style={{ fontSize: 9, color: "var(--text-muted)", background: "rgba(99,102,241,0.05)", borderRadius: 6, padding: "3px 8px" }}>L3: <strong style={{ fontFamily: "monospace" }}>{(agentData.cpuL3KB / 1024).toFixed(1)} MB</strong></span> : null}
                          {agentData.cpuVirt !== undefined && <span style={{ fontSize: 9, color: agentData.cpuVirt ? "#10b981" : "var(--text-muted)", background: "rgba(99,102,241,0.05)", borderRadius: 6, padding: "3px 8px" }}>Virtualización: <strong>{agentData.cpuVirt ? "Sí" : "No"}</strong></span>}
                        </div>
                      )}
                      {history.length > 2 && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600 }}>Uso CPU en vivo</span>
                            <span style={{ fontSize: 9.5, fontFamily: "monospace", fontWeight: 800, color: cpuC(agentData.cpu_usage) }}>{agentData.cpu_usage.toFixed(1)}%</span>
                          </div>
                          <Sparkline data={cpuHist} color="#6366f1" h={34} />
                        </div>
                      )}
                      {agentData.cpu_per_core && agentData.cpu_per_core.length > 0 && (
                        <div>
                          <p style={{ fontSize: 8.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 6px" }}>{t.coreAct}</p>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(72px,1fr))", gap: 4 }}>
                            {agentData.cpu_per_core.map((v, i) => (
                              <div key={i}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                                  <span style={{ fontSize: 8, color: "var(--text-muted)" }}>C{i}</span>
                                  <span style={{ fontSize: 8, fontFamily: "monospace", fontWeight: 700, color: cpuC(v) }}>{v.toFixed(0)}%</span>
                                </div>
                                <div style={{ height: 4, background: "rgba(148,163,184,0.14)", borderRadius: 999, overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${v}%`, background: cpuC(v), borderRadius: 999, transition: "width 0.5s" }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="si-c">
                      <SH icon={<MemoryStick style={{ width: 14, height: 14 }} />} title={t.secRAM} badge={<Badge label="psutil" color="#10b981" />} onHelp={() => openInfo("ram")} />
                      {agentData.ramModules.length > 0 && (() => {
                        const byKey: Record<string, number> = {};
                        agentData.ramModules.forEach(m => {
                          const ty = m.memType || (m.speedMHz >= 4800 ? "DDR5" : m.speedMHz >= 2133 ? "DDR4" : "DDR3");
                          const ff = m.formFactor && m.formFactor !== "—" ? m.formFactor : "DIMM";
                          const k = `${m.capacityGB}|${m.speedMHz}|${ty}|${ff}`;
                          byKey[k] = (byKey[k] || 0) + 1;
                        });
                        const parts = Object.entries(byKey).map(([k, n]) => {
                          const [gb, mhz, ty, ff] = k.split("|");
                          return `${n}× ${gb} GB ${ty} ${ff} a ${mhz} MHz`;
                        });
                        const dualChannel = agentData.ramModules.length >= 2;
                        return (
                          <div style={{ background: "linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.05))", border: "1.5px solid rgba(99,102,241,0.3)", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                            <p style={{ fontSize: 10.5, fontWeight: 800, color: IC, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>📌 Resumen para comprar / ampliar</p>
                            <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-main)", margin: 0, lineHeight: 1.5 }}>
                              Tu equipo tiene <span style={{ color: IC }}>{parts.join(" + ")}</span>
                              {dualChannel && <span style={{ color: "#10b981" }}> · Dual-Channel activo ✓</span>}
                            </p>
                            <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "4px 0 0", lineHeight: 1.5 }}>
                              Para ampliar, busca módulos del <strong>mismo tipo y factor de forma</strong> ({Object.keys(byKey).map(k => k.split("|").slice(2).join(" ")).join(" / ")}). Compra siempre <strong>en pares idénticos</strong> para mantener Dual-Channel.
                            </p>
                          </div>
                        );
                      })()}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                        <StatBox value={`${agentData.totalRamGB}`} unit="GB" label={t.total} />
                        <StatBox value={`${agentData.ram_used_gb}`} unit="GB" label={t.used} color={ramC(agentData.ram_usage)} />
                        <StatBox value={`${(agentData.totalRamGB - agentData.ram_used_gb).toFixed(1)}`} unit="GB" label={t.free} color="#10b981" />
                      </div>
                      <Bar v={agentData.ram_usage} color={ramC(agentData.ram_usage)} label={t.used} valLabel={`${agentData.ram_usage.toFixed(1)}%`} />
                      {agentData.totalRamGB < 16 && (
                        <div style={{ marginTop: 8, background: "rgba(245,158,11,0.07)", border: "1.5px solid rgba(245,158,11,0.28)", borderRadius: 8, padding: "8px 10px" }}>
                          <p style={{ fontSize: 10.5, fontWeight: 900, color: "#f59e0b", margin: "0 0 2px" }}>⚠ {t.ramSugT}</p>
                          <p style={{ fontSize: 9.5, color: "var(--text-muted)", margin: 0, lineHeight: 1.4 }}>{t.ramSugB}</p>
                        </div>
                      )}
                      {agentData.ramModules.length > 0 && (() => {
                        // Group by capacityGB+speed+memType+formFactor
                        const groups = new Map<string, { qty: number; m: RamModule; ty: string }>();
                        for (const m of agentData.ramModules) {
                          const ty = m.memType || (m.speedMHz >= 4800 ? "DDR5" : m.speedMHz >= 2133 ? "DDR4" : "DDR3");
                          const key = `${m.capacityGB}|${ty}|${m.formFactor || ""}|${m.speedMHz}`;
                          const g = groups.get(key);
                          if (g) g.qty += 1; else groups.set(key, { qty: 1, m, ty });
                        }
                        const parts: string[] = [];
                        const ffSet = new Set<string>();
                        groups.forEach(g => {
                          parts.push(`${g.qty}× ${g.m.capacityGB} GB ${g.ty}${g.m.formFactor && g.m.formFactor !== "—" ? " " + g.m.formFactor : ""} a ${g.m.speedMHz} MHz`);
                          if (g.m.formFactor) ffSet.add(g.m.formFactor);
                        });
                        const dualCh = agentData.ramModules.length >= 2 && groups.size === 1;
                        const buyHint = ffSet.has("SODIMM")
                          ? "Para ampliar busca módulos SODIMM compatibles (laptop)."
                          : ffSet.has("DIMM")
                          ? "Para ampliar busca módulos DIMM compatibles (escritorio)."
                          : "Asegúrate de comprar el mismo tipo y factor de forma.";
                        return (
                          <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.06))", border: "1.5px solid rgba(99,102,241,0.28)" }}>
                            <p style={{ fontSize: 9.5, fontWeight: 900, color: IC, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>📌 Resumen para comprar / ampliar</p>
                            <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-main)", margin: "0 0 3px", lineHeight: 1.4 }}>
                              Tu equipo tiene <strong style={{ color: IC }}>{parts.join(" + ")}</strong>{dualCh ? <span style={{ color: "#10b981" }}> · Dual-Channel activo ✓</span> : null}
                            </p>
                            <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0, lineHeight: 1.45 }}>{buyHint} Para Dual-Channel compra módulos idénticos por pares.</p>
                          </div>
                        );
                      })()}
                      {agentData.ramModules.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <p style={{ fontSize: 8.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px" }}>{t.ramVis}</p>
                          {agentData.ramModules.map((m, i) => {
                            const ty = m.memType || (m.speedMHz >= 4800 ? "DDR5" : m.speedMHz >= 2133 ? "DDR4" : "DDR3");
                            return (
                              <div key={i} style={{ marginBottom: 7 }}>
                                <RamStick speed={m.speedMHz} type={ty} gb={m.capacityGB} />
                                <p style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2, fontFamily: "monospace" }}>{t.ramSlot} {i+1} · {m.capacityGB}GB · {m.speedMHz}MHz · {ty}{m.formFactor && m.formFactor !== "—" ? ` · ${m.formFactor}` : ""} · {m.manufacturer} {m.partNumber}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ROW 4: Disks */}
                  <div className="si-c">
                    <SH icon={<HardDrive style={{ width: 14, height: 14 }} />} title={t.secDisk} badge={<Badge label="psutil" color="#10b981" />} onHelp={() => openInfo("disk")} />
                    {agentData.disks.length > 0 && (() => {
                      const totGB = agentData.disks.reduce((s, d) => s + (d.sizeGB || 0), 0);
                      const usedGB = agentData.disks.reduce((s, d) => s + (d.usedGB || 0), 0);
                      const freeGB = totGB - usedGB;
                      const fmtCap = (g: number) => g >= 1000 ? `${(g / 1024).toFixed(2)} TB` : `${g.toFixed(0)} GB`;
                      const nDisks = agentData.disks.length;
                      const label = nDisks > 1 ? `Total combinado (${nDisks} discos)` : t.total;
                      return totGB > 0 ? (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                          <StatBox value={fmtCap(totGB)} label={label} />
                          <StatBox value={fmtCap(usedGB)} label={t.dUsed} color={diskC(usedGB / totGB * 100)} />
                          <StatBox value={fmtCap(freeGB)} label={t.dFree} color="#10b981" />
                        </div>
                      ) : null;
                    })()}
                    {agentData.disks.length > 0 && (() => {
                      // Resumen para comprar: agrupar por tipo+capacidad redondeada
                      const round = (g: number) => g >= 900 ? `${Math.round(g / 1024 * 10) / 10} TB` : g >= 400 ? `${Math.round(g / 256) * 256} GB` : g >= 200 ? "240 GB" : g >= 100 ? "128 GB" : `${Math.round(g)} GB`;
                      const groups = new Map<string, number>();
                      for (const d of agentData.disks) {
                        if (d.sizeGB <= 0) continue;
                        const k = `${d.type}|${round(d.sizeGB)}`;
                        groups.set(k, (groups.get(k) || 0) + 1);
                      }
                      const parts: string[] = [];
                      groups.forEach((qty, k) => {
                        const [ty, cap] = k.split("|");
                        parts.push(`${qty}× ${ty} de ${cap}`);
                      });
                      const types = new Set(agentData.disks.map(d => d.type));
                      const buyHint = types.has("NVMe")
                        ? "Para ampliar un NVMe verifica si tu placa tiene otra ranura M.2 libre (PCIe 3.0/4.0)."
                        : types.has("SSD")
                        ? "Tu equipo usa SSD SATA. Si tu placa soporta NVMe M.2, considera migrar para velocidades 5–10× mayores."
                        : "Considera migrar a SSD para mejorar drásticamente el rendimiento.";
                      return parts.length > 0 ? (
                        <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: "linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.06))", border: "1.5px solid rgba(99,102,241,0.28)" }}>
                          <p style={{ fontSize: 9.5, fontWeight: 900, color: IC, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 4px" }}>📌 Resumen para comprar / ampliar</p>
                          <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-main)", margin: "0 0 3px", lineHeight: 1.4 }}>
                            Tu equipo tiene <strong style={{ color: IC }}>{parts.join(" + ")}</strong>
                          </p>
                          <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0, lineHeight: 1.45 }}>{buyHint}</p>
                        </div>
                      ) : null;
                    })()}
                    {agentData.disks.length > 0 ? (
                      <div style={{ display: "grid", gridTemplateColumns: agentData.disks.length === 1 ? "1fr" : agentData.disks.length === 2 ? "1fr 1fr" : "repeat(auto-fill,minmax(240px,1fr))", gap: 9 }}>
                        {agentData.disks.map((d, i) => {
                          const cm = cleanDiskModel(d.model);
                          const pct = d.usedPct ?? 0;
                          const hasSize = d.sizeGB > 0;
                          const fmtCap = (g: number) => g >= 1000 ? `${(g / 1024).toFixed(2)} TB` : `${g.toFixed(0)} GB`;
                          const healthOk = d.health && d.health.toLowerCase() === "healthy";
                          return (
                            <div key={i} style={{ background: "rgba(99,102,241,0.04)", borderRadius: 10, padding: "10px 11px", border: "1px solid rgba(99,102,241,0.1)" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                                <HardDrive style={{ width: 13, height: 13, color: IC, flexShrink: 0 }} />
                                <p style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace", color: "var(--text-main)", margin: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cm}</p>
                                <DiskBadge model={d.type || d.model} />
                              </div>
                              <div style={{ margin: "0 0 7px" }}>
                                <DiskSVG type={d.type || d.model} />
                              </div>
                              {hasSize && pct > 0 ? (
                                <Bar v={pct} color={diskC(pct)} label={`${fmtCap(d.sizeGB)} · ${fmtCap(d.usedGB ?? 0)} ${t.dUsed}`} valLabel={`${pct.toFixed(0)}%`} />
                              ) : (
                                <p style={{ fontSize: 11, fontFamily: "monospace", color: hasSize ? "var(--text-main)" : "var(--text-muted)", margin: "0 0 4px", fontWeight: hasSize ? 800 : 400 }}>
                                  {hasSize ? fmtCap(d.sizeGB) : t.diskNA}
                                </p>
                              )}
                              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5, alignItems: "center" }}>
                                {d.health && d.health !== "—" && (
                                  <span style={{ fontSize: 8.5, fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: healthOk ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)", color: healthOk ? "#10b981" : "#f59e0b", border: `1px solid ${healthOk ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}` }}>{healthOk ? "✓ Saludable" : d.health}</span>
                                )}
                                {d.formFactor && d.formFactor !== "—" && <span style={{ fontSize: 8.5, fontWeight: 800, color: "#fff", fontFamily: "monospace", background: IC, padding: "2px 7px", borderRadius: 999 }}>{d.formFactor}</span>}
                                {d.bus && d.bus !== "—" && <span style={{ fontSize: 8.5, fontWeight: 700, color: "#a78bfa", fontFamily: "monospace", background: "rgba(139,92,246,0.12)", padding: "2px 7px", borderRadius: 999, border: "1px solid rgba(139,92,246,0.25)" }}>Bus: {d.bus}</span>}
                                {d.partStyle && d.partStyle !== "—" && <span style={{ fontSize: 8.5, color: "var(--text-muted)", fontFamily: "monospace", background: "rgba(148,163,184,0.1)", padding: "2px 7px", borderRadius: 999 }}>{d.partStyle}</span>}
                                {d.partitions ? <span style={{ fontSize: 8.5, color: "var(--text-muted)", fontFamily: "monospace" }}>{d.partitions} partic.</span> : null}
                              </div>
                              {d.busSpeed && <p style={{ fontSize: 8.5, color: "#10b981", margin: "3px 0 0", fontFamily: "monospace", fontWeight: 600 }}>⚡ {d.busSpeed}</p>}
                              <div style={{ marginTop: 4, fontSize: 8.5, color: "var(--text-muted)", fontFamily: "monospace", display: "flex", flexDirection: "column", gap: 1 }}>
                                {d.serial && d.serial !== "—" && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.serial}>S/N: {d.serial}</span>}
                                {d.firmware && d.firmware !== "—" && <span>Firmware: {d.firmware}</span>}
                                {d.usage && d.usage !== "—" && <span>Uso: {d.usage}</span>}
                              </div>
                              {d.readBytesPS !== undefined && (
                                <div style={{ display: "flex", gap: 10, marginTop: 5, paddingTop: 5, borderTop: "1px solid var(--border-split)" }}>
                                  <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{t.dRead}: <strong style={{ color: "#6366f1", fontFamily: "monospace" }}>{fmtBytes(d.readBytesPS ?? 0)}</strong></span>
                                  <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{t.dWrite}: <strong style={{ color: "#10b981", fontFamily: "monospace" }}>{fmtBytes(d.writeBytesPS ?? 0)}</strong></span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : <p style={{ fontSize: 11, color: "var(--text-muted)" }}>—</p>}
                    {agentData.volumes && agentData.volumes.length > 0 && (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-split)" }}>
                        <p style={{ fontSize: 8.5, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px" }}>Unidades lógicas (particiones)</p>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8 }}>
                          {agentData.volumes.map((v, i) => {
                            const fmtCap = (g: number) => g >= 1000 ? `${(g / 1024).toFixed(2)} TB` : `${g.toFixed(0)} GB`;
                            const physical = agentData.disks.find(d => d.diskIdx === v.diskIdx);
                            return (
                              <div key={i} style={{ background: "rgba(99,102,241,0.04)", borderRadius: 8, padding: "8px 10px", border: "1px solid rgba(99,102,241,0.08)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                                  <span style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace", color: "var(--text-main)" }}>{v.mount}{v.label ? ` (${v.label})` : ""}</span>
                                  <span style={{ fontSize: 8.5, fontFamily: "monospace", color: "var(--text-muted)" }}>{v.fs}</span>
                                </div>
                                <Bar v={v.usedPct} color={diskC(v.usedPct)} label={`${fmtCap(v.usedGB)} / ${fmtCap(v.sizeGB)}`} valLabel={`${v.usedPct.toFixed(0)}%`} thin />
                                <p style={{ fontSize: 8.5, color: "var(--text-muted)", margin: "2px 0 0", fontFamily: "monospace" }}>{fmtCap(v.freeGB)} {t.dFree}</p>
                                {physical && (
                                  <p style={{ fontSize: 8, color: IC, margin: "3px 0 0", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700 }} title={physical.model}>
                                    → {cleanDiskModel(physical.model)} ({physical.type})
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ROW 5: GPU + Display + Net + Battery */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {/* GPU */}
                    <div className="si-c">
                      <SH icon={<Monitor style={{ width: 14, height: 14 }} />} title={t.secGPU} badge={agentData.gpus && agentData.gpus.length > 0 ? <Badge label="psutil" color="#10b981" /> : undefined} />
                      {agentData.gpus && agentData.gpus.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {agentData.gpus.map((g, i) => (
                            <div key={i} style={{ background: "rgba(99,102,241,0.04)", borderRadius: 8, padding: "8px 10px", border: "1px solid rgba(99,102,241,0.08)" }}>
                              <p style={{ fontSize: 11.5, fontWeight: 800, fontFamily: "monospace", color: "var(--text-main)", margin: "0 0 2px" }}>{g.name}</p>
                              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                                {g.vram && g.vram !== "—" && <span style={{ fontSize: 9, color: "var(--text-muted)" }}>VRAM: <strong style={{ color: IC, fontFamily: "monospace" }}>{g.vram}</strong></span>}
                                {g.driver && g.driver !== "—" && <span style={{ fontSize: 9, color: "var(--text-muted)" }}>Driver: <strong style={{ fontFamily: "monospace" }}>{g.driver}</strong></span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : agentData.gpuName && agentData.gpuName !== "—" ? (
                        <p style={{ fontSize: 12, fontWeight: 800, fontFamily: "monospace", color: "var(--text-main)", margin: "0 0 6px" }}>{agentData.gpuName}</p>
                      ) : null}
                      {snap && (
                        <div style={{ marginTop: 8 }}>
                          <p style={{ fontSize: 8, fontWeight: 700, color: "var(--text-muted)", margin: "0 0 2px", textTransform: "uppercase" }}>Render WebGL (navegador)</p>
                          <p style={{ fontSize: 9.5, fontWeight: 600, fontFamily: "monospace", color: "var(--text-muted)", margin: 0, wordBreak: "break-word" }}>{snap.gpuRenderer}</p>
                        </div>
                      )}
                    </div>

                    {/* Display */}
                    {snap && (
                      <div className="si-c">
                        <SH icon={<MonitorSmartphone style={{ width: 14, height: 14 }} />} title={t.secDisplay} />
                        <KV k={t.resPhys} v={`${snap.screenW} × ${snap.screenH}`} />
                        <KV k={t.resAvail} v={`${snap.screenAvailW} × ${snap.screenAvailH}`} />
                        <KV k={t.dpr} v={`${snap.dpr}x`} />
                        <KV k={t.depth} v={`${snap.colorDepth}-bit`} />
                        {snap.hdr && <KV k="HDR" v="Soportado" />}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {/* Network */}
                    <div className="si-c">
                      <SH icon={<Wifi style={{ width: 14, height: 14 }} />} title={t.secNet} badge={agentData.netAdapters && agentData.netAdapters.length > 0 ? <Badge label="psutil" color="#10b981" /> : undefined} />
                      {agentData.netAdapters && agentData.netAdapters.length > 0 ? (
                        agentData.netAdapters.slice(0, 3).map((a, i) => (
                          <div key={i} style={{ marginBottom: i < Math.min(agentData.netAdapters!.length, 3) - 1 ? 8 : 0, paddingBottom: i < Math.min(agentData.netAdapters!.length, 3) - 1 ? 8 : 0, borderBottom: i < Math.min(agentData.netAdapters!.length, 3) - 1 ? "1px solid var(--border-split)" : "none" }}>
                            <p style={{ fontSize: 10.5, fontWeight: 800, color: "var(--text-main)", margin: "0 0 3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</p>
                            {a.ip && <KV k="IP local" v={a.ip} />}
                            {a.mac && <KV k="MAC" v={a.mac} />}
                            {a.linkSpeed && <KV k="Velocidad" v={a.linkSpeed} />}
                          </div>
                        ))
                      ) : snap ? (
                        <>
                          <KV k={t.netType} v={snap.connectionType.toUpperCase()} />
                          <KV k={t.downlink} v={snap.connectionDownlink !== null ? `${snap.connectionDownlink} Mbps` : "—"} />
                          <KV k={t.rtt} v={snap.connectionRtt !== null ? `${snap.connectionRtt} ms` : "—"} />
                        </>
                      ) : null}
                    </div>

                    {/* Battery */}
                    <div className="si-c">
                      <SH icon={<Battery style={{ width: 14, height: 14 }} />} title={t.secBatt} badge={agentData.batteryCycles !== undefined ? <Badge label="psutil" color="#10b981" /> : undefined} />
                      {agBatt !== null ? (
                        <>
                          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                            <p style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: agBatt > 20 ? "#06b6d4" : "#ef4444", margin: 0 }}>{agBatt}%</p>
                            {agentData.batteryWearPct !== undefined && agentData.batteryWearPct !== null && (
                              <span style={{ fontSize: 10, fontWeight: 800, fontFamily: "monospace", padding: "2px 7px", borderRadius: 999, background: agentData.batteryWearPct < 15 ? "rgba(16,185,129,0.12)" : agentData.batteryWearPct < 35 ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)", color: agentData.batteryWearPct < 15 ? "#10b981" : agentData.batteryWearPct < 35 ? "#f59e0b" : "#ef4444" }}>
                                Desgaste: {agentData.batteryWearPct}%
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: 10, fontWeight: 700, color: agentData.battery_plugged ? "#10b981" : "var(--text-muted)", margin: "0 0 7px" }}>{agentData.battery_plugged ? t.charging : t.discharging}</p>
                          <div style={{ height: 7, background: "rgba(148,163,184,0.14)", borderRadius: 999, overflow: "hidden", marginBottom: 8 }}>
                            <div style={{ height: "100%", width: `${agBatt}%`, background: agBatt > 20 ? "#06b6d4" : "#ef4444", borderRadius: 999, transition: "width 0.6s" }} />
                          </div>
                          {(agentData.batteryCycles !== undefined || agentData.batteryDesignCapacityMWh) && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                              {agentData.batteryCycles !== undefined && agentData.batteryCycles > 0 && (
                                <div style={{ background: "rgba(99,102,241,0.05)", borderRadius: 7, padding: "5px 8px" }}>
                                  <p style={{ fontSize: 8, color: "var(--text-muted)", margin: "0 0 1px", textTransform: "uppercase" }}>Ciclos</p>
                                  <p style={{ fontSize: 12, fontWeight: 900, fontFamily: "monospace", color: agentData.batteryCycles < 300 ? "#10b981" : agentData.batteryCycles < 800 ? "#f59e0b" : "#ef4444", margin: 0 }}>{agentData.batteryCycles}</p>
                                </div>
                              )}
                              {agentData.batteryFullCapacityMWh ? (
                                <div style={{ background: "rgba(99,102,241,0.05)", borderRadius: 7, padding: "5px 8px" }}>
                                  <p style={{ fontSize: 8, color: "var(--text-muted)", margin: "0 0 1px", textTransform: "uppercase" }}>Cap. máx.</p>
                                  <p style={{ fontSize: 11, fontWeight: 800, fontFamily: "monospace", color: "var(--text-main)", margin: 0 }}>{(agentData.batteryFullCapacityMWh / 1000).toFixed(1)} Wh</p>
                                </div>
                              ) : null}
                            </div>
                          )}
                          {agentData.batteryChemistry && agentData.batteryChemistry !== "—" && (
                            <p style={{ fontSize: 9, color: "var(--text-muted)", margin: "5px 0 0", fontFamily: "monospace" }}>{agentData.batteryChemistry}{agentData.batteryVoltageMV ? ` · ${(agentData.batteryVoltageMV / 1000).toFixed(2)}V` : ""}</p>
                          )}
                        </>
                      ) : snap?.batteryLevel !== null && snap?.batteryLevel !== undefined ? (
                        <>
                          <p style={{ fontSize: 24, fontWeight: 900, fontFamily: "monospace", color: "#06b6d4", margin: "0 0 7px" }}>{snap.batteryLevel}%</p>
                          <div style={{ height: 7, background: "rgba(148,163,184,0.14)", borderRadius: 999, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${snap.batteryLevel}%`, background: "#06b6d4", borderRadius: 999 }} />
                          </div>
                        </>
                      ) : <p style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{t.battNA}</p>}
                    </div>
                  </div>

                  {/* Note */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: 10, background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.14)" }}>
                    <Info style={{ width: 13, height: 13, color: IC, flexShrink: 0, marginTop: 1 }} />
                    <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>{t.note}</p>
                  </div>
                </div>
              )}

              {/* ══ ENGINEERING ══ */}
              {tab === "engineering" && (
                <div style={{ animation: "scIn 0.2s ease" }} className="space-y-3">

                  {/* Live monitor */}
                  <div className="si-c" style={{ padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                      <span className="si-aDot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981" }} />
                      <p style={{ fontSize: 9.5, fontWeight: 900, color: "#10b981", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>{t.engLive} · psutil</p>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
                      <Ring v={agentData.cpu_usage} color={cpuC(agentData.cpu_usage)} label="CPU" sub={agentData.cpu_freq_mhz ? `${agentData.cpu_freq_mhz} MHz` : undefined} size={96} />
                      <Ring v={agentData.ram_usage} color={ramC(agentData.ram_usage)} label="RAM" sub={`${agentData.ram_used_gb}/${agentData.totalRamGB}GB`} size={96} />
                      {agBatt !== null && <Ring v={agBatt} color={agBatt > 20 ? "#06b6d4" : "#ef4444"} label={t.secBatt} sub={agentData.battery_plugged ? t.charging : t.discharging} size={96} />}
                    </div>
                    {history.length > 2 && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <span style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 600 }}>CPU %</span>
                            <span style={{ fontSize: 9.5, fontFamily: "monospace", fontWeight: 800, color: cpuC(agentData.cpu_usage) }}>{agentData.cpu_usage.toFixed(1)}%</span>
                          </div>
                          <Sparkline data={cpuHist} color="#6366f1" h={50} />
                        </div>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <span style={{ fontSize: 9.5, color: "var(--text-muted)", fontWeight: 600 }}>RAM %</span>
                            <span style={{ fontSize: 9.5, fontFamily: "monospace", fontWeight: 800, color: ramC(agentData.ram_usage) }}>{agentData.ram_usage.toFixed(1)}%</span>
                          </div>
                          <Sparkline data={ramHist} color="#10b981" h={50} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Swap + Temperatures */}
                  {(agentData.swapTotalGB !== undefined || (agentData.temps && Object.keys(agentData.temps).length > 0)) && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div className="si-c" style={{ padding: 14 }}>
                        <p style={{ fontSize: 9.5, fontWeight: 900, color: IC, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 10px" }}>Memoria Swap</p>
                        {agentData.swapTotalGB && agentData.swapTotalGB > 0 ? (
                          <>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
                              <StatBox value={`${agentData.swapTotalGB}`} unit="GB" label="Total" />
                              <StatBox value={`${agentData.swap_used_gb ?? 0}`} unit="GB" label="En uso" color={ramC(agentData.swap_usage ?? 0)} />
                            </div>
                            <Bar v={agentData.swap_usage ?? 0} color={ramC(agentData.swap_usage ?? 0)} label="Uso de swap" valLabel={`${(agentData.swap_usage ?? 0).toFixed(1)}%`} />
                          </>
                        ) : <p style={{ fontSize: 10.5, color: "var(--text-muted)" }}>Sin archivo de paginación activo</p>}
                      </div>
                      <div className="si-c" style={{ padding: 14 }}>
                        <p style={{ fontSize: 9.5, fontWeight: 900, color: IC, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 10px" }}>Temperaturas</p>
                        {agentData.temps && Object.keys(agentData.temps).length > 0 ? (
                          Object.entries(agentData.temps).map(([k, v]) => (
                            <Bar key={k} v={Math.min(v, 100)} color={v > 80 ? "#ef4444" : v > 65 ? "#f59e0b" : "#10b981"} label={k} valLabel={`${v} °C`} thin />
                          ))
                        ) : <p style={{ fontSize: 10.5, color: "var(--text-muted)" }}>Sensores no expuestos por el sistema</p>}
                      </div>
                    </div>
                  )}

                  {/* Per-core + Disk I/O side by side */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {/* Per-core bars */}
                    {agentData.cpu_per_core && agentData.cpu_per_core.length > 0 && (
                      <div className="si-c" style={{ padding: 14 }}>
                        <p style={{ fontSize: 9.5, fontWeight: 900, color: IC, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 10px" }}>{t.engCores}</p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
                          {agentData.cpu_per_core.map((v, i) => (
                            <Bar key={i} v={v} color={cpuC(v)} label={`Core ${i}`} valLabel={`${v.toFixed(0)}%`} thin />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Disk I/O */}
                    <div className="si-c" style={{ padding: 14 }}>
                      <p style={{ fontSize: 9.5, fontWeight: 900, color: IC, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 10px" }}>{t.engDiskIO}</p>
                      {agentData.disks.length > 0 ? agentData.disks.map((d, i) => {
                        const fmtCap = (g: number) => g >= 1000 ? `${(g / 1024).toFixed(2)} TB` : `${g.toFixed(0)} GB`;
                        return (
                        <div key={i} style={{ marginBottom: i < agentData.disks.length - 1 ? 14 : 0, paddingBottom: i < agentData.disks.length - 1 ? 14 : 0, borderBottom: i < agentData.disks.length - 1 ? "1px solid var(--border-split)" : "none" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                            <p style={{ fontSize: 10, fontWeight: 800, fontFamily: "monospace", color: "var(--text-main)", margin: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Disco {(d.diskIdx ?? i) + (d.diskIdx === undefined ? 1 : 0)}: {cleanDiskModel(d.model)}</p>
                            <DiskBadge model={d.type || d.model} />
                            {d.sizeGB > 0 && <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-muted)", fontWeight: 700 }}>{fmtCap(d.sizeGB)}</span>}
                          </div>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 4 }}>
                            {d.formFactor && d.formFactor !== "—" && <span style={{ fontSize: 8, color: IC, fontFamily: "monospace", background: "rgba(99,102,241,0.1)", padding: "1px 5px", borderRadius: 4 }}>{d.formFactor}</span>}
                            {d.bus && d.bus !== "—" && <span style={{ fontSize: 8, color: "var(--text-muted)", fontFamily: "monospace" }}>Bus: {d.bus}</span>}
                            {d.interface && d.interface !== "—" && d.interface !== d.bus && <span style={{ fontSize: 8, color: "var(--text-muted)", fontFamily: "monospace" }}>Int: {d.interface}</span>}
                            {d.health && d.health !== "—" && <span style={{ fontSize: 8, color: d.health.toLowerCase() === "healthy" ? "#10b981" : "#f59e0b", fontFamily: "monospace", fontWeight: 700 }}>● {d.health}</span>}
                            {d.partStyle && d.partStyle !== "—" && <span style={{ fontSize: 8, color: "var(--text-muted)", fontFamily: "monospace" }}>{d.partStyle}</span>}
                          </div>
                          {d.usedPct !== undefined && d.usedPct > 0 && (
                            <Bar v={d.usedPct} color={diskC(d.usedPct)} label={`${fmtCap(d.usedGB ?? 0)} ${t.dUsed} · ${fmtCap(d.freeGB ?? 0)} ${t.dFree}`} valLabel={`${d.usedPct.toFixed(0)}%`} thin />
                          )}
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 5 }}>
                            <div style={{ background: "rgba(99,102,241,0.06)", borderRadius: 6, padding: "5px 8px" }}>
                              <p style={{ fontSize: 7.5, color: "var(--text-muted)", margin: "0 0 1px" }}>{t.dRead}</p>
                              <p style={{ fontSize: 11, fontWeight: 900, fontFamily: "monospace", color: "#6366f1", margin: 0 }}>{fmtBytes(d.readBytesPS ?? 0)}</p>
                            </div>
                            <div style={{ background: "rgba(16,185,129,0.06)", borderRadius: 6, padding: "5px 8px" }}>
                              <p style={{ fontSize: 7.5, color: "var(--text-muted)", margin: "0 0 1px" }}>{t.dWrite}</p>
                              <p style={{ fontSize: 11, fontWeight: 900, fontFamily: "monospace", color: "#10b981", margin: 0 }}>{fmtBytes(d.writeBytesPS ?? 0)}</p>
                            </div>
                          </div>
                          <div style={{ marginTop: 5, fontSize: 8, color: "var(--text-muted)", fontFamily: "monospace", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
                            {d.firmware && d.firmware !== "—" && <span>Firmware: {d.firmware}</span>}
                            {d.partitions ? <span>Particiones: {d.partitions}</span> : null}
                            {d.serial && d.serial !== "—" && <span style={{ gridColumn: "1 / -1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.serial}>S/N: {d.serial}</span>}
                            {d.busSpeed && <span style={{ gridColumn: "1 / -1", color: "#10b981" }}>{d.busSpeed}</span>}
                          </div>
                        </div>
                      );}) : <p style={{ fontSize: 10.5, color: "var(--text-muted)" }}>—</p>}
                    </div>
                  </div>

                  {/* Net I/O */}
                  {agentData.netAdapters && agentData.netAdapters.length > 0 && (
                    <div className="si-c" style={{ padding: 14 }}>
                      <p style={{ fontSize: 9.5, fontWeight: 900, color: IC, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 10px" }}>{t.engNetIO}</p>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10 }}>
                        {agentData.netAdapters.map((a, i) => (
                          <div key={i}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                              <Network style={{ width: 11, height: 11, color: IC }} />
                              <p style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-main)", margin: 0 }}>{a.name}</p>
                              {a.mac && <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-muted)" }}>{a.mac}</span>}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                              <div style={{ background: "rgba(99,102,241,0.06)", borderRadius: 7, padding: "6px 9px" }}>
                                <p style={{ fontSize: 7.5, color: "var(--text-muted)", margin: "0 0 2px" }}>{t.recv}</p>
                                <p style={{ fontSize: 11, fontWeight: 900, fontFamily: "monospace", color: "#6366f1", margin: 0 }}>{fmtBytes(a.bytesRecvPS ?? 0)}</p>
                              </div>
                              <div style={{ background: "rgba(16,185,129,0.06)", borderRadius: 7, padding: "6px 9px" }}>
                                <p style={{ fontSize: 7.5, color: "var(--text-muted)", margin: "0 0 2px" }}>{t.sent}</p>
                                <p style={{ fontSize: 11, fontWeight: 900, fontFamily: "monospace", color: "#10b981", margin: 0 }}>{fmtBytes(a.bytesSentPS ?? 0)}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sub-tablas agrupadas por sección */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))", gap: 10 }}>
                    {agSections.map((sec, idx) => (
                      <div key={idx} className="si-c" style={{ padding: 0, overflow: "hidden" }}>
                        <div style={{ padding: "8px 12px", background: "linear-gradient(135deg,rgba(99,102,241,0.14),rgba(139,92,246,0.07))", borderBottom: "1.5px solid rgba(99,102,241,0.22)", display: "flex", alignItems: "center", gap: 6 }}>
                          <Server style={{ width: 11, height: 11, color: IC }} />
                          <p style={{ fontSize: 9.5, fontWeight: 900, color: IC, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sec.title}</p>
                          <span style={{ fontSize: 8, fontFamily: "monospace", color: "var(--text-muted)" }}>{sec.rows.length}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", padding: "4px 10px 3px", borderBottom: "1px solid var(--border-split)", background: "rgba(99,102,241,0.04)" }}>
                          <span style={{ fontSize: 7.5, fontWeight: 800, color: IC, textTransform: "uppercase", letterSpacing: "0.06em" }}>Parámetro</span>
                          <span style={{ fontSize: 7.5, fontWeight: 800, color: IC, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>Valor</span>
                        </div>
                        <div>
                          {sec.rows.map((r, i) => (
                            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", padding: "4px 10px", background: i % 2 === 0 ? "rgba(99,102,241,0.05)" : "transparent", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{r.k}</span>
                              <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "monospace", color: "var(--text-main)", textAlign: "right", wordBreak: "break-all", lineHeight: 1.4 }}>{r.v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    {/* Browser env */}
                    <div className="si-c" style={{ padding: 0, overflow: "hidden" }}>
                      <div style={{ padding: "8px 12px", background: "linear-gradient(135deg,rgba(99,102,241,0.14),rgba(139,92,246,0.07))", borderBottom: "1.5px solid rgba(99,102,241,0.22)", display: "flex", alignItems: "center", gap: 6 }}>
                        <Globe style={{ width: 11, height: 11, color: IC }} />
                        <p style={{ fontSize: 9.5, fontWeight: 900, color: IC, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, flex: 1 }}>{t.engBrowser}</p>
                        <span style={{ fontSize: 8, fontFamily: "monospace", color: "var(--text-muted)" }}>{brows.length}</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", padding: "4px 10px 3px", borderBottom: "1px solid var(--border-split)", background: "rgba(99,102,241,0.04)" }}>
                        <span style={{ fontSize: 7.5, fontWeight: 800, color: IC, textTransform: "uppercase", letterSpacing: "0.06em" }}>Parámetro</span>
                        <span style={{ fontSize: 7.5, fontWeight: 800, color: IC, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>Valor</span>
                      </div>
                      <div>
                        {brows.map((r, i) => (
                          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", padding: "4px 10px", background: i % 2 === 0 ? "rgba(99,102,241,0.05)" : "transparent", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{r.k}</span>
                            <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "monospace", color: "var(--text-main)", textAlign: "right", wordBreak: "break-all", lineHeight: 1.4 }}>{r.v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ADS */}
          <div style={{ display: "flex", alignItems: "center", gap: 9, borderRadius: 11, border: "1px solid var(--border-split)", padding: "9px 13px", background: "var(--bg-surface)", minHeight: 44, marginTop: 2 }}>
            <div style={{ width: 19, height: 19, borderRadius: 5, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.14)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 6.5, fontWeight: 900, fontFamily: "monospace", color: IC }}>ADS</div>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-main)", margin: 0 }}>{t.ad}</p>
              <p style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-muted)", margin: 0 }}>Leaderboard · 728 × 90</p>
            </div>
          </div>
        </div>

        {/* Skyscraper */}
        <aside className="hidden xl:flex flex-col gap-3 w-[160px] shrink-0 sticky top-0">
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: 12, border: "1px solid var(--border-split)", gap: 5, padding: 10, textAlign: "center", minHeight: 520, background: "var(--bg-surface)" }}>
            <div style={{ width: 20, height: 20, borderRadius: 5, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.13)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 6.5, fontWeight: 900, fontFamily: "monospace", color: IC }}>ADS</div>
            <p style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, color: "var(--text-muted)", margin: 0 }}>160 × 600</p>
          </div>
        </aside>
      </div>

      {/* HELP MODAL */}
      {showHelp && (
        <div onClick={closeHelp}
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", background: "rgba(0,0,0,0.28)", opacity: helpVis ? 1 : 0, transition: "opacity 0.18s ease" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 520, maxHeight: "80vh", overflowY: "auto", background: "var(--bg-surface)", border: "1px solid var(--border-split)", borderRadius: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.16)", opacity: helpVis ? 1 : 0, transform: helpVis ? "scale(1)" : "scale(0.97)", transition: "transform 0.18s cubic-bezier(.4,0,.2,1),opacity 0.18s ease" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--border-split)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.18)", display: "flex", alignItems: "center", justifyContent: "center", color: IC }}><HelpCircle style={{ width: 13, height: 13 }} /></div>
                <h2 style={{ fontSize: 13, fontWeight: 900, color: "var(--text-main)", margin: 0 }}>{t.help.title}</h2>
              </div>
              <button onClick={closeHelp} style={{ width: 26, height: 26, borderRadius: "50%", border: "1px solid var(--border-split)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X style={{ width: 13, height: 13 }} />
              </button>
            </div>
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              {t.help.s.map(([ti, de], i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 7, background: IC, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 900, flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                  <div>
                    <p style={{ fontSize: 11.5, fontWeight: 900, color: "var(--text-main)", margin: "0 0 2px" }}>{ti}</p>
                    <p style={{ fontSize: 10.5, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>{de}</p>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: "0 18px 18px" }}>
              <button onClick={closeHelp} style={{ width: "100%", padding: "10px 0", borderRadius: 11, background: IC, color: "#fff", fontWeight: 900, fontSize: 12.5, border: "none", cursor: "pointer" }}>{t.help.close}</button>
            </div>
          </div>
        </div>
      )}

      {/* INFO MODAL — RAM / Disk types */}
      {infoModal && (() => {
        const isRam = infoModal === "ram";
        const items = isRam ? [
          { tag: "DDR3", title: "DDR3", body: "Generación antigua (2007–2014). 1066–2133 MHz. 1.5 V. Equipos viejos. Reemplazo cada vez más difícil." },
          { tag: "DDR4", title: "DDR4", body: "Estándar actual (2014–presente). 2133–3200 MHz. 1.2 V. Mayoría de PCs y laptops modernos." },
          { tag: "DDR5", title: "DDR5", body: "Última generación (2021+). 4800–8400 MHz. 1.1 V. PCs y laptops más recientes (gama alta)." },
          { tag: "DIMM", title: "DIMM (escritorio)", body: "Módulo largo para PCs de escritorio. 288 pines en DDR4/DDR5." },
          { tag: "SODIMM", title: "SODIMM (portátil)", body: "Módulo corto para laptops y mini-PCs. 260 pines en DDR4/DDR5." },
        ] : [
          { tag: "HDD", title: "HDD (mecánico)", body: "Disco con platos giratorios. Económico, gran capacidad (2–18 TB), pero lento (~150 MB/s) y frágil ante golpes. Ideal para almacenar archivos." },
          { tag: "SSD", title: "SSD SATA", body: "Memoria flash con conector SATA. 5–10× más rápido que HDD (~550 MB/s). Buen reemplazo de HDD sin cambiar nada más." },
          { tag: "NVMe", title: "NVMe M.2", body: "SSD que se conecta directamente al PCIe. Velocidad extrema (3000–14000 MB/s). El más rápido y recomendado si tu placa lo soporta." },
          { tag: "NAS", title: "NAS / Network", body: "Almacenamiento conectado a la red doméstica. Pensado para backups, multimedia y trabajo en equipo." },
        ];
        const title = isRam ? "Tipos de Memoria RAM" : "Tipos de Almacenamiento";
        const intro = isRam
          ? "Mira el tipo en la tarjeta de RAM (ej. DDR4 · SODIMM). Compra siempre el mismo tipo, velocidad similar y formato (SODIMM para laptop, DIMM para escritorio)."
          : "Identifica el tipo en cada disco. Para ampliar busca el mismo factor de forma (M.2 / 2.5\") y la misma interfaz (NVMe PCIe / SATA).";
        return (
          <div onClick={closeInfo}
            style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", background: "rgba(0,0,0,0.32)", opacity: infoVis ? 1 : 0, transition: "opacity 0.18s ease" }}>
            <div onClick={e => e.stopPropagation()}
              style={{ width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto", background: "var(--bg-surface)", border: "1px solid var(--border-split)", borderRadius: 20, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", opacity: infoVis ? 1 : 0, transform: infoVis ? "scale(1)" : "scale(0.97)", transition: "transform 0.18s cubic-bezier(.4,0,.2,1),opacity 0.18s ease" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border-split)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 9, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: IC }}>
                    {isRam ? <MemoryStick style={{ width: 15, height: 15 }} /> : <HardDrive style={{ width: 15, height: 15 }} />}
                  </div>
                  <h2 style={{ fontSize: 14, fontWeight: 900, color: "var(--text-main)", margin: 0 }}>{title}</h2>
                </div>
                <button onClick={closeInfo} style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid var(--border-split)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <X style={{ width: 14, height: 14 }} />
                </button>
              </div>
              <div style={{ padding: "16px 20px 8px" }}>
                <div style={{ background: "rgba(99,102,241,0.06)", borderRadius: 10, padding: "10px 12px", marginBottom: 14, border: "1px solid rgba(99,102,241,0.14)" }}>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, lineHeight: 1.55 }}><Info style={{ width: 11, height: 11, display: "inline", marginRight: 4, verticalAlign: "middle", color: IC }} />{intro}</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {items.map(it => (
                    <div key={it.tag} style={{ display: "flex", gap: 12, padding: "10px 12px", background: "rgba(99,102,241,0.04)", borderRadius: 10, border: "1px solid rgba(99,102,241,0.08)" }}>
                      <div style={{ flexShrink: 0, width: 64, display: "flex", alignItems: "flex-start", justifyContent: "center" }}>
                        <span style={{ fontSize: 10, fontWeight: 900, padding: "4px 8px", borderRadius: 8, background: IC, color: "#fff", fontFamily: "monospace", letterSpacing: "0.04em" }}>{it.tag}</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 12, fontWeight: 900, color: "var(--text-main)", margin: "0 0 3px" }}>{it.title}</p>
                        <p style={{ fontSize: 10.5, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>{it.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ padding: "8px 20px 20px" }}>
                <button onClick={closeInfo} style={{ width: "100%", padding: "11px 0", borderRadius: 12, background: IC, color: "#fff", fontWeight: 900, fontSize: 13, border: "none", cursor: "pointer" }}>Entendido</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* DOWNLOAD MODAL — OS picker */}
      {dlModal && (
        <div onClick={closeDl}
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", background: "rgba(0,0,0,0.32)", opacity: dlVis ? 1 : 0, transition: "opacity 0.18s ease" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", background: "var(--bg-surface)", border: "1px solid var(--border-split)", borderRadius: 20, boxShadow: "0 24px 64px rgba(0,0,0,0.18)", opacity: dlVis ? 1 : 0, transform: dlVis ? "scale(1)" : "scale(0.97)", transition: "transform 0.18s cubic-bezier(.4,0,.2,1),opacity 0.18s ease" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border-split)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                  <Download style={{ width: 15, height: 15 }} />
                </div>
                <h2 style={{ fontSize: 14, fontWeight: 900, color: "var(--text-main)", margin: 0 }}>Descarga CoreKit Agent</h2>
              </div>
              <button onClick={closeDl} style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid var(--border-split)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
            <div style={{ padding: "18px 20px" }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 16px", lineHeight: 1.5, textAlign: "center" }}>Elige tu sistema operativo. Descarga, ejecuta, y regresa aquí — los datos aparecerán automáticamente.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[
                  { os: "Windows", file: "/CoreKitAgent.exe", ext: ".exe", size: "~10 MB",
                    icon: <svg viewBox="0 0 24 24" width="48" height="48" fill="#0078D4"><path d="M0 3.449L9.75 2.1v9.451H0V3.449zM10.949 1.949l13.05-1.949v11.6h-13.05V1.949zM0 12.6h9.75v9.451L0 20.7V12.6zM10.949 12.75H24V24l-13.05-1.95V12.75z"/></svg> },
                  { os: "macOS", file: "/CoreKitAgent.dmg", ext: ".dmg", size: "~13 MB",
                    icon: <svg viewBox="0 0 24 24" width="48" height="48" fill="var(--text-main)"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.08l.01.01M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25"/></svg> },
                  { os: "Linux", file: "/corekit-agent.AppImage", ext: ".AppImage", size: "~16 MB",
                    icon: <svg viewBox="0 0 24 24" width="48" height="48" fill="#FCC624"><path d="M14.62 8.35c-.42.28-1.75 1.2-1.95 1.36-.4.27-1.04.45-1.04-.36 0-.34 0-.86-.06-1.04-.04-.17-.43-.43-.85-.43-.41 0-.61.18-.78.43-.16.26-.06.7-.06 1.04 0 .81-.65.63-1.04.36-.2-.16-1.53-1.08-1.95-1.36-.6-.4-.6-.78-.27-1.21.2-.27 1.49-1.8 2.09-2.5.59-.7 1.07-1.04 2-1.04.92 0 1.4.34 2 1.04.6.7 1.89 2.23 2.09 2.5.33.43.33.81-.27 1.21M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10m0-2c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8"/></svg> },
                ].map(o => (
                  <a key={o.os} href={o.file} download onClick={closeDl}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "18px 12px", borderRadius: 14, border: "2px solid var(--border-split)", background: "rgba(99,102,241,0.03)", textDecoration: "none", color: "var(--text-main)", transition: "all 0.2s", cursor: "pointer" }}
                    onMouseEnter={e => { const t = e.currentTarget as HTMLAnchorElement; t.style.borderColor = IC; t.style.background = "rgba(99,102,241,0.10)"; t.style.transform = "translateY(-3px)"; t.style.boxShadow = "0 10px 24px rgba(99,102,241,0.18)"; }}
                    onMouseLeave={e => { const t = e.currentTarget as HTMLAnchorElement; t.style.borderColor = "var(--border-split)"; t.style.background = "rgba(99,102,241,0.03)"; t.style.transform = "translateY(0)"; t.style.boxShadow = "none"; }}>
                    {o.icon}
                    <span style={{ fontSize: 13, fontWeight: 900, color: "var(--text-main)", marginTop: 4 }}>Descargar para {o.os}</span>
                    <span style={{ fontSize: 8.5, fontWeight: 700, color: IC, fontFamily: "monospace" }}>{o.ext} · {o.size}</span>
                    <div style={{ marginTop: 4, padding: "6px 14px", borderRadius: 999, background: IC, color: "#fff", fontSize: 10, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <Download style={{ width: 11, height: 11 }} /> Descargar
                    </div>
                  </a>
                ))}
              </div>
              <div style={{ marginTop: 16, padding: "9px 11px", borderRadius: 9, background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.18)" }}>
                <p style={{ fontSize: 9.5, color: "var(--text-muted)", margin: 0, lineHeight: 1.55, textAlign: "center" }}>
                  <strong style={{ color: "#10b981" }}>🔒 Código abierto y auditable.</strong> El agente recopila datos del hardware solo localmente vía WebSocket en <code style={{ fontFamily: "monospace", color: IC }}>ws://localhost:8765</code>.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SEO */}
      <div style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}>
        <h2>qué sistema operativo tengo</h2><h2>cuánta ram tengo</h2>
        <h2>número de serie de mi pc</h2><h2>mi disco duro es ssd o hdd</h2>
        <h2>ver especificaciones de mi pc</h2>
      </div>
    </>
  );
}
