/**
 * หน้าที่: type contracts for `control/realtime-change/` — the realtime
 * filesystem change path (Owner, 2026-08-26).
 *
 * THE RAW OS FACTS ARE NEVER REWRITTEN. `ChangeEvent` holds what the operating
 * system reported and nothing derived from it; everything the system works out
 * afterwards lives on `ChangeImpactContext`, beside the event, never on top of
 * it. If a resolution is wrong, the original observation is still there to
 * check it against.
 *
 * INTERRUPT AND CONTEXT ARE TWO DIFFERENT THINGS and are two different types
 * here. An interrupt says "stop advancing the affected work until this is
 * reconciled". A context says "here is what changed, and what is proven about
 * it". Neither authorizes anything: there is no field on either that can grant
 * a write, create work, or carry a policy decision — see ./interrupt.ts.
 *
 * Input: none (pure type definitions).
 * Output: `ChangeEvent`, `ChangeImpactContext`, `InterruptSignal`,
 * `AgentAck`, `ObservationStatus`, `WatchScope`.
 * Dependency ที่อนุญาต: ../system-read-paths/contract.ts (types only).
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่มฟิลด์ลง `ChangeEvent` ที่ไม่ได้มาจาก OS โดยตรง.
 * - ห้ามให้ `InterruptSignal` มีฟิลด์ที่อนุญาต write/execution ได้.
 * - ห้ามให้สถานะ observer เป็นอย่างอื่นนอกจากความจริง — ไม่มี event ปลอมเมื่อ
 *   observer ใช้งานไม่ได้ (`OBSERVATION_UNAVAILABLE`).
 */

import type { ConformanceFinding } from "../system-read-paths/contract";

/** Where the watcher is actually watching, and why that scope — never a hard-coded project list. */
export interface WatchScope {
  path: string;
  /** The runtime fact that put this path under observation. */
  origin: "WRITE_LOCK" | "ACTIVE_LAUNCH" | "EXPLICIT_REQUEST";
  origin_ref: string;
}

/** Exactly what the OS said. Nothing here is inferred. */
export interface ChangeEvent {
  event_id: string;
  path: string;
  event_type: "rename" | "change";
  observed_at: string;
  /** The observing mechanism itself — not a guess about which process wrote the file. */
  source: string;
  /** Raw stat facts at observation time, or the reason they could not be read. */
  filesystem_evidence: {
    exists: boolean;
    size_bytes: number | null;
    mtime: string | null;
    inode: number | null;
    note: string | null;
  };
  watch_scope: WatchScope;
}

/** What the system proved about a change. Separate object, separate lifetime. */
export interface ChangeImpactContext {
  event_id: string;
  resolved_at: string;
  changed_resource: { resource_id: string; source_location: string; provenance: string; evidence: readonly string[] } | null;
  related_capability: { capability_id: string; provenance: string; evidence: readonly string[] } | null;
  active_task: { task_id: string; status: string; observed_at: string; evidence: readonly string[] } | null;
  active_launch: { launch_id: string; pid: number; allowed_workspace_dir: string } | null;
  write_lock: { holder: string; scope_path: string; evidence: readonly string[] } | null;
  evidence_refs: readonly string[];
  affected_documents: readonly string[];
  affected_blueprint_claims: readonly ConformanceFinding[];
  previous_state: string | null;
  unresolved_refs: readonly string[];
}

/**
 * "Stop advancing the affected work until the new system state is reconciled."
 * Deliberately carries no capability, no grant, no command and no payload the
 * receiver could act on as authority.
 */
export interface InterruptSignal {
  interrupt_id: string;
  event_id: string;
  issued_at: string;
  reason: "RESOURCE_CHANGED_UNDER_ACTIVE_WORK";
  /** The proven overlap that justifies interrupting THIS execution and no other. */
  overlap_evidence: readonly string[];
  target: { kind: "WRITE_LOCK_HOLDER" | "ACTIVE_LAUNCH"; id: string; scope_path: string };
  /** Stated in the signal itself so a reader never has to infer it. */
  authorizes: "NOTHING";
}

/** What the interrupted execution reports back. Observed, never assumed. */
export interface AgentAck {
  interrupt_id: string;
  acknowledged_at: string;
  state: "PAUSED" | "ALREADY_FINISHED" | "REFUSED";
  current_step: string | null;
  note: string | null;
}

export type ObservationStatus =
  | { observing: true; scopes: readonly WatchScope[]; since: string }
  | { observing: false; reason: "OBSERVATION_UNAVAILABLE"; detail: string };
