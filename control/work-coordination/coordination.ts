import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { acquireLock, releaseLock, renewLock } from "../../execution/process-lock/contract";

export type WorkStatus = "QUEUED" | "LOCKED" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type CoordinationEventType = "COMMAND_RECEIVED" | "DECISION_CREATED" | "QUEUED" | "LOCK_ACQUIRED" | "READY_FOR_DISPATCH" | "DISPATCHED" | "EXECUTING" | "EVIDENCE_RECEIVED" | "COMPLETED" | "FAILED" | "LOCK_RELEASED" | "CANCELLED";

/**
 * Real, cross-process-safe ownership claim — ADDITIVE to `CoordinationStore`
 * above, never replacing it. `acquire(taskId)` (above) is unchanged and
 * still used by `control/agent-gateway/controller.ts`,
 * `control/owner-command/input-gateway.ts`, and
 * `control/event-pipeline/canonical-event-pipeline.ts` exactly as before
 * — all three run in-process, single control-plane instance, and never
 * needed cross-process exclusivity. `claimWork`/`releaseWorkClaim`/
 * `renewWorkClaim` exist for the NEW multi-agent entry point, where
 * multiple separate OS processes (real external agents) can race the
 * same work item — see `../../execution/process-lock/` for the real
 * `O_CREAT|O_EXCL` guarantee this is built on. `WORK:<work_id>` is the
 * primary exclusivity lock (Invariant: at most one active claim holder
 * per work item, at any time, across any number of processes);
 * `SOURCE:<repository_id>:<resource>` locks (one per declared resource)
 * additionally serialize two different work items that target the same
 * real resource — both real, both proven by
 * `../../execution/process-lock/tests/process-lock.test.ts`'s real
 * cross-process test.
 */
export interface WorkClaim {
  work_id: string;
  task_id: string;
  holder_agent_id: string;
  repository_id: string | null;
  workspace_ref: string | null;
  lock_key: string;
  source_lock_keys: readonly string[];
  claimed_at: string;
  lease_expires_at: string;
}

export interface ClaimWorkInput {
  work_id: string;
  task_id: string;
  holder_agent_id: string;
  repository_id?: string | null;
  workspace_ref?: string | null;
  /** Real resource paths/scopes this work item will write — each gets its own SOURCE lock, so two work items targeting different resources never contend. */
  resource_scope: readonly string[];
  lease_ms: number;
}

export type ClaimWorkResult = { ok: true; claim: WorkClaim } | { ok: false; reason: string };
export type ReleaseClaimResult = { ok: true } | { ok: false; reason: string };

function sourceLockKey(repositoryId: string | null | undefined, resource: string): string {
  return `SOURCE:${repositoryId ?? "unscoped"}:${resource}`;
}

/**
 * Real cross-process atomic claim. Acquires `WORK:<work_id>` first (the
 * Invariant this whole function exists to guarantee), then one
 * `SOURCE:<repository_id>:<resource>` lock per declared resource — if
 * any single one fails, everything already acquired this call is rolled
 * back and the real conflicting reason is reported, never guessed.
 */
export function claimWork(input: ClaimWorkInput): ClaimWorkResult {
  const workLockKey = `WORK:${input.work_id}`;
  const workLock = acquireLock({ lock_key: workLockKey, holder_id: input.holder_agent_id, lease_ms: input.lease_ms });
  if (workLock.status !== "ACQUIRED") {
    return { ok: false, reason: `WORK_ALREADY_CLAIMED:${workLock.held_by?.holder_id ?? "unknown"}` };
  }

  const acquiredSourceKeys: string[] = [];
  for (const resource of input.resource_scope) {
    const key = sourceLockKey(input.repository_id, resource);
    const result = acquireLock({ lock_key: key, holder_id: input.holder_agent_id, lease_ms: input.lease_ms });
    if (result.status !== "ACQUIRED") {
      for (const acquiredKey of acquiredSourceKeys) releaseLock(acquiredKey, input.holder_agent_id);
      releaseLock(workLockKey, input.holder_agent_id);
      return { ok: false, reason: `SOURCE_CONFLICT:${key}:${result.held_by?.holder_id ?? "unknown"}` };
    }
    acquiredSourceKeys.push(key);
  }

  const claim: WorkClaim = {
    work_id: input.work_id,
    task_id: input.task_id,
    holder_agent_id: input.holder_agent_id,
    repository_id: input.repository_id ?? null,
    workspace_ref: input.workspace_ref ?? null,
    lock_key: workLockKey,
    source_lock_keys: acquiredSourceKeys,
    claimed_at: workLock.claim!.acquired_at,
    lease_expires_at: workLock.claim!.lease_expires_at,
  };
  return { ok: true, claim };
}

export function releaseWorkClaim(claim: Pick<WorkClaim, "work_id" | "holder_agent_id" | "source_lock_keys">): ReleaseClaimResult {
  for (const key of claim.source_lock_keys) releaseLock(key, claim.holder_agent_id);
  const released = releaseLock(`WORK:${claim.work_id}`, claim.holder_agent_id);
  return released.status === "RELEASED" ? { ok: true } : { ok: false, reason: released.status };
}

