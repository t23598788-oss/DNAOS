/**
 * หน้าที่: the contract for INFRA's own device-telemetry capability
 * (Owner, 2026-08-20 DATA INTEGRATION BUILD, item 1+3). Deliberately does
 * NOT import `dna-os-deadboard/device-capability/detect.ts` — that repo
 * is the Owner's live production app (real Supabase, real users) and is
 * off-limits per the standing "never touch production business code"
 * rule. This capability re-derives the SAME real Node primitives
 * (`os.cpus/totalmem/freemem/networkInterfaces`, `ps`) independently,
 * inside INFRA only.
 *
 * Input: none (pure type definitions).
 * Output: TelemetrySnapshot, Provenance, FreshnessResult.
 * Dependency ที่อนุญาต: none — leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field naming a specific user/credential;
 * never import anything from dna-os-deadboard.
 */

export type Provenance = "LIVE" | "TEST" | "SIMULATED" | "UNKNOWN";

export interface CpuRam {
  cpu_count: number;
  cpu_model: string;
  load_avg_1m: number;
  total_mem_bytes: number;
  free_mem_bytes: number;
}

export interface ProcessLoad {
  process_count: number;
  uptime_seconds: number;
}

export interface NetworkInterfaceInfo {
  name: string;
  family: string;
  address: string;
  internal: boolean;
}

export interface DiskInfo {
  /** Real `df -k` row for the repo's own filesystem, or null if the shell-out failed — never fabricated. */
  filesystem: string | null;
  total_kb: number | null;
  used_kb: number | null;
  available_kb: number | null;
  capacity_percent: number | null;
}

export interface TelemetrySnapshot {
  snapshot_id: string;
  captured_at: string;
  provenance: Provenance;
  /** Free-text description of exactly which real syscall/shell-out produced this snapshot — same "mechanism" discipline as dna-os-deadboard/device-capability/detect.ts. */
  mechanism: string;
  cpu_ram: CpuRam;
  process_load: ProcessLoad;
  network_interfaces: NetworkInterfaceInfo[];
  disk: DiskInfo;
  /** Real, bounded list of LISTEN ports found via `lsof -iTCP -sTCP:LISTEN`, or null if the probe failed/timed out — never fabricated, never unbounded. */
  listening_ports: number[] | null;
  /** ISO timestamp after which this snapshot is considered stale. Always `captured_at` + a fixed TTL — never null, closing the exact gap `reports/phase16-world-evidence/pipeline.mjs` flagged (its own `expires_at` was null for every record). */
  expires_at: string;
}

export interface FreshnessResult {
  status: "FRESH" | "STALE" | "UNKNOWN";
  reason: string;
}

export const TELEMETRY_TTL_MS = 60_000;
