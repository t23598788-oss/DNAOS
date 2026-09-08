/**
 * หน้าที่: deterministic Engineering autonomous-loop state machine.
 * Workers never choose the next stage. Illegal transitions fail closed.
 *
 * Input: current stage + intended next stage + work_id.
 * Output: allow/deny + persisted lifecycle rows.
 * Dependency ที่อนุญาต: ./persist.ts, ./types.ts, node:crypto.
 * สิ่งที่ห้ามแตะ: never let a worker-supplied status become the stage.
 */

import { createHash } from "node:crypto";
import { appendJsonlNamed, readJsonlObjects } from "./persist";
import type { EngineeringGateReason } from "./types";

export const ENGINEERING_LIFECYCLE_STAGES = [
  "REQUESTED",
  "SCOPED",
  "RESERVED",
  "DISPATCHED",
  "CODE_PROPOSED",
  "VALIDATING",
  "REPAIR_REQUIRED",
  "BUILDING",
  "TESTING",
  "GOVERNANCE_CHECK",
  "READY_TO_PUBLISH",
  "PUBLISHING",
  "REMOTE_VERIFICATION",
  "CI_PENDING",
  "CI_VERIFIED",
  "CI_FAILED",
  "REGISTRY_UPDATE",
  "VERIFIED",
  "REJECTED",
  "BLOCKED",
  "FAILED",
  "OWNER_REVIEW",
] as const;

export type EngineeringLifecycleStage = typeof ENGINEERING_LIFECYCLE_STAGES[number];

export const TERMINAL_ENGINEERING_STAGES: ReadonlySet<EngineeringLifecycleStage> = new Set([
  "VERIFIED",
  "REJECTED",
  "BLOCKED",
  "FAILED",
  "OWNER_REVIEW",
]);

const LEGAL: Readonly<Record<EngineeringLifecycleStage, readonly EngineeringLifecycleStage[]>> = {
  REQUESTED: ["SCOPED", "BLOCKED", "REJECTED"],
  SCOPED: ["RESERVED", "BLOCKED", "REJECTED"],
  RESERVED: ["DISPATCHED", "BLOCKED"],
  DISPATCHED: ["CODE_PROPOSED", "FAILED", "BLOCKED"],
  CODE_PROPOSED: ["VALIDATING", "FAILED"],
  VALIDATING: ["REPAIR_REQUIRED", "BUILDING", "FAILED", "REJECTED"],
  REPAIR_REQUIRED: ["DISPATCHED", "FAILED", "OWNER_REVIEW"],
  BUILDING: ["TESTING", "REPAIR_REQUIRED", "FAILED"],
  TESTING: ["GOVERNANCE_CHECK", "REPAIR_REQUIRED", "FAILED"],
  GOVERNANCE_CHECK: ["READY_TO_PUBLISH", "REPAIR_REQUIRED", "REJECTED"],
  READY_TO_PUBLISH: ["PUBLISHING", "BLOCKED"],
  PUBLISHING: ["REMOTE_VERIFICATION", "FAILED", "BLOCKED"],
  REMOTE_VERIFICATION: ["CI_PENDING", "CI_VERIFIED", "CI_FAILED", "BLOCKED", "FAILED", "REPAIR_REQUIRED"],
  CI_PENDING: ["CI_VERIFIED", "CI_FAILED", "CI_PENDING", "BLOCKED"],
  CI_VERIFIED: ["REGISTRY_UPDATE", "BLOCKED"],
  CI_FAILED: ["REPAIR_REQUIRED", "FAILED", "OWNER_REVIEW"],
  REGISTRY_UPDATE: ["VERIFIED", "BLOCKED"],
  VERIFIED: [],
  REJECTED: [],
  BLOCKED: [],
  FAILED: [],
  OWNER_REVIEW: [],
};

export interface EngineeringLifecycleRecord {
  readonly work_id: string;
  readonly command_id: string;
  readonly stage: EngineeringLifecycleStage;
  readonly attempt: number;
  readonly worker_id: string | null;
  readonly action_fingerprint: string;
  readonly allowed_paths: readonly string[];
  readonly reservation_id: string | null;
  readonly reason_code: EngineeringGateReason | "ADMITTED" | "LIFECYCLE";
  readonly detail: string;
  readonly evidence_ref: string;
  readonly recorded_at: string;
}

