/**
 * หน้าที่: type contracts for `control/work-session-state/` — the persistent
 * record of WHAT WORK IS IN PROGRESS, owned by DNA OS on disk rather than by
 * whichever AI/agent process happens to be running it. Pure types, no behavior.
 *
 * This does NOT restate work status. `control/work-coordination/`'s `WorkItem`
 * remains the single owner of a task's lifecycle status (QUEUED/LOCKED/RUNNING/
 * COMPLETED/FAILED) and of its `target_files`; every record here REFERENCES a
 * `task_id` that already exists there instead of copying its status field, so
 * there is exactly one place a status can be read from.
 *
 * Input: none (pure type definitions).
 * Output: `WorkSessionCheckpoint`, `WorkStep`, `Blocker`, `DecisionRequired`,
 * `StepVerification`, `ResumeContext`, `ChangeOwnership`.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่ม field ที่ถือ "สถานะของ task" ซ้ำกับ work-coordination —
 *   ถ้าอยากรู้สถานะ ให้ resolve จาก `task_id` ที่นั่น
 * - ห้ามเก็บข้อความจาก AI เป็น evidence — `evidence_refs` ต้องเป็น pointer ไป
 *   ยังไฟล์/บรรทัด/คำสั่งที่รันซ้ำได้จริงเท่านั้น
 * - ห้ามให้ `completed_steps` ถูกเชื่อโดยไม่ตรวจ — ทุก step ที่อ้างว่าเสร็จต้อง
 *   พก `StepVerification` ที่ re-derive ได้ ไม่งั้นมันคือคำกล่าวอ้าง ไม่ใช่หลักฐาน
 */

/** How a step's completion can be re-checked later, WITHOUT trusting anyone's memory of it. */
export type StepVerification =
  /** The named file's sha256 must still equal `sha256`. */
  | { kind: "FILE_DIGEST"; path: string; sha256: string }
  /** The named file must still contain this exact literal text. */
  | { kind: "FILE_CONTAINS"; path: string; literal: string }
  /** The named path must still exist (file or directory). */
  | { kind: "PATH_EXISTS"; path: string }
  /**
   * Nothing on disk can re-derive this step. Recorded honestly so the resume
   * engine reports it as UNVERIFIABLE rather than silently counting it as done.
   */
  | { kind: "NONE"; why: string };

export type StepState = "PENDING" | "COMPLETED";

export interface WorkStep {
  step_id: string;
  /** What the step does, in the words the work item itself used — never an AI paraphrase. */
  title: string;
  state: StepState;
  /** Which phase of the work this step belongs to. */
  phase: string;
  /** step_ids that must be COMPLETED before this one may run. */
  depends_on: readonly string[];
  /** Repo-relative paths this step wrote, as declared by the step itself. */
  affected_paths: readonly string[];
  /** Pointers to real, re-runnable proof (a test path, a log path, a command). */
  evidence_refs: readonly string[];
  /** Only meaningful when `state === "COMPLETED"`. */
  verification: StepVerification | null;
  /** The repository revision the step was completed at. */
  completed_at_revision: string | null;
  completed_at: string | null;
}

export interface Blocker {
  blocker_id: string;
  /** The exact layer that is blocked, e.g. `control/work-session-state`. */
  layer: string;
  /** The exact thing that blocks it. */
  detail: string;
  /** Where the evidence for the blocker is. */
  evidence_ref: string | null;
  /** The exact next action that would clear it. */
  next_action: string;
  state: "OPEN" | "CLEARED";
}

export interface DecisionRequired {
  decision_id: string;
  question: string;
  /** The options, as they really are — never invented alternatives. */
  options: readonly string[];
  /** Who must answer. Only ever `"OWNER"` today: no agent may answer for the Owner. */
  decider: "OWNER";
  state: "OPEN" | "ANSWERED";
  answer: string | null;
}

/**
 * One append-only checkpoint. The CURRENT state of a work session is the LAST
 * checkpoint carrying that `work_id` — deterministic reduce over an append-only
 * journal, never an in-place mutated record, so a crashed writer can never leave
 * a half-updated current state behind.
 */
