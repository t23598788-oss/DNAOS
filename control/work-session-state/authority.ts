/**
 * หน้าที่: ประกาศว่า **ข้อเท็จจริงแต่ละชนิดเป็นของใคร** และเป็นทางเดียวที่
 * ผู้อ่านควรใช้ถามหาข้อเท็จจริงเหล่านั้น
 *
 * ปัญหาที่ปิด: `control/work-resolution/` กับ `control/work-session-state/`
 * ผูกกับ `work_id` เดียวกันแต่ไม่รู้จักกัน ถ้าปล่อยไว้ วันหนึ่งจะมีสองที่ที่
 * ตอบคำถามเดียวกันได้คนละคำตอบ — และเมื่อถึงตอนนั้นจะไม่มีวิธีตัดสินที่ไม่ใช่
 * การเดา ("อันไหนใหม่กว่าชนะ" คือการเดาที่แต่งตัวมาดี)
 *
 * กฎเดียวของไฟล์นี้: **ห้ามคัดลอกข้อเท็จจริงที่มีเจ้าของแล้วไปเก็บไว้อีกที่**
 * checkpoint เก็บได้แค่ `resolution_ref` ซึ่งเป็น *ตัวชี้* ไม่ใช่สำเนา และ
 * ทุกฟังก์ชันข้างล่างนี้เดินไปอ่านจากเจ้าของจริงทุกครั้ง
 *
 * Input: `work_id`.
 * Output: `STATE_AUTHORITY`, `resolveAllowedWriteScope`,
 * `resolveResolution`, `authorityOf`, `authorityReport`.
 * Dependency ที่อนุญาต: ./types.ts, ./store.ts และ
 * `../work-resolution/contract.ts` (เรียกแบบ lazy — ดูเหตุผลใน `loadCanonicalResolution`)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่มฟิลด์ลง `WorkSessionCheckpoint` ที่ซ้ำกับสิ่งที่ตารางนี้บอกว่า
 *   เป็นของ store อื่น
 * - ห้ามใช้ timestamp ตัดสินว่าใครถูก — ตัดสินด้วย "ใครเป็นเจ้าของ" เท่านั้น
 * - ห้ามให้ AI ทำ reconciliation
 */
import type { ResolutionRef } from "./types";
import { currentCheckpoint } from "./store";

/** How a fact is produced. */
export type FactKind = "AUTHORITATIVE" | "DERIVABLE";

export interface StateAuthority {
  state_type: string;
  canonical_owner: string;
  /** The ONE symbol that may write it. */
  writer: string;
  readers: readonly string[];
  persistence_path: string;
  /** How long the fact is meaningful. */
  lifetime: string;
  kind: FactKind;
}

/**
 * THE OWNERSHIP TABLE. Every row names exactly one owner. Two rows must never
 * describe the same fact — if they ever do, that is the bug this file exists
 * to make visible, not a tie to be broken at read time.
 */
