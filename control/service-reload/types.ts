/**
 * หน้าที่: type contracts for `control/service-reload/` — the missing
 * connection between "source on disk changed" and the EXISTING runtime
 * lifecycle authority, `../runtime-control/`.
 *
 * IT IS NOT A RESTART SYSTEM. Nothing in this capability calls launchctl,
 * kill, or spawns anything. It resolves which registered service a changed
 * path belongs to, runs a gate, and then asks `runtime-control` to act.
 * `runtime-control` remains the only executor; launchd remains the only
 * supervisor.
 *
 * Input: none (pure type definitions).
 * Output: `ServiceImpact`, `ReloadGate`, `SourceRevision`, `ReloadOutcome`.
 * Dependency ที่อนุญาต: ../runtime-control/contract.ts (types only).
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม field ที่ไม่ได้มาจากข้อเท็จจริงที่สังเกตจริง —
 * โดยเฉพาะ `loaded_current_revision` ต้องมาจากการเทียบเวลาเริ่ม process กับ
 * mtime ของ source จริงเท่านั้น ห้ามอนุมานจากการที่ restart คืน SUCCESS.
 */
import type { ServiceId, OperationEvidence } from "../runtime-control/contract";

/** Which registered service a changed path belongs to, and why we think so. */
export interface ServiceImpact {
  service_id: ServiceId | null;
  changed_paths: readonly string[];
  /** The directory that service's own plist points its entrypoint at. */
  source_root: string | null;
  status: "RESOLVED" | "UNRESOLVED_RESOURCE" | "NO_SERVICE_IMPACT";
  evidence: readonly string[];
}

/**
 * A revision identity for a directory of source. Derived, not minted: the same
 * files in the same state always produce the same digest, so "did the running
 * process load THIS revision" is answerable without the process reporting
 * anything about itself.
 */
export interface SourceRevision {
  source_root: string;
  /** sha256 over each file's relative path, size and mtime, sorted. */
  revision_digest: string;
  file_count: number;
  /** The most recent mtime in the tree — the instant the revision became current. */
  newest_mtime: string;
  files: readonly { path: string; size: number; mtime: string }[];
}

export type GateStatus = "PASSED" | "FAILED" | "UNRESOLVED";

/**
 * How much a passing gate is worth. This is the whole answer to "reload after
 * commit only, or add an entry point for uncommitted change" — it is both, and
 * the difference is carried here instead of being lost the moment a gate says
 * PASSED.
 *
 * COMMIT_VERIFIED      the impacted source is committed and ../post-commit-verification/
 *                      has a real VERIFIED record for that commit. Strong enough
 *                      for an unattended, automatic reload.
 * WORKING_TREE_VERIFIED the impacted source is uncommitted and passed the same
 *                      required checks via ../working-tree-verification/. Strong
 *                      enough for an owner to reload NOW, never for automation:
 *                      an uncommitted tree can change between the check and the act.
 * NONE                 no authority was established.
 */
export type GateAuthority = "COMMIT_VERIFIED" | "WORKING_TREE_VERIFIED" | "NONE";

/** Who asked. AUTOMATIC requires COMMIT_VERIFIED; OWNER accepts either. */
export type ReloadTrigger = "OWNER" | "AUTOMATIC";

export interface ReloadGate {
  status: GateStatus;
  authority: GateAuthority;
  /** The identity of what was verified: a commit sha, or a working-tree digest. Never both, never invented. */
  verified_revision: string | null;
  checks: readonly {
    name: string;
    status: GateStatus;
    detail: string;
    /** The real command that produced this, when one was run. */
    command: string | null;
  }[];
  /** Named honestly when a check could not be performed rather than silently skipped. */
  unresolved_reasons: readonly string[];
}

export interface RevisionProof {
  /** launchd's PID before and after, taken from runtime-control's own evidence. */
  pid_before: number | null;
  pid_after: number | null;
  pid_changed: boolean;
  /** Process start time as reported by `ps`, not inferred from the restart call. */
  process_started_at: string | null;
  /** True only when the process started strictly after the newest source mtime. */
  loaded_current_revision: boolean;
  revision_digest: string;
  evidence: readonly string[];
}

export type ReloadDecision =
  | "RELOADED"
  | "BLOCKED_BY_GATE"
  /** The gate passed, but only with WORKING_TREE_VERIFIED authority and the request was AUTOMATIC. */
  | "BLOCKED_INSUFFICIENT_AUTHORITY"
  | "BLOCKED_UNRESOLVED_IMPACT"
  | "NOT_REQUIRED"
  | "RELOAD_FAILED";

export interface ReloadOutcome {
  decision: ReloadDecision;
  impact: ServiceImpact;
  revision: SourceRevision | null;
  gate: ReloadGate;
  /** Verbatim from runtime-control. Null when no operation was requested. */
  operation: OperationEvidence | null;
  proof: RevisionProof | null;
  health_after: {
    http_status: number | null;
    healthy: boolean;
    /**
     * Always RUNTIME_CONTROL_EVIDENCE. Kept as a named field rather than
     * dropped, because it states WHOSE observation this is: there is exactly
     * one readiness authority on this machine, and it is not this capability.
     */
    source: "RUNTIME_CONTROL_EVIDENCE";
    /** runtime-control's own observed readiness wait, not a second measurement. */
    waited_ms: number;
  } | null;
  reason: string;
  observed_at: string;
}
