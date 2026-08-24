/**
 * หน้าที่: durable telemetry store — same flat-file JSONL, append-only
 * convention as `control/agent-gateway/memory-store.ts` and
 * `connections/os-ui/screen-summary.ts`. No new database engine. History
 * survives a worker restart by construction: every read hits disk fresh,
 * nothing lives only in memory.
 *
 * Input: TelemetrySnapshot.
 * Output: saveSnapshot, loadLatestSnapshot, loadSnapshotHistory,
 * pruneOldSnapshots.
 * Dependency ที่อนุญาต: ./contract.ts (types only), node:fs, node:path.
 * สิ่งที่ห้ามแตะ: never write to dna-os-deadboard; never store anything
 * beyond TelemetrySnapshot's own fields (no credential/secret surface
 * exists in this schema to begin with).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TelemetrySnapshot } from "./contract";

const DATA_DIR_RELATIVE = "connections/telemetry/data";

function dataDir(): string {
  return join(process.cwd(), DATA_DIR_RELATIVE);
}
function snapshotsFile(): string {
  return join(dataDir(), "snapshots.jsonl");
}

function ensureFile(): void {
  mkdirSync(dataDir(), { recursive: true });
  if (!existsSync(snapshotsFile())) writeFileSync(snapshotsFile(), "", "utf-8");
}

function readAll(): TelemetrySnapshot[] {
  ensureFile();
  const raw = readFileSync(snapshotsFile(), "utf-8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as TelemetrySnapshot);
}

export function saveSnapshot(snapshot: TelemetrySnapshot): void {
  ensureFile();
  appendFileSync(snapshotsFile(), `${JSON.stringify(snapshot)}\n`, "utf-8");
}

/** Recovery: reads fresh from disk — the correct answer immediately after a simulated worker restart, since nothing here depended on process memory. */
export function loadLatestSnapshot(): TelemetrySnapshot | null {
  const all = readAll();
  return all.length > 0 ? all[all.length - 1] : null;
}

export function loadSnapshotHistory(limit?: number): TelemetrySnapshot[] {
  const all = readAll();
  return limit ? all.slice(-limit) : all;
}

export const DEFAULT_RETENTION_COUNT = 500;

/** Retention: keeps only the most recent `keepCount` records — rewritten as a fresh file, same "compact" pattern any append-only JSONL log needs eventually. Returns how many were dropped, real count, never estimated. */
export function pruneOldSnapshots(keepCount: number = DEFAULT_RETENTION_COUNT): { keptCount: number; droppedCount: number } {
  const all = readAll();
  if (all.length <= keepCount) return { keptCount: all.length, droppedCount: 0 };
  const kept = all.slice(-keepCount);
  writeFileSync(snapshotsFile(), `${kept.map((s) => JSON.stringify(s)).join("\n")}\n`, "utf-8");
  return { keptCount: kept.length, droppedCount: all.length - kept.length };
}