export const STATE_AUTHORITY: readonly StateAuthority[] = [
  {
    state_type: "RESOLVED_ARCHITECTURE (decision, existing capability/resource, exact source paths, contracts, allowed/forbidden write scope, components to reuse, verification commands, completion conditions)",
    canonical_owner: "control/work-resolution",
    writer: "control/work-resolution/persistence.ts#persistResolution",
    readers: ["control/work-session-state/authority.ts#resolveResolution", "control/work-resolution/mandatory-gate.ts#guardAgentWrite", "control/work-resolution/contract.ts#toWorkPacketFields"],
    persistence_path: "control/agent-gateway/data/evidence.jsonl (kind=capability_lookup, source=control/work-resolution/persistence.ts)",
    lifetime: "until the real bytes behind exact_source_paths change — proven by resolution_digest, never by elapsed time",
    kind: "AUTHORITATIVE",
  },
  {
    state_type: "WORK_PROGRESS (current phase, completed steps, blockers, decisions required, next action, resume state, UI context, stream positions)",
    canonical_owner: "control/work-session-state",
    writer: "control/work-session-state/store.ts#appendCheckpoint",
    readers: ["control/work-session-state/resume.ts#buildResumeContext", "control/work-session-state/rehydrate.ts#buildRehydrationPlan", "dna-os-circuit/runtime/derived-graph.ts"],
    persistence_path: "local-runtime/work-session-state/checkpoints.jsonl",
    lifetime: "for the life of the work_id; the last row per work_id is the current state",
    kind: "AUTHORITATIVE",
  },
  {
    state_type: "PRE_MUTATION_INTENT (edit intent, draft, before-digests, mutation lifecycle stage)",
    canonical_owner: "control/work-session-state (journal)",
    writer: "control/work-session-state/journal.ts#openEntry / #advanceEntry",
    readers: ["control/work-session-state/journal.ts#recoverableEntries", "control/work-session-state/rehydrate.ts#buildRehydrationPlan"],
    persistence_path: "local-runtime/work-session-state/work-journal.jsonl",
    lifetime: "from INTENT until COMMITTED; a COMMITTED entry is no longer offered for recovery",
    kind: "AUTHORITATIVE",
  },
  {
    state_type: "TASK_LIFECYCLE_STATUS (RECEIVED..COMPLETED/FAILED/BLOCKED for one agent-gateway task)",
    canonical_owner: "control/agent-gateway",
    writer: "control/agent-gateway/gateway.ts#persistStatus",
    readers: ["control/agent-gateway/contract.ts#getTask", "control/work-session-state (references task_id, never restates status)"],
    persistence_path: "control/agent-gateway/data/tasks.jsonl",
    lifetime: "for the life of the task",
    kind: "AUTHORITATIVE",
  },
  {
    state_type: "WORK_ITEM_QUEUE_STATE (QUEUED/LOCKED/RUNNING/COMPLETED/FAILED, target_files, resource locks)",
    canonical_owner: "control/work-coordination",
    writer: "control/work-coordination/coordination.ts#transition",
    readers: ["control/agent-gateway/controller.ts", "control/owner-command/input-gateway.ts"],
    persistence_path: "local-runtime/coordination/work-items.json + events.jsonl",
    lifetime: "for the life of the work item",
    kind: "AUTHORITATIVE",
  },
  {
    state_type: "HELD_WRITE_BOUNDARY (who currently holds which path scope)",
    canonical_owner: "control/work-coordination",
    writer: "control/work-coordination/write-scope.ts#claimWriteScope",
    readers: ["control/work-session-state/ownership.ts#resolveChangeOwner"],
    persistence_path: "the lock directory — DERIVED from real lock files, never from a maintained index",
    lifetime: "until the lease expires or the lock is released",
    kind: "DERIVABLE",
  },
  {
    state_type: "CONNECTION_POSITION (last event id processed per stream, retry state)",
    canonical_owner: "control/work-session-state (connection)",
    writer: "control/work-session-state/connection.ts#recordConnectionState",
    readers: ["control/work-session-state/connection.ts#reconcile", "control/work-session-state/rehydrate.ts#buildRehydrationPlan"],
    persistence_path: "local-runtime/work-session-state/connections.jsonl",
    lifetime: "per stream, until superseded",
    kind: "AUTHORITATIVE",
  },
  {
    state_type: "QUEUED_NETWORK_OPERATION (operations parked while a provider is unreachable)",
    canonical_owner: "control/work-session-state (connection)",
    writer: "control/work-session-state/connection.ts#queueNetworkOperation",
    readers: ["control/work-session-state/connection.ts#drainQueue"],
    persistence_path: "local-runtime/work-session-state/network-queue.jsonl",
    lifetime: "until DONE, or until an Owner decision releases it",
    kind: "AUTHORITATIVE",
  },
  {
    state_type: "OBSERVED_JOINTS_AND_VIOLATIONS",
    canonical_owner: "observability/joint-monitor",
    writer: "observability/joint-monitor/server.ts (POST /joints, POST /violations)",
    readers: ["observability/joint-monitor/joint-store.ts#snapshot", "the SSE stream"],
    persistence_path: "observability/joint-monitor/data/joints.jsonl + violations.jsonl",
    lifetime: "durable log; the in-memory ring is a bounded projection of it",
    kind: "DERIVABLE",
  },
];

