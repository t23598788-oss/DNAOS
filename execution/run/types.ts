/**
 * หน้าที่: the type contracts for `execution/run/` — ported from the old
 * repo's real, proven `app/api/admin/ide/_lib/executionRegistry.ts` +
 * `executionRuntime.ts` (see
 * `../../reports/EXECUTION_MIGRATION_PLAN.md`), adapted to this repo's
 * scope/permission model instead of the old repo's `ownerId`/session
 * model. Field names for identity/account/workspace/capability/action/
 * cwd_scope/requested_args/correlation_id deliberately match
 * `../../permissions/execution-policy/types.ts`'s
 * `ExecutionPermissionRequest`, so a request built for the permission
 * check and a request built for execution describe the same real event.
 *
 * Input: none (pure type definitions).
 * Output: `CommandDescriptor`, `DynamicArgSpec`, `ExecutionRequest`,
 * `ExecutionResult`, `ExecutionStatus`, `ExecutionEvent`,
 * `ExecutionErrorCode`, `ExecutionError`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a raw shell-string field anywhere here —
 * `requested_args` is a structured, named-value record, matching the old
 * repo's `validateDynamicArgs` model (every current command has an empty
 * schema; the shape exists so a future command can add one without ever
 * accepting a raw string). Never add a `shell` or `executablePath` field
 * to `ExecutionRequest` — the caller selects a `command_id` only; the
 * executable and argv are always resolved from `./registry.ts`.
 *
 * NOT_YET_BUILT: nothing calls `execute()` from `./contract.ts` yet — see
 * that file's header for the runtime-wiring boundary.
 */

export type ExecutionErrorCode =
  | "UNKNOWN_COMMAND"
  | "INVALID_ARGUMENT"
  | "COMMAND_DENIED"
  | "PERMISSION_DENIED"
  | "OWNER_CONFIRMATION_REQUIRED"
  | "CONCURRENCY_LIMIT"
  | "COMMAND_BUSY"
  | "PROCESS_START_FAILED"
  | "COMMAND_TIMEOUT"
  | "COMMAND_CANCELLED"
  | "OUTPUT_LIMIT_REACHED"
  | "EXECUTION_FAILED"
  | "WORKSPACE_POLICY_VIOLATION"
  | "EXECUTION_NOT_FOUND"
  | "INTERNAL_ERROR";

export class ExecutionError extends Error {
  code: ExecutionErrorCode;
  constructor(code: ExecutionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ExecutionError";
  }
}

export interface DynamicArgSpec {
  type: "string" | "number" | "boolean";
  required?: boolean;
  enum?: readonly string[];
  maxLength?: number;
}

/**
 * The allowlisted-command descriptor — ported one-for-one from the old
 * repo's `CommandDefinition` (see `./registry.ts`'s header for exactly
 * which fields were dropped and why). A `command_id` not present in
 * `./registry.ts`'s `COMMAND_REGISTRY` can never reach `spawn()` — this
 * IS the allowlist, not a hint to one.
 */
export interface CommandDescriptor {
  command_id: string;
  label: string;
  description: string;
  /** Real executable — bare name (resolved via PATH) or an absolute path. Never derived from caller input. */
  executable: string;
  /** Fixed argv, always a literal array — never built by string concatenation. */
  fixedArgs: readonly string[];
  dynamicArgumentSchema: Readonly<Record<string, DynamicArgSpec>>;
  /** Order in which validated dynamic arg VALUES (never raw caller text) are appended as separate literal argv elements after fixedArgs. */
  dynamicArgOrder: readonly string[];
  workingDirectoryPolicy: "workspace_root";
  timeoutMs: number;
  maxOutputBytes: number;
  allowConcurrent: boolean;
  /** When set, only one execution holding this key may be active at once. */
  exclusiveLockKey: string | null;
  /** Matched against the caller's `ExecutionRequest.capability` / `.action` — also the fields a `CommandPolicyDescriptor` (see `../../permissions/execution-policy/types.ts`) is projected from before the permission check. */
  requiredCapability: string;
  requiredAction: string;
  mode: "READ_ONLY" | "WORKSPACE_WRITE";
  changesWorkspace: boolean;
  requiresOwnerConfirmation: boolean;
  /** Where the "this command does/doesn't write" claim was verified — a real file/script/doc reference, never "assumed". */
  evidenceSource: string;
}

export interface ExecutionRequest {
  correlation_id: string;
  command_id: string;
  identity_id: string;
  account_id: string;
  workspace_id: string;
  capability: string;
  action: string;
  cwd_scope: string;
  /** Validated dynamic argument VALUES only, keyed by the command descriptor's own schema — never a raw shell string, never positional/untyped. Empty for every command registered today. */
  requested_args: Readonly<Record<string, string | number | boolean>>;
  /** The `ExecutionPermissionDecision.decision_id` this request claims to be authorized by — `./executor.ts` re-verifies the full decision object, not just this id, before ever spawning. */
  permission_decision_id: string;
  owner_confirmation?: boolean;
  /** Optional override, must be <= the descriptor's own `timeoutMs`; undefined uses the descriptor's default. Never allowed to widen a descriptor's timeout. */
  timeout_ms?: number;
}

export type ExecutionStatus = "queued" | "running" | "passed" | "failed" | "cancelled" | "timed_out" | "output_limited" | "permission_denied";

export type ExecutionEventType =
  | "execution.queued"
  | "execution.started"
  | "execution.stdout"
  | "execution.stderr"
  | "execution.completed"
  | "execution.failed"
  | "execution.cancelled"
  | "execution.timeout"
  | "execution.output_limited";

export interface ExecutionEvent {
  seq: number;
  type: ExecutionEventType;
  ts: string;
  stream?: "stdout" | "stderr";
  text?: string;
}

export interface ExecutionResult {
  execution_id: string;
  correlation_id: string;
  command_id: string;
  identity_id: string;
  account_id: string;
  workspace_id: string;
  permission_decision_id: string;
  status: ExecutionStatus;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  signal: string | null;
  outputBytes: number;
  truncated: boolean;
  errorCode: ExecutionErrorCode | null;
  /** Real, server-decided cwd the process actually ran in — caller never supplies this directly, only a `cwd_scope` the descriptor validates against. */
  workingDirectory: string;
  mode: "READ_ONLY" | "WORKSPACE_WRITE";
  changesWorkspace: boolean;
  ownerConfirmation: boolean;
  /** Real, normalized argv actually passed to spawn (fixedArgs + validated dynamic args), sanitized the same way stdout/stderr are — never the raw request body. */
  resolvedArgv: readonly string[];
  stdoutHash: string | null;
  stderrHash: string | null;
  /** Workspace Integrity — real `git status --porcelain=v2` diff between before/after, captured for every execution (not only WORKSPACE_WRITE ones). `undefined` if no snapshot could be captured (never guessed). */
  workspaceChangedPaths: readonly string[] | undefined;
  /** True only when a READ_ONLY command's before/after snapshot shows the workspace changed anyway — never auto-fixed or reverted. */
  workspacePolicyViolation: boolean;
}
