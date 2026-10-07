/**
 * Smallest task port allocator. Agents request allocation; they do not pick
 * a system port. Allocations never overlap protected runtime-control ports.
 */

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { AGENT_SCOPE_STORE_ENV } from "./types";
import type { CanonicalAgentScope } from "./types";
import { DEV_PORT_RANGE, defaultProtectedRuntimes, isProtectedPort } from "./process-port";

export interface PortAllocation {
  readonly task_id: string;
  readonly purpose: string;
  readonly port: number;
  readonly allocated_at: string;
  readonly released?: boolean;
}

function storeFile(): string {
  const dir = process.env[AGENT_SCOPE_STORE_ENV]?.trim() || join(process.cwd(), "control/agent-physical-scope/data");
  return join(dir, "port-allocations.jsonl");
}

function lockFile(): string {
  return `${storeFile()}.lock`;
}

function sleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

function withAllocLock<T>(fn: () => T): T {
  mkdirSync(dirname(storeFile()), { recursive: true });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const fd = openSync(lockFile(), "wx");
      try {
        return fn();
      } finally {
        closeSync(fd);
        try { unlinkSync(lockFile()); } catch { /* ignore */ }
      }
    } catch {
      sleep(10);
    }
  }
  throw new Error("PORT_ALLOCATION_LOCK_TIMEOUT");
}

function readAllocations(): PortAllocation[] {
  const file = storeFile();
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as PortAllocation);
}

function liveAllocations(): PortAllocation[] {
  const latest = new Map<string, PortAllocation>();
  for (const row of readAllocations()) {
    latest.set(`${row.task_id}:${row.purpose}:${row.port}`, row);
  }
  return [...latest.values()].filter((row) => row.released !== true);
}

export function allocateRuntimePort(scope: CanonicalAgentScope, purpose: string): PortAllocation | { ok: false; reason: "PORT_SCOPE_DENIED"; detail: string } {
  if (!scope.write_allowed || !scope.safe_for_current_execution) {
    return { ok: false, reason: "PORT_SCOPE_DENIED", detail: "snapshot scopes cannot allocate host ports" };
  }
  try {
    return withAllocLock(() => {
      const existing = liveAllocations().find((row) => row.task_id === scope.task_id && row.purpose === purpose);
      if (existing) return existing;
      const used = new Set(liveAllocations().map((row) => row.port));
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
    });
  } catch {
    return { ok: false, reason: "PORT_SCOPE_DENIED", detail: "port allocation lock unavailable" };
  }
}

export function releaseRuntimePort(task_id: string, purpose: string): void {
  withAllocLock(() => {
    for (const row of liveAllocations().filter((r) => r.task_id === task_id && r.purpose === purpose)) {
      appendFileSync(storeFile(), `${JSON.stringify({ ...row, released: true, allocated_at: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600 });
    }
  });
}

export function allocationsForTask(task_id: string): readonly PortAllocation[] {
  return liveAllocations().filter((row) => row.task_id === task_id);
}

export function withAllocatedPort(scope: CanonicalAgentScope, allocation: PortAllocation): CanonicalAgentScope {
  if (allocation.task_id !== scope.task_id) return scope;
  const persisted = allocationsForTask(scope.task_id).some((row) => row.port === allocation.port && row.released !== true);
  if (!persisted) return scope;
  if (scope.allowed_ports.includes(allocation.port)) return scope;
  return { ...scope, allowed_ports: [...scope.allowed_ports, allocation.port] };
}