export interface WorkSessionCheckpoint {
  checkpoint_id: string;
  /** Stable across every worker that ever touches this work. THE resume key. */
  work_id: string;
  /** The Owner instruction this work descends from, when one is known. */
  owner_intent_id: string | null;
  /** The `control/work-coordination/` task this work is executing, when one exists. */
  task_id: string | null;
  /** The worker RUN that wrote this checkpoint. Changes on every replacement worker. */
  session_id: string;
  /** One execution attempt inside a session. */
  execution_id: string | null;
  /** What kind of worker wrote it, e.g. `claude-code`, `codex`, `human`, `daemon`. */
  worker_identity: string;
  repository: string;
  branch: string;
  /** Resource ids this work touches, as resolved by an existing resolver — never minted here. */
  affected_resource_ids: readonly string[];
  /** Repo-relative paths this work touches. */
  affected_paths: readonly string[];
  objective: string;
  current_phase: string;
  steps: readonly WorkStep[];
  blockers: readonly Blocker[];
  decisions_required: readonly DecisionRequired[];
  evidence_refs: readonly string[];
  /** The repository revision when this checkpoint was written. */
  source_revision: string;
  /** The most recent revision at which the completed steps were actually re-verified. */
  last_verified_revision: string | null;
  /** The single next executable step, restated so a replacement worker needs nothing else. */
  next_action: string;
  /** Things a replacement worker must NOT redo — stated as facts, with why. */
  do_not_repeat: readonly string[];
  /**
   * The UI route/view this work was being done through, when the UI is
   * operationally part of the work (a render verification, an Owner board a
   * decision is taken on). `null` when no UI is involved — recorded rather
   * than guessed, so rehydration restores a real route or admits it has none.
   */
  ui_context: UiContext | null;
  /**
   * The last event this work durably observed, per stream. This is what a
   * reconnecting client resumes from, and what tells a restarted process
   * which events it may have missed.
   */
  last_durable_event: readonly StreamPosition[];
  /** Whether everything this work produced has reached its durable home. */
  sync_state: SyncState;
  status: "ACTIVE" | "BLOCKED" | "COMPLETE" | "ABANDONED";
  started_at: string;
  updated_at: string;
}

/**
 * Where a work session was being driven from in a browser. The browser is
 * never the source of truth: this is written by the durable side so a
 * rehydrating browser can be TOLD its route, not asked for it.
 */
export interface UiContext {
  /** Which runtime serves it, as a `control/runtime-control/` service_id when one owns it. */
  service_id: string | null;
  /** Absolute URL the operator was on. */
  url: string;
  /** The route path, kept separately so a port change does not invalidate it. */
  route: string;
  /** What the view was scoped to, e.g. a task_id or resource_id. Never free text the UI made up. */
  scope: string | null;
}

/** One stream and the last event from it this work durably processed. */
export interface StreamPosition {
  /** e.g. `joint-monitor:/events`. */
  stream_id: string;
  /** The event id, as the producer issued it. `null` = nothing processed yet. */
  last_event_id: string | null;
  observed_at: string;
}

/**
 * `SYNCED` — everything produced has reached durable storage.
 * `PENDING_LOCAL` — written locally, not yet pushed to a remote that wants it.
 * `WAITING_FOR_NETWORK` — at least one queued operation needs a network that is not there.
 */
export type SyncState = "SYNCED" | "PENDING_LOCAL" | "WAITING_FOR_NETWORK";

/** Result of re-checking one COMPLETED step against the repository as it is NOW. */
export interface StepRevalidation {
  step_id: string;
  verdict: "STILL_VALID" | "STALE" | "UNVERIFIABLE";
  detail: string;
}

/**
 * Everything a brand-new worker gets handed. Deliberately self-sufficient: a
 * worker that reads this must not need conversation history, and must not need
 * to scan the repository to rediscover what has already been done.
 */
export interface ResumeContext {
  work_id: string;
  objective: string;
  current_phase: string;
  /** Steps proven still valid — a replacement worker MUST NOT redo these. */
  completed_steps: readonly WorkStep[];
  /** Steps that were completed but whose proof no longer holds at the current revision. */
  stale_steps: readonly StepRevalidation[];
  pending_steps: readonly WorkStep[];
  affected_resource_ids: readonly string[];
  affected_paths: readonly string[];
  source_refs: readonly string[];
  evidence_refs: readonly string[];
  open_blockers: readonly Blocker[];
  open_decisions: readonly DecisionRequired[];
  constraints: readonly string[];
  do_not_repeat: readonly string[];
  /** The revision the checkpoint was written at. */
  checkpoint_revision: string;
  /** The revision the repository is at right now. */
  current_revision: string;
  revision_drifted: boolean;
  /** The one thing to do next, or the blocker/decision that stops everything. */
  next_action: string;
  resume_status: "RESUMABLE" | "BLOCKED" | "DECISION_REQUIRED" | "COMPLETE" | "NO_SUCH_WORK";
}

/** Who owns a real change to a real path. `UNKNOWN` is a legitimate, common answer. */
export interface ChangeOwnership {
  path: string;
  work_id: string | "UNKNOWN";
  task_id: string | null;
  session_id: string | null;
  execution_id: string | null;
  /**
   * How ownership was established:
   * - `WRITE_LOCK_HELD` — a live lock in `control/work-coordination/`'s lock dir contains this path.
   * - `CHECKPOINT_SCOPE` — exactly one ACTIVE checkpoint declares this path.
   * - `UNOWNED` — no active work declares it.
   * - `AMBIGUOUS` — more than one active work declares it; guessing is refused.
   */
  provenance: "WRITE_LOCK_HELD" | "CHECKPOINT_SCOPE" | "UNOWNED" | "AMBIGUOUS";
  detail: string;
}