/** Extends the caller's own already-held claim's lease — takes the real `WorkClaim` it already holds, never reconstructs one from bare ids. */
export function renewWorkClaim(claim: WorkClaim, leaseMs: number): ClaimWorkResult {
  const renewed = renewLock(claim.lock_key, claim.holder_agent_id, leaseMs);
  if (renewed.status !== "ACQUIRED" || !renewed.claim) return { ok: false, reason: "NOT_HOLDER_OR_EXPIRED" };
  return { ok: true, claim: { ...claim, claimed_at: renewed.claim.acquired_at, lease_expires_at: renewed.claim.lease_expires_at } };
}

export interface WorkItem {
  command_id: string; task_id: string; idempotency_key: string; priority: number;
  created_at: string; depends_on: string[]; resource_lock: string[]; target_files: string[];
  assigned_worker?: string; retry_count: number; status: WorkStatus; parent_task_id?: string;
}
export interface CoordinationEvent { event_id: string; event_type: CoordinationEventType; occurred_at: string; command_id: string; task_id: string; data?: Record<string, unknown>; }
export interface CoordinationStore { enqueue(item: Omit<WorkItem, "status" | "retry_count" | "created_at"> & Partial<Pick<WorkItem, "status" | "retry_count" | "created_at">>): { item: WorkItem; duplicate: boolean }; acquire(taskId: string): { ok: true; item: WorkItem } | { ok: false; reason: string }; ready(taskId: string, data?: Record<string, unknown>): WorkItem; markDispatched(taskId: string, data?: Record<string, unknown>): WorkItem; transition(taskId: string, status: WorkStatus, data?: Record<string, unknown>): WorkItem; release(taskId: string, data?: Record<string, unknown>): WorkItem; events(): CoordinationEvent[]; items(): WorkItem[]; }

function id(prefix: string): string { return `${prefix}-${randomUUID()}`; }
function readJsonl<T>(path: string): T[] { if (!existsSync(path)) return []; try { return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as T]; } catch { return []; } }); } catch { return []; } }

export function createCoordinationStore(root = resolve(process.cwd(), "local-runtime/coordination")): CoordinationStore {
  const eventPath = resolve(root, "events.jsonl"); const statePath = resolve(root, "work-items.json");
  mkdirSync(dirname(eventPath), { recursive: true });
  const emit = (event_type: CoordinationEventType, item: WorkItem, data?: Record<string, unknown>) => appendFileSync(eventPath, `${JSON.stringify({ event_id: id("evt"), event_type, occurred_at: new Date().toISOString(), command_id: item.command_id, task_id: item.task_id, data })}\n`, { mode: 0o600 });
  const save = (items: WorkItem[]) => writeFileSync(statePath, JSON.stringify(items, null, 2), { mode: 0o600 });
  const load = (): WorkItem[] => { if (!existsSync(statePath)) return []; try { return JSON.parse(readFileSync(statePath, "utf8")) as WorkItem[]; } catch { return []; } };
  return {
    enqueue(input) {
      const items = load(); const duplicate = items.find((x) => x.idempotency_key === input.idempotency_key);
      if (duplicate) return { item: duplicate, duplicate: true };
      const item: WorkItem = { ...input, created_at: input.created_at ?? new Date().toISOString(), status: input.status ?? "QUEUED", retry_count: input.retry_count ?? 0 };
      items.push(item); save(items); emit("QUEUED", item); return { item, duplicate: false };
    },
    acquire(taskId) {
      const items = load(); const item = items.find((x) => x.task_id === taskId); if (!item) return { ok: false, reason: "TASK_NOT_FOUND" };
      if (item.status !== "QUEUED") return { ok: false, reason: `INVALID_STATUS:${item.status}` };
      const dep = items.find((x) => item.depends_on.includes(x.task_id) && x.status !== "COMPLETED"); if (dep) return { ok: false, reason: `DEPENDENCY_WAIT:${dep.task_id}` };
      const conflict = items.find((x) => x.task_id !== taskId && ["LOCKED", "RUNNING"].includes(x.status) && x.resource_lock.some((r) => item.resource_lock.includes(r)));
      if (conflict) return { ok: false, reason: `RESOURCE_CONFLICT:${conflict.task_id}` };
      item.status = "LOCKED"; save(items); emit("LOCK_ACQUIRED", item); return { ok: true, item };
    },
    ready(taskId, data) { const items = load(); const item = items.find((x) => x.task_id === taskId); if (!item) throw new Error("TASK_NOT_FOUND"); if (!["LOCKED", "RUNNING"].includes(item.status)) throw new Error(`INVALID_STATUS:${item.status}`); item.status = "RUNNING"; save(items); emit("READY_FOR_DISPATCH", item, data); return item; },
    markDispatched(taskId, data) { const items = load(); const item = items.find((x) => x.task_id === taskId); if (!item) throw new Error("TASK_NOT_FOUND"); save(items); emit("DISPATCHED", item, data); return item; },
    transition(taskId, status, data) { const items = load(); const item = items.find((x) => x.task_id === taskId); if (!item) throw new Error("TASK_NOT_FOUND"); item.status = status; save(items); emit(status === "COMPLETED" ? "COMPLETED" : status === "FAILED" ? "FAILED" : status === "RUNNING" ? "EXECUTING" : "DISPATCHED", item, data); return item; },
    release(taskId, data) { const items = load(); const item = items.find((x) => x.task_id === taskId); if (!item) throw new Error("TASK_NOT_FOUND"); save(items); emit("LOCK_RELEASED", item, data); return item; },
    events: () => readJsonl<CoordinationEvent>(eventPath), items: load,
  };
}
