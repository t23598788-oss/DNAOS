import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath } from "./host-runtime";
import type { DeviceResourceV1, LocalToolAdapterV1 } from "./types";

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const rows: T[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as T); } catch { /* skip */ }
  }
  return rows;
}

function appendJsonl(file: string, row: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
}

export function persistAdapters(rows: readonly LocalToolAdapterV1[]): void {
  appendJsonl(dataPath("adapters.jsonl", "LOCAL_TOOL_ADAPTERS_LOG"), { rows });
}
export function listPersistedAdapters(): LocalToolAdapterV1[] {
  const file = dataPath("adapters.jsonl", "LOCAL_TOOL_ADAPTERS_LOG");
  const snaps = readJsonl<{ rows?: LocalToolAdapterV1[] }>(file);
  return snaps[snaps.length - 1]?.rows ?? [];
}
export function persistDevices(rows: readonly DeviceResourceV1[]): void {
  appendJsonl(dataPath("devices.jsonl", "LOCAL_TOOL_DEVICES_LOG"), { rows });
}
export function listPersistedDevices(): DeviceResourceV1[] {
  const file = dataPath("devices.jsonl", "LOCAL_TOOL_DEVICES_LOG");
  const snaps = readJsonl<{ rows?: DeviceResourceV1[] }>(file);
  return snaps[snaps.length - 1]?.rows ?? [];
}
export function persistHealth(row: unknown): void {
  appendJsonl(dataPath("health.jsonl", "LOCAL_TOOL_HEALTH_LOG"), row);
}
export function listPersistedHealth<T>(): T[] {
  return readJsonl<T>(dataPath("health.jsonl", "LOCAL_TOOL_HEALTH_LOG"));
}
