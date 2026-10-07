/**
 * หน้าที่: periodic screen-summary (baseline + diff) built ON TOP of the
 * existing os-ui capability — never a second automation surface. Every
 * real screen access goes through `runUiWorkOrder({ui_action:"read_screen",
 * risk_confirmed:true, ...})` in ./adapter-contract.ts, so the SAME
 * admission/credential-surface/redaction rules already proven by
 * ./tests/work-order.test.ts apply here unchanged — this file adds
 * diffing + persistence + an unknown-dialog approval gate, nothing more.
 *
 * Input: a sandbox/allowlisted app key (see ./work-order.ts's
 * ALLOWED_APP_KEYS) + an idempotency key.
 * Output: SnapshotDiff (added/removed/changed/blocked), persisted to
 * connections/os-ui/data/screen-summary.jsonl (same flat-file, append-only
 * convention as control/agent-gateway/memory-store.ts).
 * Dependency ที่อนุญาต: ./adapter-contract.ts (runUiWorkOrder — the one
 * real entry point), ./work-order.ts (types only).
 * สิ่งที่ห้ามแตะ: never read connections/os-ui/data/screen-reads/*.json
 * and re-expose a field readScreen already redacted; never mark an
 * unknown dialog VERIFIED without an explicit approval; never bypass
 * runUiWorkOrder's own credential-surface/risk gate.
 */
import { runUiWorkOrder } from "./adapter-contract";
import type { ScreenReadResult } from "./work-order";

declare const require: (id: string) => unknown;

export interface ScreenSnapshot {
  taken_at: string;
  target: string;
  app: string | null;
  title: string | null;
  state: ScreenReadResult["state"];
  controls: { role: string; label: string; redacted: boolean }[];
  confidence: number;
}

export type SummaryStatus = "VERIFIED" | "FAILED" | "BLOCKED";

export interface SnapshotDiff {
  added: { role: string; label: string }[];
  removed: { role: string; label: string }[];
  changed: { role: string; before: string; after: string }[];
  /** Non-null exactly when an unknown dialog/sheet/alert control was observed and this snapshot is BLOCKED pending Owner approval. */
  blocked: { reason: string; control: { role: string; label: string } } | null;
}

export interface SummaryResult {
  task_id: string;
  target: string;
  status: SummaryStatus;
  snapshot: ScreenSnapshot | null;
  diff: SnapshotDiff | null;
  evidence_ref: string;
  next_action: string | null;
  idempotent_replay: boolean;
}

/** Known, expected dialog/sheet/alert roles+labels — anything ELSE with a dialog-shaped role is "unknown" and BLOCKs, matching the Owner's "unknown dialog -> BLOCKED, approval request" instruction. Same allowlist discipline as ./policy-free adapter-contract.ts's app allowlists. */
const KNOWN_DIALOG_LABELS = new Set(["Save", "Cancel", "Don't Save", "Open", "OK"]);
const DIALOG_ROLE_PATTERN = /dialog|sheet|alert/i;

function dataDir(): string {
  const path = require("node:path") as { join(...p: string[]): string };
  return path.join(process.cwd(), "connections/os-ui/data");
}
function summaryFile(): string {
  const path = require("node:path") as { join(...p: string[]): string };
  return path.join(dataDir(), "screen-summary.jsonl");
}