export function authorityOf(stateTypeFragment: string): StateAuthority | null {
  const needle = stateTypeFragment.toUpperCase();
  return STATE_AUTHORITY.find((row) => row.state_type.toUpperCase().includes(needle)) ?? null;
}

/**
 * Loads the canonical resolution for a work_id.
 *
 * The require is LAZY on purpose, and this is the whole reason:
 * `control/work-resolution/persistence.ts` stores its rows in
 * `control/agent-gateway`'s evidence store (correctly — the Owner forbade a
 * second store), and `control/agent-gateway/gateway.ts` now writes checkpoints
 * through this capability. A top-level import here would close that ring at
 * module-load time. Resolving it by moving the resolution into its own store
 * would be exactly the duplication this file exists to prevent, so the ring is
 * broken at the only place where it costs nothing: the call.
 */
function loadCanonicalResolution(workId: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("../work-resolution/contract") as { loadResolution(workId: string): unknown };
  return mod.loadResolution(workId);
}

export interface CanonicalResolution {
  resolution_id: string;
  resolution_digest: string;
  source_revision: string;
  stale: boolean;
  staleness_reason: string;
  context: Record<string, unknown>;
}

/** The canonical resolution, or `null` when this work_id has none. Never invented. */
export function resolveResolution(workId: string): CanonicalResolution | null {
  const loaded = loadCanonicalResolution(workId) as CanonicalResolution | null;
  return loaded ?? null;
}

export function resolutionRefOf(resolution: CanonicalResolution): ResolutionRef {
  return {
    resolution_id: resolution.resolution_id,
    resolution_digest: resolution.resolution_digest,
    source_revision: resolution.source_revision,
    referenced_at: new Date().toISOString(),
  };
}

export type ScopeAnswer =
  | { status: "RESOLVED"; allowed_write_scope: readonly string[]; forbidden_write_scope: readonly string[]; from: string; resolution_id: string }
  | { status: "NO_RESOLUTION"; detail: string };

/**
 * The allowed write scope for a work_id — read from the ONE place that owns it.
 *
 * A checkpoint may not answer this question even if someone smuggles a copy of
 * the field into it: this function never looks at the checkpoint's fields, only
 * at its `resolution_ref`, and then reads the resolution itself. Two things
 * follow, and both are the point:
 *   - a stale copy in the session store cannot win, ever, whatever its timestamp;
 *   - there is no reconciliation step, so there is nothing for an AI to arbitrate.
 */
export function resolveAllowedWriteScope(workId: string, options: { path?: string } = {}): ScopeAnswer {
  const resolution = resolveResolution(workId);
  if (resolution === null) {
    const checkpoint = currentCheckpoint(workId, options.path);
    return {
      status: "NO_RESOLUTION",
      detail: checkpoint?.resolution_ref
        ? `checkpoint references resolution ${checkpoint.resolution_ref.resolution_id} but control/work-resolution has no such record — the reference is dangling and is NOT substituted with anything`
        : "no resolution has been persisted for this work_id — scope is unknown, and unknown is not empty",
    };
  }
  const ctx = resolution.context as { allowed_write_scope?: readonly string[]; forbidden_write_scope?: readonly string[] };
  return {
    status: "RESOLVED",
    allowed_write_scope: ctx.allowed_write_scope ?? [],
    forbidden_write_scope: ctx.forbidden_write_scope ?? [],
    from: "control/work-resolution/persistence.ts#loadResolution",
    resolution_id: resolution.resolution_id,
  };
}

/** Renders the ownership table. Used by the proofs and by anyone asking "who owns this?". */
export function authorityReport(): string {
  const lines = ["STATE_TYPE | CANONICAL_OWNER | WRITER | PERSISTENCE_PATH | LIFETIME | KIND"];
  for (const row of STATE_AUTHORITY) {
    lines.push(`${row.state_type.split(" (")[0]} | ${row.canonical_owner} | ${row.writer} | ${row.persistence_path} | ${row.lifetime} | ${row.kind}`);
  }
  return lines.join("\n");
}
