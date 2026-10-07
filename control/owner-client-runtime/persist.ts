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

export function persistClient(row: unknown): void {
  appendJsonl(dataPath("clients.jsonl", "OWNER_CLIENTS_LOG"), row);
}
export function listPersistedClients<T>(): T[] {
  return readJsonl<T>(dataPath("clients.jsonl", "OWNER_CLIENTS_LOG"));
}
export function persistHandle(row: unknown): void {
  appendJsonl(dataPath("handles.jsonl", "RESOURCE_HANDLES_LOG"), row);
}
export function listPersistedHandles<T>(): T[] {
  return readJsonl<T>(dataPath("handles.jsonl", "RESOURCE_HANDLES_LOG"));
}
export function persistWork(row: unknown): void {
  appendJsonl(dataPath("work-context.jsonl", "WORK_CONTEXT_LOG"), row);
}
export function listPersistedWork<T>(): T[] {
  return readJsonl<T>(dataPath("work-context.jsonl", "WORK_CONTEXT_LOG"));
}

export { dataPath };
