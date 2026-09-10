/**
 * Smallest task port allocator. Agents request allocation; they do not pick
 * a system port. Allocations never overlap protected runtime-control ports.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AGENT_SCOPE_STORE_ENV } from "./types";
import type { CanonicalAgentScope } from "./types";
import { DEV_PORT_RANGE, defaultProtectedRuntimes, isProtectedPort } from "./process-port";

export interface PortAllocation {
  readonly task_id: string;
  readonly purpose: string;
  readonly port: number;
  readonly allocated_at: string;
}

function storeFile(): string {
  const dir = process.env[AGENT_SCOPE_STORE_ENV]?.trim() || join(process.cwd(), "control/agent-physical-scope/data");
  return join(dir, "port-allocations.jsonl");
}

function readAllocations(): PortAllocation[] {
  const file = storeFile();
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as PortAllocation);
}

export function allocateRuntimePort(scope: CanonicalAgentScope, purpose: string): PortAllocation | { ok: false; reason: "PORT_SCOPE_DENIED"; detail: string } {
  const used = new Set(readAllocations().map((row) => row.port));
  const protectedPorts = new Set(defaultProtectedRuntimes().map((row) => row.port));
  for (let port = DEV_PORT_RANGE.min; port <= DEV_PORT_RANGE.max; port += 1) {
    if (used.has(port) || protectedPorts.has(port) || isProtectedPort(port)) continue;
    const row: PortAllocation = {
      task_id: scope.task_id,
      purpose,
      port,
      allocated_at: new Date().toISOString(),
    };
    const file = storeFile();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
    return row;
  }
  return { ok: false, reason: "PORT_SCOPE_DENIED", detail: "no free port in task allocation range" };
}

export function allocationsForTask(task_id: string): readonly PortAllocation[] {
  return readAllocations().filter((row) => row.task_id === task_id);
}

export function withAllocatedPort(scope: CanonicalAgentScope, port: number): CanonicalAgentScope {
  return { ...scope, allowed_ports: [...scope.allowed_ports, port] };
}