function lifecycleFile(): string {
  return process.env.ENGINEERING_LIFECYCLE_LOG ?? "lifecycle.jsonl";
}

function locksFile(): string {
  return process.env.ENGINEERING_SCOPE_LOCK_LOG ?? "scope-locks.jsonl";
}

export function fingerprintEngineeringAction(intentText: string, allowedPaths: readonly string[]): string {
  return createHash("sha256").update(`${intentText.trim().toLowerCase()}\n${[...allowedPaths].sort().join("\n")}`).digest("hex");
}

export function canTransition(from: EngineeringLifecycleStage, to: EngineeringLifecycleStage): boolean {
  return LEGAL[from].includes(to);
}

export function persistLifecycle(row: EngineeringLifecycleRecord): EngineeringLifecycleRecord {
  appendJsonlNamed(lifecycleFile(), row);
  return row;
}

export function listLifecycle(): readonly EngineeringLifecycleRecord[] {
  return readJsonlObjects<EngineeringLifecycleRecord>(lifecycleFile());
}

export function latestLifecycleForWork(workId: string): EngineeringLifecycleRecord | null {
  const rows = listLifecycle().filter((row) => row.work_id === workId);
  return rows.length > 0 ? rows[rows.length - 1]! : null;
}

export function latestLifecycleForFingerprint(fingerprint: string): EngineeringLifecycleRecord | null {
  const rows = listLifecycle().filter((row) => row.action_fingerprint === fingerprint);
  return rows.length > 0 ? rows[rows.length - 1]! : null;
}

export interface ScopeLockRow {
  readonly work_id: string;
  readonly allowed_paths: readonly string[];
  readonly active: boolean;
  readonly recorded_at: string;
}

export function persistScopeLock(row: ScopeLockRow): void {
  appendJsonlNamed(locksFile(), row);
}

export function activeScopeLocks(): readonly ScopeLockRow[] {
  const latest = new Map<string, ScopeLockRow>();
  for (const row of readJsonlObjects<ScopeLockRow>(locksFile())) latest.set(row.work_id, row);
  return [...latest.values()].filter((row) => row.active);
}

function pathsOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((left) => b.some((right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)));
}

export function overlappingActiveScope(workId: string, allowedPaths: readonly string[]): ScopeLockRow | null {
  return activeScopeLocks().find((row) => row.work_id !== workId && pathsOverlap(row.allowed_paths, allowedPaths)) ?? null;
}

export function transitionLifecycle(input: {
  readonly previous: EngineeringLifecycleRecord | null;
  readonly next: EngineeringLifecycleStage;
  readonly work_id: string;
  readonly command_id: string;
  readonly attempt: number;
  readonly worker_id: string | null;
  readonly action_fingerprint: string;
  readonly allowed_paths: readonly string[];
  readonly reservation_id: string | null;
  readonly reason_code: EngineeringLifecycleRecord["reason_code"];
  readonly detail: string;
  readonly evidence_ref: string;
  readonly recorded_at: string;
}): { readonly ok: true; readonly record: EngineeringLifecycleRecord } | { readonly ok: false; readonly reason_code: "LIFECYCLE_ILLEGAL_TRANSITION"; readonly detail: string } {
  const from = input.previous?.stage ?? "REQUESTED";
  if (input.previous === null) {
    if (input.next !== "REQUESTED" && input.next !== "BLOCKED" && input.next !== "REJECTED") {
      return { ok: false, reason_code: "LIFECYCLE_ILLEGAL_TRANSITION", detail: `first stage must be REQUESTED, got ${input.next}` };
    }
  } else if (!canTransition(from, input.next)) {
    return { ok: false, reason_code: "LIFECYCLE_ILLEGAL_TRANSITION", detail: `illegal ${from} → ${input.next}` };
  }
  const record = persistLifecycle({
    work_id: input.work_id,
    command_id: input.command_id,
    stage: input.next,
    attempt: input.attempt,
    worker_id: input.worker_id,
    action_fingerprint: input.action_fingerprint,
    allowed_paths: input.allowed_paths,
    reservation_id: input.reservation_id,
    reason_code: input.reason_code,
    detail: input.detail,
    evidence_ref: input.evidence_ref,
    recorded_at: input.recorded_at,
  });
  return { ok: true, record };
}
