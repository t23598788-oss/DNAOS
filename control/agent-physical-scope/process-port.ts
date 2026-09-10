/**
 * Process and port isolation: agents never choose PIDs or listen ports.
 * Reuses control/runtime-control service ports as the protected class.
 */

import { SERVICES } from "../runtime-control/contract";
import type { CanonicalAgentScope, ProtectedRuntime, ScopeDenialReason } from "./types";

export const OWNER_SURFACE_RUNTIME_ID = "control-workspace" as const;
export const OWNER_SURFACE_PORT = 5181 as const;
export const OWNER_COMMAND_HTTP_PORT = 8791 as const;

export const DEV_PORT_RANGE = { min: 49152, max: 49300 } as const;

export interface RuntimeGuardResult {
  readonly ok: boolean;
  readonly reason?: ScopeDenialReason;
  readonly detail?: string;
}

function protectionClass(runtime_id: string): ProtectedRuntime["protection_class"] {
  if (runtime_id === "control-workspace") return "OWNER_SURFACE";
  if (runtime_id === "dna-os-mcp") return "AUTH";
  if (runtime_id === "machine-observer" || runtime_id === "recovery-supervisor") return "MAIN";
  return "BUSINESS";
}

export function defaultProtectedRuntimes(): readonly ProtectedRuntime[] {
  const fromRegistry: ProtectedRuntime[] = Object.values(SERVICES).map((svc) => ({
    runtime_id: svc.service_id,
    port: svc.port,
    protection_class: protectionClass(svc.service_id),
  }));
  fromRegistry.push({
    runtime_id: "owner-command-http",
    port: OWNER_COMMAND_HTTP_PORT,
    protection_class: "AUTH",
  });
  return fromRegistry;
}

const PROTECTED_DEFAULT = defaultProtectedRuntimes();

export function isProtectedPort(port: number, protectedRuntimes: readonly ProtectedRuntime[] = PROTECTED_DEFAULT): boolean {
  return protectedRuntimes.some((row) => row.port === port);
}

export function isProtectedRuntimeId(runtime_id: string, protectedRuntimes: readonly ProtectedRuntime[] = PROTECTED_DEFAULT): boolean {
  return protectedRuntimes.some((row) => row.runtime_id === runtime_id);
}

export function guardRuntimeMutation(
  scope: CanonicalAgentScope,
  runtime_id: string,
  protectedRuntimes: readonly ProtectedRuntime[] = PROTECTED_DEFAULT,
): RuntimeGuardResult {
  if (isProtectedRuntimeId(runtime_id, protectedRuntimes)) {
    return { ok: false, reason: "RUNTIME_SCOPE_DENIED", detail: `protected runtime ${runtime_id}` };
  }
  if (!scope.allowed_runtime_ids.includes(runtime_id)) {
    return { ok: false, reason: "RUNTIME_SCOPE_DENIED", detail: "runtime_id is not allocated to this task" };
  }
  return { ok: true };
}

export function guardPortMutation(
  scope: CanonicalAgentScope,
  port: number,
  protectedRuntimes: readonly ProtectedRuntime[] = PROTECTED_DEFAULT,
): RuntimeGuardResult {
  if (isProtectedPort(port, protectedRuntimes)) {
    return { ok: false, reason: "PORT_SCOPE_DENIED", detail: `protected port ${port}` };
  }
  if (!scope.allowed_ports.includes(port)) {
    return { ok: false, reason: "PORT_SCOPE_DENIED", detail: "port is not allocated to this task" };
  }
  return { ok: true };
}

export function guardKillByPid(_scope: CanonicalAgentScope, _pid: number): RuntimeGuardResult {
  return { ok: false, reason: "RUNTIME_SCOPE_DENIED", detail: "caller-chosen PID is never a valid mutation target" };
}

export function looksLikeProcessEscape(argv: readonly string[]): boolean {
  const joined = argv.join(" ").toLowerCase();
  if (/\bkill\b/.test(joined) && /\d{2,}/.test(joined)) return true;
  if (joined.includes("launchctl bootout") || joined.includes("launchctl kill")) return true;
  if (/\blsof\b/.test(joined) && /\bkill\b/.test(joined)) return true;
  return false;
}

export function looksLikePortEscape(argv: readonly string[], protectedRuntimes: readonly ProtectedRuntime[] = PROTECTED_DEFAULT): boolean {
  for (const row of protectedRuntimes) {
    if (argv.some((a) => a.includes(`:${row.port}`) || a === String(row.port))) return true;
  }
  return false;
}
