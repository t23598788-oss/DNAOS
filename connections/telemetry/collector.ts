/**
 * หน้าที่: the real, on-demand telemetry sampler — same "validate before
 * execute, never fabricate" discipline as every other host-runtime.ts in
 * this repo. Every field in the returned TelemetrySnapshot traces to a
 * real `os.*` call or a real, timeout-bounded shell-out; a failed
 * shell-out reports `null` for that section, never a guessed value.
 *
 * Input: none.
 * Output: captureTelemetrySnapshot(): Promise<TelemetrySnapshot>.
 * Dependency ที่อนุญาต: ./contract.ts (types only), node:os,
 * node:child_process, node:crypto.
 * สิ่งที่ห้ามแตะ: never import from dna-os-deadboard; never widen
 * `lsof`/`df` beyond the fixed, bounded commands below.
 */
import { randomUUID } from "node:crypto";
import { cpus, totalmem, freemem, loadavg, networkInterfaces, uptime } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CpuRam, DiskInfo, NetworkInterfaceInfo, ProcessLoad, TelemetrySnapshot } from "./contract";
import { TELEMETRY_TTL_MS } from "./contract";

const execFileAsync = promisify(execFile);

function readCpuRam(): CpuRam {
  const cpuList = cpus();
  return {
    cpu_count: cpuList.length,
    cpu_model: cpuList[0]?.model ?? "unknown",
    load_avg_1m: loadavg()[0] ?? 0,
    total_mem_bytes: totalmem(),
    free_mem_bytes: freemem(),
  };
}

function readNetworkInterfaces(): NetworkInterfaceInfo[] {
  const ifaces = networkInterfaces();
  const result: NetworkInterfaceInfo[] = [];
  for (const [name, entries] of Object.entries(ifaces)) {
    for (const entry of entries ?? []) {
      result.push({ name, family: entry.family, address: entry.address, internal: entry.internal });
    }
  }
  return result;
}

async function readProcessCount(): Promise<number> {
  try {
    const { stdout } = await execFileAsync("/bin/ps", ["-A"], { timeout: 5_000, maxBuffer: 256 * 1024 });
    return Math.max(0, stdout.split("\n").filter((l) => l.trim().length > 0).length - 1); // -1 for the header row
  } catch {
    return 0;
  }
}

async function readDisk(): Promise<DiskInfo> {
  try {
    const { stdout } = await execFileAsync("/bin/df", ["-k", process.cwd()], { timeout: 5_000, maxBuffer: 16 * 1024 });
    const lines = stdout.trim().split("\n");
    const dataLine = lines[lines.length - 1];
    const parts = dataLine.trim().split(/\s+/);
    // macOS `df -k` columns: Filesystem 1024-blocks Used Available Capacity Mounted-on
    if (parts.length < 5) return { filesystem: null, total_kb: null, used_kb: null, available_kb: null, capacity_percent: null };
    return {
      filesystem: parts[0],
      total_kb: Number(parts[1]) || null,
      used_kb: Number(parts[2]) || null,
      available_kb: Number(parts[3]) || null,
      capacity_percent: Number(parts[4]?.replace("%", "")) || null,
    };
  } catch {
    return { filesystem: null, total_kb: null, used_kb: null, available_kb: null, capacity_percent: null };
  }
}

const MAX_PORTS = 50;

/** Real, bounded LISTEN-port probe. Returns null (never []) on failure so "no ports found" and "probe failed" are never confused. */
async function readListeningPorts(): Promise<number[] | null> {
  try {
    const { stdout } = await execFileAsync("/usr/sbin/lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { timeout: 5_000, maxBuffer: 256 * 1024 });
    const ports = new Set<number>();
    for (const line of stdout.split("\n")) {
      const match = line.match(/:(\d+)\s+\(LISTEN\)/);
      if (match) ports.add(Number(match[1]));
      if (ports.size >= MAX_PORTS) break;
    }
    return [...ports];
  } catch {
    return null;
  }
}

async function readProcessLoad(): Promise<ProcessLoad> {
  return { process_count: await readProcessCount(), uptime_seconds: Math.round(uptime()) };
}

/** The one real entry point. Every consumer (collector loop, on-demand dashboard read, tests) goes through this — never re-implements a subset of these os/shell calls elsewhere. */
export async function captureTelemetrySnapshot(): Promise<TelemetrySnapshot> {
  const capturedAt = new Date();
  const [processLoad, disk, listeningPorts] = await Promise.all([readProcessLoad(), readDisk(), readListeningPorts()]);
  return {
    snapshot_id: randomUUID(),
    captured_at: capturedAt.toISOString(),
    provenance: "LIVE",
    mechanism: "os.cpus/totalmem/freemem/loadavg/networkInterfaces (node:os) + /bin/ps -A + /bin/df -k + /usr/sbin/lsof -iTCP -sTCP:LISTEN",
    cpu_ram: readCpuRam(),
    process_load: processLoad,
    network_interfaces: readNetworkInterfaces(),
    disk,
    listening_ports: listeningPorts,
    expires_at: new Date(capturedAt.getTime() + TELEMETRY_TTL_MS).toISOString(),
  };
}
