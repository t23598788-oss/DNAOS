import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { decideCompletion } from "../ui-render-verification/contract";
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

/**
 * The change set this work item declares. `target_files` is part of WorkItem
 * already — an explicitly empty array is a real claim ("this work changes no
 * file"), while a missing field is not a claim at all and is reported as
 * UNRESOLVED rather than read as empty.
 */
function completionProvenanceOf(item: WorkItem): readonly string[] | "UNRESOLVED" {
  const declared = (item as { target_files?: unknown }).target_files;
  if (!Array.isArray(declared)) return "UNRESOLVED";
  return declared.filter((entry): entry is string => typeof entry === "string");
}

let statePathForEvidence = "";
let eventPathForEvidence = "";

function id(prefix: string): string { return `${prefix}-${randomUUID()}`; }
function readJsonl<T>(path: string): T[] { if (!existsSync(path)) return []; try { return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as T]; } catch { return []; } }); } catch { return []; } }


/**
 * Writes the durable work-session checkpoint for one real work-item transition.
 *
 * `control/work-session-state/` is the ONE authority for work progression, and
 * this store is the second place a piece of work really moves. Before this,
 * work items that never pass through `control/agent-gateway/` had no durable
 * progression at all: kill the process and there was nothing to resume from.
 *
 * It restates nothing it does not own. `current_phase` is this store's own
 * `WorkStatus` value verbatim — no second lifecycle vocabulary — and the task
 * row itself stays the only place the status is read back from. The
 * architecture answer is referenced, never copied.
 *
 * `require` is lazy for the same reason as the one in
 * `control/agent-gateway/gateway.ts`: `control/work-session-state/ownership.ts`
 * imports THIS folder's contract to read held write locks, so a top-level
 * import here would close that ring at module-load time. The ring is broken at
 * the call, where it costs nothing.
 *
 * Never throws at the caller: a work item's real transition must not fail
 * because a journal could not be written. A failed write leaves the previous
 * checkpoint standing, so the resume engine reports the work at its last
 * durably-recorded phase, which is the truth.
 */
function checkpointWorkItem(item: WorkItem, blockedBy: string | null, data?: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const wss = require("../work-session-state/contract") as typeof import("../work-session-state/contract");
    const previous = wss.currentCheckpoint(item.task_id);
    const resolution = wss.resolveResolution(item.task_id);
    const now = new Date().toISOString();
    const revision = wss.currentRevision();

    const step = {
      step_id: `work-item:${item.status}:${now}`,
      title: `work item ${item.task_id} -> ${item.status}`,
      state: "COMPLETED" as const,
      phase: item.status,
      depends_on: [] as string[],
      affected_paths: item.target_files ?? [],
      evidence_refs: [`${statePathForEvidence}#${item.task_id}`],
      // Re-derivable from the real store this function just wrote to — the row
      // itself, not a claim that the transition happened.
      verification: { kind: "FILE_CONTAINS" as const, path: statePathForEvidence, literal: item.task_id },
      completed_at_revision: revision,
      completed_at: now,
    };

    const blockers = blockedBy === null
      ? (previous?.blockers ?? [])
      : [
          ...(previous?.blockers ?? []).filter((b) => b.blocker_id !== blockedBy),
          {
            blocker_id: blockedBy,
            layer: "control/work-coordination",
            detail: typeof data?.detail === "string" ? data.detail : `work item ${item.task_id} was refused completion: ${blockedBy}`,
            evidence_ref: `${eventPathForEvidence}#${item.task_id}`,
            next_action: typeof data?.reason === "string" ? data.reason : "resolve the named blocker, then transition the work item again",
            state: "OPEN" as const,
          },
        ];

    wss.appendCheckpoint({
      ...(previous ?? {}),
      work_id: item.task_id,
      owner_intent_id: previous?.owner_intent_id ?? item.command_id,
      task_id: item.task_id,
      session_id: previous?.session_id ?? wss.newSessionId(),
      execution_id: `exec-${process.pid}`,
      worker_identity: item.assigned_worker ?? "work-coordination",
      repository: "DNA-OS-INFRASTRUCTURE",
      branch: wss.currentBranch(),
      affected_resource_ids: previous?.affected_resource_ids ?? [],
      affected_paths: item.target_files ?? [],
      objective: previous?.objective ?? `work item ${item.task_id} (command ${item.command_id})`,
      current_phase: item.status,
      steps: [...(previous?.steps ?? []), step],
      blockers,
      decisions_required: previous?.decisions_required ?? [],
      evidence_refs: previous?.evidence_refs ?? [],
      source_revision: revision,
      last_verified_revision: revision,
      next_action: blockedBy ?? (item.status === "COMPLETED" ? "none" : `advance work item ${item.task_id} from ${item.status}`),
      do_not_repeat: previous?.do_not_repeat ?? [],
      ui_context: previous?.ui_context ?? null,
      last_durable_event: previous?.last_durable_event ?? [],
      sync_state: previous?.sync_state ?? "SYNCED",
      resolution_ref: resolution ? wss.resolutionRefOf(resolution) : (previous?.resolution_ref ?? null),
      cross_repo_evidence: previous?.cross_repo_evidence ?? [],
      status: item.status === "COMPLETED" ? "COMPLETE" : item.status === "FAILED" ? "BLOCKED" : "ACTIVE",
      started_at: previous?.started_at ?? item.created_at,
    });
  } catch {
    // A real transition must never fail because the journal could not be written.
  }
}

