/**
 * หน้าที่: output sanitization + result-status mapping — ported from the
 * old repo's real, proven `app/api/admin/ide/_lib/executionRuntime.ts`
 * (see `../../reports/EXECUTION_MIGRATION_PLAN.md`). Turns raw
 * stdout/stderr bytes into ANSI-stripped, secret-redacted text, and maps
 * a process's real exit code/signal/timeout/cancellation state into one
 * `ExecutionStatus`. Kept separate from `./executor.ts` (which owns
 * process lifecycle/spawn/timers) so "how a result is interpreted" can be
 * tested without spawning anything.
 *
 * Input: raw chunk text, environment entries (for secret redaction), and
 * the terminal signals `./executor.ts` observed (exit code, signal,
 * timed-out flag, cancelled flag, truncated flag).
 * Output: `sanitizeChunk`, `mapTerminalStatus`, `diffWorkspaceSnapshots`.
 * Dependency ที่อนุญาต: ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never let `sanitizeChunk` skip redaction for performance
 * — every chunk, however small, is redacted before it is ever stored in
 * an `ExecutionEvent` or counted toward `maxOutputBytes`. Never expand
 * `STATIC_REDACTION_PATTERNS` to require a network call or async lookup —
 * this must stay synchronous so output streaming is never blocked.
 *
 * NOT_YET_BUILT: no caller outside ./executor.ts and ./tests/ yet.
 */

import { allEnvEntries } from "./host-runtime";
import type { ExecutionStatus } from "./types";

const STATIC_REDACTION_PATTERNS: RegExp[] = [
  /Authorization:\s*Bearer\s+\S+/gi,
  /sk-[A-Za-z0-9_-]{10,}/g,
  /(api[_-]?key)\s*[:=]\s*['"]?[\w-]+/gi,
  /\btoken\s*=\s*\S+/gi,
  /\bsecret\s*=\s*\S+/gi,
  /\bpassword\s*=\s*\S+/gi,
];
const SECRET_ENV_NAME_PATTERN = /(_KEY|_SECRET|_TOKEN|_PASSWORD|DATABASE_URL)$/i;

function knownSecretEnvValues(): string[] {
  const values: string[] = [];
  for (const [name, value] of allEnvEntries()) {
    if (value.length >= 6 && SECRET_ENV_NAME_PATTERN.test(name)) values.push(value);
  }
  return values;
}

function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of STATIC_REDACTION_PATTERNS) out = out.replace(pattern, "[REDACTED]");
  for (const secretValue of knownSecretEnvValues()) {
    if (secretValue.length < 6) continue;
    out = out.split(secretValue).join("[REDACTED]");
  }
  return out;
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1B\[[0-9;?]*[a-zA-Z]|\x1B\][^\x07]*(\x07|\x1B\\)|\x1B[=>]/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function sanitizeChunk(text: string): string {
  return redactSecrets(stripAnsi(text));
}

export interface TerminalSignal {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  workspacePolicyViolation: boolean;
  processStartFailed: boolean;
}

/**
 * Ported exactly from `executionRuntime.ts`'s `child.on("exit", ...)` +
 * `finalize()` precedence: a failed process START takes priority over
 * everything else (nothing else about the run is meaningful if it never
 * started), then output-limit (the process may have been killed BECAUSE
 * of it), then timeout, then cancellation, then a workspace-policy
 * violation downgrades any non-failed outcome to failed, then the real
 * exit code decides pass/fail.
 */
export function mapTerminalStatus(signal: TerminalSignal): { status: ExecutionStatus; errorCode: string | null } {
  if (signal.processStartFailed) return { status: "failed", errorCode: "PROCESS_START_FAILED" };
  if (signal.truncated) return { status: "output_limited", errorCode: "OUTPUT_LIMIT_REACHED" };
  if (signal.timedOut) return { status: "timed_out", errorCode: "COMMAND_TIMEOUT" };
  if (signal.cancelled) return { status: "cancelled", errorCode: "COMMAND_CANCELLED" };
  if (signal.workspacePolicyViolation) return { status: "failed", errorCode: "WORKSPACE_POLICY_VIOLATION" };
  if (signal.exitCode === 0) return { status: "passed", errorCode: null };
  return { status: "failed", errorCode: "EXECUTION_FAILED" };
}

/** Real, best-effort diff of changed paths between two `git status --porcelain=v2` snapshots — line-set difference, path extracted from each line's last whitespace-separated field (porcelain v2's real format). */
export function diffWorkspaceSnapshots(before: string, after: string): string[] {
  const beforeLines = new Set(before.split("\n").filter(Boolean));
  const afterLines = after.split("\n").filter(Boolean);
  const changed = new Set<string>();
  for (const line of afterLines) {
    if (!beforeLines.has(line)) {
      const fields = line.trim().split(/\s+/);
      const p = fields[fields.length - 1];
      if (p) changed.add(p);
    }
  }
  const afterLineSet = new Set(afterLines);
  for (const line of before.split("\n").filter(Boolean)) {
    if (!afterLineSet.has(line)) {
      const fields = line.trim().split(/\s+/);
      const p = fields[fields.length - 1];
      if (p) changed.add(p);
    }
  }
  return [...changed].sort();
}
