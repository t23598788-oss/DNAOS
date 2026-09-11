/**
 * หน้าที่: load NODE_LOCAL projections + optional-adapter REGISTERED_REMOTE
 * JSONL. Core does not invent remote hostnames; adapter files may.
 *
 * Input: disk JSONL under connections adapter data/runtime-endpoints.jsonl
 * Output: ensureRuntimeEndpointsLoaded
 * Dependency ที่อนุญาต: ./registry.ts, ./local-from-services.ts, node:fs path
 * สิ่งที่ห้ามแตะ: ห้ามเรียก Railway GraphQL; ห้าม parse hostname เป็น provider.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { localEndpointsFromServices } from "./local-from-services";
import { registerRuntimeEndpoint, resetRuntimeEndpointStore } from "./registry";
import type { RuntimeEndpointRegistration } from "./types";

const OPTIONAL_ADAPTER_JSONL = [
  "connections/railway/data/runtime-endpoints.jsonl",
] as const;

let loaded = false;

export function runtimeEndpointRepoRoot(): string {
  return process.cwd();
}

function readJsonl(path: string): RuntimeEndpointRegistration[] {
  if (!existsSync(path)) return [];
  const out: RuntimeEndpointRegistration[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      out.push(JSON.parse(trimmed) as RuntimeEndpointRegistration);
    } catch {
      /* skip malformed adapter rows; fail-closed at resolve if missing */
    }
  }
  return out;
}

export function ensureRuntimeEndpointsLoaded(): void {
  if (loaded) return;
  resetRuntimeEndpointStore();
  for (const row of localEndpointsFromServices()) {
    registerRuntimeEndpoint(row);
  }
  const root = runtimeEndpointRepoRoot();
  for (const rel of OPTIONAL_ADAPTER_JSONL) {
    for (const row of readJsonl(join(root, rel))) {
      registerRuntimeEndpoint(row);
    }
  }
  loaded = true;
}

export function resetRuntimeEndpointsForTests(): void {
  loaded = false;
  resetRuntimeEndpointStore();
}