function readJsonl<T>(filePath: string): T[] {
  const fs = require("node:fs") as { existsSync(p: string): boolean; readFileSync(p: string, e: string): string };
  if (!fs.existsSync(filePath)) return [];
  return (fs.readFileSync(filePath, "utf-8") as string)
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

function appendJsonl(filePath: string, record: unknown): void {
  const fs = require("node:fs") as { mkdirSync(p: string, o: { recursive: boolean }): void; appendFileSync(p: string, c: string, e: string): void };
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf-8");
}

/** Recovery: the LAST persisted, terminal snapshot for a target — read fresh from disk every call, same "durable file, no in-memory-only state" discipline as control/agent-gateway/memory-store.ts. Survives a worker kill/restart because it never lived only in memory. */
export function loadLastSnapshot(target: string): ScreenSnapshot | null {
  const rows = readJsonl<{ target: string; snapshot: ScreenSnapshot | null }>(summaryFile());
  const matches = rows.filter((r) => r.target === target && r.snapshot !== null);
  return matches.length > 0 ? matches[matches.length - 1].snapshot : null;
}

function findUnknownDialog(controls: { role: string; label: string; redacted: boolean }[]): { role: string; label: string } | null {
  const dialogControl = controls.find((c) => DIALOG_ROLE_PATTERN.test(c.role));
  if (!dialogControl) return null;
  if (KNOWN_DIALOG_LABELS.has(dialogControl.label)) return null;
  return { role: dialogControl.role, label: dialogControl.label };
}

/** Exported for direct unit testing (pure function, no OS call) — see ./tests/screen-summary.test.ts. */
export function diffSnapshots(before: ScreenSnapshot | null, after: ScreenSnapshot): SnapshotDiff {
  const beforeControls = before?.controls ?? [];
  const afterControls = after.controls;
  const key = (c: { role: string; label: string }) => `${c.role}::${c.label}`;
  const beforeMap = new Map(beforeControls.map((c) => [key(c), c]));
  const afterMap = new Map(afterControls.map((c) => [key(c), c]));

  const added = afterControls.filter((c) => !beforeMap.has(key(c))).map((c) => ({ role: c.role, label: c.label }));
  const removed = beforeControls.filter((c) => !afterMap.has(key(c))).map((c) => ({ role: c.role, label: c.label }));
  // "changed" matches by role only (not role+label) so a field whose label text itself flips (e.g. real text -> "[REDACTED]") is still recognized as the same control that changed, rather than reported as one removed + one added. Label text itself is never diffed value-by-value — only the redaction state is.
  const changed: SnapshotDiff["changed"] = [];
  const beforeByRole = new Map<string, { role: string; label: string; redacted: boolean }>();
  for (const c of beforeControls) if (!beforeByRole.has(c.role)) beforeByRole.set(c.role, c);
  const seenRoles = new Set<string>();
  for (const afterControl of afterControls) {
    if (seenRoles.has(afterControl.role)) continue;
    seenRoles.add(afterControl.role);
    const beforeControl = beforeByRole.get(afterControl.role);
    if (beforeControl && beforeControl.redacted !== afterControl.redacted) {
      changed.push({ role: afterControl.role, before: beforeControl.redacted ? "[REDACTED]" : "visible", after: afterControl.redacted ? "[REDACTED]" : "visible" });
    }
  }

  const unknownDialog = findUnknownDialog(afterControls);
  return { added, removed, changed, blocked: unknownDialog ? { reason: `unknown dialog/sheet/alert control observed: role="${unknownDialog.role}" label="${unknownDialog.label}"`, control: unknownDialog } : null };
}

const idempotencyCache = new Map<string, SummaryResult>();

/**
 * Capture one read_screen snapshot (through the existing, admission-gated
 * runUiWorkOrder — never a bypass), diff it against the last persisted
 * snapshot for this target, and persist the result. Speaking the summary
 * (if requested) is a SEPARATE `runUiWorkOrder({ui_action:"speak", ...})`
 * call the caller makes with the returned `diff` text — this function
 * never auto-speaks, so a caller can choose to summarize for Owner Console
 * only, without an audible announcement.
 */
export async function captureScreenSummary(taskId: string, target: string, timeoutMs: number, idempotencyKey?: string): Promise<SummaryResult> {
  if (idempotencyKey) {
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached) return { ...cached, idempotent_replay: true, next_action: `${cached.next_action ?? ""} (idempotent replay — not re-captured)`.trim() };
  }

  const outcome = await runUiWorkOrder({ ui_action: "read_screen", target, scope: "screen-summary", timeout_ms: timeoutMs, dry_run: false, risk_confirmed: true, idempotency_key: idempotencyKey ? `screen-summary:${idempotencyKey}` : undefined });
  const evidenceRef = `evidence://os-ui/screen-summary/${taskId}`;

  if (outcome.status === "OWNER_ACTION_REQUIRED" || outcome.status === "BLOCKED") {
    const result: SummaryResult = { task_id: taskId, target, status: "BLOCKED", snapshot: null, diff: null, evidence_ref: evidenceRef, next_action: outcome.next_action, idempotent_replay: false };
    appendJsonl(summaryFile(), { recorded_at: new Date().toISOString(), ...result });
    if (idempotencyKey) idempotencyCache.set(idempotencyKey, result);
    return result;
  }
  if (!outcome.ok) {
    const result: SummaryResult = { task_id: taskId, target, status: "FAILED", snapshot: null, diff: null, evidence_ref: evidenceRef, next_action: outcome.next_action, idempotent_replay: false };
    appendJsonl(summaryFile(), { recorded_at: new Date().toISOString(), ...result });
    if (idempotencyKey) idempotencyCache.set(idempotencyKey, result);
    return result;
  }

  // outcome.ok === true: read the ALREADY-REDACTED artifact runUiWorkOrder wrote — never re-read the live screen ourselves.
  const artifact = outcome.artifacts.find((a) => a.kind === "screen_read_result_redacted");
  const fs = require("node:fs") as { readFileSync(p: string, e: string): string };
  const read = artifact ? (JSON.parse(fs.readFileSync(artifact.ref, "utf-8") as string) as ScreenReadResult) : null;
  if (!read) {
    const result: SummaryResult = { task_id: taskId, target, status: "FAILED", snapshot: null, diff: null, evidence_ref: evidenceRef, next_action: "read_screen reported success but produced no artifact — treat as FAILED, never fabricate a snapshot", idempotent_replay: false };
    appendJsonl(summaryFile(), { recorded_at: new Date().toISOString(), ...result });
    return result;
  }

  const snapshot: ScreenSnapshot = { taken_at: read.evidence_timestamp, target, app: read.app, title: read.title, state: read.state, controls: read.controls, confidence: read.confidence };
  const previous = loadLastSnapshot(target);
  const diff = diffSnapshots(previous, snapshot);

  const status: SummaryStatus = diff.blocked ? "BLOCKED" : "VERIFIED";
  const result: SummaryResult = {
    task_id: taskId,
    target,
    status,
    snapshot,
    diff,
    evidence_ref: evidenceRef,
    next_action: diff.blocked ? "unknown dialog observed — requires explicit Owner approval before this target is summarized again" : null,
    idempotent_replay: false,
  };
  appendJsonl(summaryFile(), { recorded_at: new Date().toISOString(), ...result });
  if (idempotencyKey) idempotencyCache.set(idempotencyKey, result);
  return result;
}

/** Recovery sweep: every persisted summary result is already terminal (VERIFIED/FAILED/BLOCKED) — matches control/agent-gateway/supervisor.ts's own recovery-only discipline, never a re-dispatch. */
export function recoverScreenSummaries(target?: string): { task_id: string; target: string; status: SummaryStatus }[] {
  const rows = readJsonl<{ task_id: string; target: string; status: SummaryStatus }>(summaryFile());
  return target ? rows.filter((r) => r.target === target) : rows;
}
