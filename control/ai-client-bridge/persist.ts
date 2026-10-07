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

export function bindingsFile(): string {
  return dataPath("ai-client-bindings.jsonl", "AI_CLIENT_BINDINGS_LOG");
}

export function handoffsFile(): string {
  return dataPath("ai-handoffs.jsonl", "AI_HANDOFF_LOG");
}

export function persistBinding(row: unknown): void {
  appendJsonl(bindingsFile(), row);
}

export function persistHandoff(row: unknown): void {
  appendJsonl(handoffsFile(), row);
}

export function listPersistedBindings<T>(): T[] {
  return readJsonl<T>(bindingsFile());
}

export function listPersistedHandoffs<T>(): T[] {
  return readJsonl<T>(handoffsFile());
}
