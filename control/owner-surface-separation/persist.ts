import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DevelopmentAuthorityLeaseV1, DevelopmentChangeProposalV1, OwnerSurfaceSessionV1 } from "./types";

function fileOf(envKey: string, fallback: string): string {
  return process.env[envKey] ?? join(process.cwd(), "control/owner-surface-separation/data", fallback);
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as T);
}

function append(path: string, row: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, "");
  appendFileSync(path, `${JSON.stringify(row)}\n`);
}

export function persistSession(row: OwnerSurfaceSessionV1): void {
  append(fileOf("OWNER_SURFACE_SESSION_LOG", "sessions.jsonl"), row);
}
export function listSessions(): OwnerSurfaceSessionV1[] {
  return readJsonl<OwnerSurfaceSessionV1>(fileOf("OWNER_SURFACE_SESSION_LOG", "sessions.jsonl"));
}

export function persistLease(row: DevelopmentAuthorityLeaseV1): void {
  append(fileOf("OWNER_SURFACE_LEASE_LOG", "leases.jsonl"), row);
}
export function listLeases(): DevelopmentAuthorityLeaseV1[] {
  return readJsonl<DevelopmentAuthorityLeaseV1>(fileOf("OWNER_SURFACE_LEASE_LOG", "leases.jsonl"));
}

export function persistProposal(row: DevelopmentChangeProposalV1): void {
  append(fileOf("OWNER_SURFACE_PROPOSAL_LOG", "proposals.jsonl"), row);
}
export function listProposals(): DevelopmentChangeProposalV1[] {
  return readJsonl<DevelopmentChangeProposalV1>(fileOf("OWNER_SURFACE_PROPOSAL_LOG", "proposals.jsonl"));
}

export function persistAudit(row: Record<string, unknown>): void {
  append(fileOf("OWNER_SURFACE_AUDIT_LOG", "audit.jsonl"), { at: new Date().toISOString(), ...row });
}
export function persistNotice(kind: string, detail: Record<string, unknown>): void {
  append(fileOf("OWNER_SURFACE_NOTIFY_LOG", "notify.jsonl"), { schema: "OWNER_SURFACE_NOTIFICATION_HOOK_V1", kind, at: new Date().toISOString(), ...detail });
}
export function listNotices(): Record<string, unknown>[] {
  return readJsonl(fileOf("OWNER_SURFACE_NOTIFY_LOG", "notify.jsonl"));
}
