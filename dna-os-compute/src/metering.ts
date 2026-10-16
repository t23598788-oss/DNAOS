/**
 * Phase 3 — Resource Metering (CPU / RAM / GPU, 2026-10-16).
 *
 * Same Runtime as Phase 1 (this file lives INSIDE dna-os-compute; no second
 * daemon). CPU+RAM are read LIVE from os (no child process, works
 * everywhere incl. Windows). GPU is delegated to a platform adapter which
 * is ALWAYS fail-closed: an unknown/adapter-less platform answers with
 * status "UNAVAILABLE" and a reason — never a fabricated GPU. An AMD card
 * can only be reported by the Windows adapter from a real OS query
 * (Get-CimInstance via powershell.exe, optional rocm-smi probe) — it is
 * never inferred from the host being "AMD-ish".
 */
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface CpuMetering {
  cores: number;
  model: string | null;
  loadAvg1m: number | null; // null on Windows (os.loadavg is always 0 there — honest, not 0-faked)
  uptimeSeconds: number;
}

export interface RamMetering {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface GpuNet {
  adapter: string;          // which adapter answered (or "none")
  status: "AVAILABLE" | "UNAVAILABLE" | "DETECTION_FAILED";
  reason: string | null;
  gpus: Array<{
    name: string | null;
    vendor: string | null;  // "AMD" only when the OS really said AMD
    driverVersion: string | null;
    vramBytes: number | null;
  }>;
}

export interface MeteringSnapshot {
  capturedAt: string;
  cpu: CpuMetering;
  ram: RamMetering;
  gpu: GpuNet;
}

/** LIVE CPU read from os — never cached across calls. */
export function readCpu(): CpuMetering {
  const model = os.cpus()[0]?.model ?? null;
  const load = os.loadavg();
  // Windows: os.loadavg() returns [0,0,0] by design — report honestly null.
  const loadAvg1m = process.platform === "win32" ? null : load[0];
  return { cores: os.cpus().length, model, loadAvg1m, uptimeSeconds: Math.floor(os.uptime()) };
}

/** LIVE RAM read from os — real numbers, real percentage. */
export function readRam(): RamMetering {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  return { totalBytes, freeBytes, usedBytes, usedPercent: Math.round((usedBytes / totalBytes) * 1000) / 10 };
}

// ── GPU adapters (fail-closed by construction) ────────────────────────────

export type GpuAdapter = () => Promise<GpuNet>;

function unavailable(adapter: string, reason: string): GpuNet {
  return { adapter, status: "UNAVAILABLE", reason, gpus: [] };
}

/** Pure parse of the real Win32_VideoController CIM query output —
 * exported so the Phase 3 test can drive the EXACT code path that runs on
 * a Windows host without spawning powershell.exe there (not a mock GPU). */
export interface CimGpuParse { gpus: Array<{ name: string | null; vendor: string | null; driverVersion: string | null; vramBytes: number | null }> }
export function parseWin32VideoController(stdout: string): CimGpuParse {
  const parsed = JSON.parse(stdout.trim() || "[]");
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return {
    gpus: arr.filter(Boolean).map((g: { name?: unknown; vendor?: unknown; driver?: unknown; vram?: unknown }) => ({
      name: typeof g.name === "string" ? g.name : null,
      // Normalize vendor honestly: label AMD only when the OS truly said AMD/ATI.
      vendor: typeof g.vendor === "string" && /AMD|ATI|Advanced Micro Devices/i.test(g.vendor) ? "AMD" : (typeof g.vendor === "string" ? g.vendor : null),
      driverVersion: typeof g.driver === "string" ? g.driver : null,
      // CIM AdapterRAM is a signed int under 8GB for many modern cards;
      // cap honestly at null when it overflows rather than reporting garbage.
      vramBytes: typeof g.vram === "number" && g.vram > 0 ? g.vram : null,
    })),
  };
}

/** Windows adapter (AMD-first per mission: RX 9070 XT target). READS the
 * real OS — Win32_VideoController via powershell.exe (ships with Windows,
 * no extra dependency). rocm-smi is probed ONLY as an optional extra; its
 * absence never fails the CIM answer. Executable is fixed, arguments are
 * fixed, timeout is short — the same fixed-argv discipline as exec.ts. */
export const windowsCimAdapter: GpuAdapter = async () => {
  const ps = `
$c = Get-CimInstance Win32_VideoController | ForEach-Object {
  [ordered]@{ name=$_.Name; vendor=$_.AdapterCompatibility; driver=$_.DriverVersion; vram=$_.AdapterRAM }
};
$c | ConvertTo-Json -Compress`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 15_000, windowsHide: true });
    return { adapter: "windows-cim", status: "AVAILABLE", reason: null, ...(parseWin32VideoController(stdout) as CimGpuParse) };
  } catch (error) {
    return { adapter: "windows-cim", status: "DETECTION_FAILED", reason: `Get-CimInstance failed: ${error instanceof Error ? error.message : String(error)}`, gpus: [] };
  }
};

/** Non-Windows adapter: probe rocm-smi (AMD ROCm) then deny honestly. */
const nonWindowsAdapter: GpuAdapter = async () => {
  try {
    const { stdout } = await execFileAsync("rocm-smi", ["--showproductname", "--showdriverversion", "--json"], { timeout: 5_000 });
    const parsed = JSON.parse(stdout.trim() || "{}");
    const cards = parsed.card0 ?? {};
    const gpus = [{
      name: typeof cards["Product Name"] === "string" ? cards["Product Name"] : null,
      vendor: "AMD",
      driverVersion: typeof parsed["Driver version"] === "string" ? parsed["Driver version"] : null,
      vramBytes: null,
    }];
    return { adapter: "rocm-smi", status: "AVAILABLE", reason: null, gpus };
  } catch {
    const reason = process.platform === "darwin"
      ? "macOS GPU (Metal) detection is not part of this adapter — fail-closed honest UNAVAILABLE"
      : "rocm-smi not found — no AMD ROCm userland installed";
    return unavailable(process.platform, reason);
  }
};

export function gpuAdapterFor(platform: string = process.platform): GpuAdapter {
  return platform === "win32" ? windowsCimAdapter : nonWindowsAdapter;
}

/** Live GPU detection — has REDACTED no personal data (names/drivers only). */
export async function detectGpu(adapter?: GpuAdapter): Promise<GpuNet> {
  const use = adapter ?? gpuAdapterFor();
  try {
    return await use();
  } catch (error) {
    return { adapter: "unknown", status: "DETECTION_FAILED", reason: error instanceof Error ? error.message : String(error), gpus: [] };
  }
}

export async function snapshotMetering(adapter?: GpuAdapter): Promise<MeteringSnapshot> {
  return {
    capturedAt: new Date().toISOString(),
    cpu: readCpu(),
    ram: readRam(),
    gpu: await detectGpu(adapter),
  };
}
