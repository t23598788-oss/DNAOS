import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath } from "./host-runtime";

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

export function persistBridgeSnapshot(row: unknown): void {
  appendJsonl(dataPath("bridges.jsonl", "MACOS_BRIDGES_LOG"), row);
}
export function listBridgeSnapshots<T>(): T[] {
  return readJsonl<T>(dataPath("bridges.jsonl", "MACOS_BRIDGES_LOG"));
}
export function persistCommand(row: unknown): void {
  appendJsonl(dataPath("commands.jsonl", "MACOS_COMMANDS_LOG"), row);
}
export function listPersistedCommands<T>(): T[] {
  return readJsonl<T>(dataPath("commands.jsonl", "MACOS_COMMANDS_LOG"));
}
export function persistCorrelation(row: unknown): void {
  appendJsonl(dataPath("correlation.jsonl", "MACOS_CORRELATION_LOG"), row);
}
export function listPersistedCorrelations<T>(): T[] {
  return readJsonl<T>(dataPath("correlation.jsonl", "MACOS_CORRELATION_LOG"));
}
export function persistBaseline(row: unknown): void {
  appendJsonl(dataPath("baseline.jsonl", "MACOS_BASELINE_LOG"), row);
}
export function listPersistedBaselines<T>(): T[] {
  return readJsonl<T>(dataPath("baseline.jsonl", "MACOS_BASELINE_LOG"));
}
export function persistDrift(row: unknown): void {
  appendJsonl(dataPath("drift.jsonl", "MACOS_DRIFT_LOG"), row);
}
export function listPersistedDrift<T>(): T[] {
  return readJsonl<T>(dataPath("drift.jsonl", "MACOS_DRIFT_LOG"));
}