export function createCoordinationStore(root = resolve(process.cwd(), "local-runtime/coordination")): CoordinationStore {
  const eventPath = resolve(root, "events.jsonl"); const statePath = resolve(root, "work-items.json");
  // Named at module scope so `checkpointWorkItem` can cite the REAL files in
  // use, not the default paths written out as literals — under a test root
  // they differ, and a verification pointing at the wrong file turns a real
  // transition into an unprovable one.
  statePathForEvidence = statePath; eventPathForEvidence = eventPath;
  mkdirSync(dirname(eventPath), { recursive: true });
  const emit = (event_type: CoordinationEventType, item: WorkItem, data?: Record<string, unknown>) => appendFileSync(eventPath, `${JSON.stringify({ event_id: id("evt"), event_type, occurred_at: new Date().toISOString(), command_id: item.command_id, task_id: item.task_id, data })}\n`, { mode: 0o600 });
  const save = (items: WorkItem[]) => writeFileSync(statePath, JSON.stringify(items, null, 2), { mode: 0o600 });
  const load = (): WorkItem[] => { if (!existsSync(statePath)) return []; try { return JSON.parse(readFileSync(statePath, "utf8")) as WorkItem[]; } catch { return []; } };
  return {
    enqueue(input) {
      const items = load(); const duplicate = items.find((x) => x.idempotency_key === input.idempotency_key);
      if (duplicate) return { item: duplicate, duplicate: true };
      const item: WorkItem = { ...input, created_at: input.created_at ?? new Date().toISOString(), status: input.status ?? "QUEUED", retry_count: input.retry_count ?? 0 };
      items.push(item); save(items); emit("QUEUED", item);
      // WORK_CREATED. A work item that is born and then crashed on must still
      // be resumable; without this its first durable trace would be whatever
      // transition happened to come next.
      checkpointWorkItem(item, null);
      return { item, duplicate: false };
    },
    acquire(taskId) {
      const items = load(); const item = items.find((x) => x.task_id === taskId); if (!item) return { ok: false, reason: "TASK_NOT_FOUND" };
      if (item.status !== "QUEUED") return { ok: false, reason: `INVALID_STATUS:${item.status}` };
      const dep = items.find((x) => item.depends_on.includes(x.task_id) && x.status !== "COMPLETED"); if (dep) return { ok: false, reason: `DEPENDENCY_WAIT:${dep.task_id}` };
      const conflict = items.find((x) => x.task_id !== taskId && ["LOCKED", "RUNNING"].includes(x.status) && x.resource_lock.some((r) => item.resource_lock.includes(r)));
      if (conflict) return { ok: false, reason: `RESOURCE_CONFLICT:${conflict.task_id}` };
      item.status = "LOCKED"; save(items); emit("LOCK_ACQUIRED", item);
      checkpointWorkItem(item, null);
      return { ok: true, item };
    },
    ready(taskId, data) { const items = load(); const item = items.find((x) => x.task_id === taskId); if (!item) throw new Error("TASK_NOT_FOUND"); if (!["LOCKED", "RUNNING"].includes(item.status)) throw new Error(`INVALID_STATUS:${item.status}`); item.status = "RUNNING"; save(items); emit("READY_FOR_DISPATCH", item, data);
      // `ready` changes status without passing through `transition`, so it needs
      // its own checkpoint — wiring only `transition` left every LOCKED->RUNNING
      // move with no durable record at all (found by CASE E, 2026-08-26).
      checkpointWorkItem(item, null, data);
      return item; },
    markDispatched(taskId, data) { const items = load(); const item = items.find((x) => x.task_id === taskId); if (!item) throw new Error("TASK_NOT_FOUND"); save(items); emit("DISPATCHED", item, data); return item; },
    transition(taskId, status, data) {
      const items = load(); const item = items.find((x) => x.task_id === taskId); if (!item) throw new Error("TASK_NOT_FOUND");
      // THE SAME COMPLETION GATE, REACHED FROM THIS STORE (Owner, 2026-08-26).
      // This is the second store that can end a piece of work, and it already
      // carries its own change provenance in `target_files`. Rather than a
      // second gate, the existing one is called with that change set.
      //
      // The three outcomes are kept apart on purpose: a work item that
      // declares no target files changed nothing and completes as before; one
      // whose files are owned by a UI route must have a render verdict; and
      // one whose provenance cannot be read at all fails closed, because
      // "we could not tell" must never complete quietly.
      if (status === "COMPLETED") {
        const provenance = completionProvenanceOf(item);
        if (provenance === "UNRESOLVED") {
          item.status = "FAILED";
          save(items);
          emit("FAILED", item, { ...data, blocked_by: "COMPLETION_PROVENANCE_UNRESOLVED", detail: "target_files is absent on this work item — the change set could not be read, so completion fails closed" });
          checkpointWorkItem(item, "COMPLETION_PROVENANCE_UNRESOLVED", { detail: "target_files is absent on this work item — the change set could not be read, so completion fails closed" });
          return item;
        }
        if (provenance.length > 0) {
          const decision = decideCompletion({ execution_id: item.task_id, changed_paths: provenance, capability_id: item.task_id, applied_at: item.created_at, correlation_id: `work-item://${item.command_id}` });
          if (decision.status === "COMPLETE_DENIED") {
            item.status = "FAILED";
            save(items);
            emit("FAILED", item, { ...data, blocked_by: `UI_RENDER_NOT_VERIFIED:${decision.ui_impact}:${decision.render_verdict ?? "NO_EVIDENCE"}`, reason: decision.reason });
            checkpointWorkItem(item, `UI_RENDER_NOT_VERIFIED:${decision.ui_impact}:${decision.render_verdict ?? "NO_EVIDENCE"}`, { detail: decision.reason, reason: decision.reason });
            return item;
          }
        }
      }
      item.status = status; save(items); emit(status === "COMPLETED" ? "COMPLETED" : status === "FAILED" ? "FAILED" : status === "RUNNING" ? "EXECUTING" : "DISPATCHED", item, data);
      // DURABLE, BEFORE THE TRANSITION IS ACKNOWLEDGED. A crash between
      // `save` and this return is detectable: the item store has moved and the
      // checkpoint has not, which the resume engine reports rather than
      // resolving in anyone's favour.
      checkpointWorkItem(item, null, data);
      return item;
    },
    release(taskId, data) { const items = load(); const item = items.find((x) => x.task_id === taskId); if (!item) throw new Error("TASK_NOT_FOUND"); save(items); emit("LOCK_RELEASED", item, data); return item; },
    events: () => readJsonl<CoordinationEvent>(eventPath), items: load,
  };
}
