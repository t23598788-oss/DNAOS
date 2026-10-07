/**
 * หน้าที่: the real-time STREAM contract — what a running AI worker
 * (dispatched from one `WorkRequest`) emits while it works, and what
 * 5177's collectors consume to measure it live. This is the wire shape
 * behind Owner's "ExecutionEvent" arrow in the locked loop diagram
 * (2026-08-18): worker edits code -> ExecutionEvent -> TEST/FILE/GIT
 * collectors -> 5177.
 *
 * Deliberately a DISTINCT type from `execution/run/types.ts`'s
 * `ExecutionEvent` (shell-command events: queued/started/stdout/stderr/
 * completed) — that type is real, tested, and already in production use
 * for allow-listed shell commands; this one is for AI WORKER activity
 * specifically (file writes, test runs, git changes an AI agent causes),
 * a different real source with different real fields. Renamed
 * `WorkerExecutionEvent` to avoid ever being confused with the shell one
 * at an import site.
 *
 * Input: none (pure type definitions).
 * Output: `WorkerEventType`, `WorkerExecutionEvent`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never let `text` carry a credential/secret value — a
 * worker's stdout could contain one by accident; sanitizing that is the
 * collector's job once built (NOT_YET_BUILT), but this type must not
 * pretend that risk doesn't exist by omitting the concern from its own
 * docs. Never add a field asserting COST here — cost belongs in
 * `./evaluation-result.ts`, computed after the fact from real evidence,
 * never streamed as a live guess.
 *
 * NOT_YET_BUILT: no real collector emits this shape yet — see
 * `./work-request.ts`'s own NOT_YET_BUILT note. This file exists so the
 * eventual TEST/FILE/GIT collectors and the AI Worker Gateway agree on
 * one shape before either is built, not after.
 *
 * MAPPING_CHECK (2026-08-18): explicitly NOT verified against any real
 * system this round, and cannot be — no File Write / Git Activity / Test
 * Run live collector exists anywhere (confirmed absent in both
 * DNA-LAB-FILE-INTELLIGENCE and the Research & Evaluation Engine). This
 * type stays aspirational until a real collector exists to check it
 * against; do not treat its presence in this folder as evidence such a
 * collector exists.
 */

/** Real, checkable fact: no runtime anywhere emits `WorkerExecutionEvent` yet. Kept as an importable constant (not just a comment) so a future implementer can assert against it rather than re-discover it by grepping. */
export const WORKER_EVENT_RUNTIME_BACKING = "NOT_BUILT" as const;

export type WorkerEventType =
  | "worker.started"
  | "worker.file_read"
  | "worker.file_write"
  | "worker.git_change"
  | "worker.test_started"
  | "worker.test_result"
  | "worker.stdout"
  | "worker.stderr"
  | "worker.completed"
  | "worker.failed";

export interface WorkerExecutionEvent {
  work_id: string;

  /** Monotonic per work_id — same discipline as execution/run/types.ts's ExecutionEvent.seq, so an out-of-order delivery is detectable, never silently accepted. */
  seq: number;

  type: WorkerEventType;
  ts: string;

  /** Repo-relative path — present for file_read/file_write/git_change events, absent otherwise. */
  path?: string;

  /** stdout/stderr chunk, or a short human-readable note for other event types — never a credential (see this file's header). */
  text?: string;

  /** Present only for worker.test_started/worker.test_result. */
  test_name?: string;
  test_status?: "passed" | "failed";
}
