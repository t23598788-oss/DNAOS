/**
 * SPEAKING PERMANENTLY DISABLED (2026-08-21, Owner instruction — "SILENT
 * BY DEFAULT อย่างถาวร... ห้ามผูก task completed... เข้ากับ TTS trigger
 * อีก"). This file's whole original purpose was announcing a dispatcher
 * Task's terminal outcome (COMPLETED/FAILED/BLOCKED) out loud — the
 * Owner has now permanently banned binding task completion to speech, so
 * `runVoiceAnnouncementSweep` below no longer calls `runUiWorkOrder({
 * ui_action: "speak", ... })` regardless of `isVoiceBridgeEnabled()`'s
 * value — flipping that flag back to `true` does nothing now; it is kept
 * only so old evidence/state files stay readable, never as a real
 * re-enable path. The ONLY path allowed to speak is
 * `connections/voice-command/`'s existing, on-demand,
 * explicit-command-triggered dispatcher.
 *
 * หน้าที่ (เดิม, ก่อนถูกปิดถาวร): the Claude Voice Bridge — announces a
 * dispatcher Task's real terminal outcome (COMPLETED/FAILED/BLOCKED) out
 * loud, via the SAME `speak` Work Order `connections/os-ui/` already
 * implements (Owner Work Order, 2026-08-20 "Screen Reading + Speech"
 * round) — this file never calls `/usr/bin/say` itself, it only ever
 * goes through `runUiWorkOrder({ ui_action: "speak", ... })`, so every
 * announcement still passes the SAME admission/credential-surface/length
 * checks and lands in the SAME `work-order-audit.jsonl` evidence trail.
 * TTS-only, scoped by the Owner this round — no microphone, no
 * speech-to-text, no always-listening anything.
 *
 * Approval gate: OFF by default. `setVoiceBridgeEnabled(true, ...)` is
 * the one Owner-issued action that turns it on — that single act IS the
 * risk confirmation for every announcement that follows (an automated
 * feature cannot ask "risk_confirmed?" per utterance the way a one-shot
 * command can; gating at enable-time, once, real and recorded, is the
 * honest equivalent). Persisted in
 * ./data/voice-bridge-enabled.json with who/when.
 *
 * Durable state + idempotent restart: ./data/voice-bridge-state.json
 * records every task_id already announced. `runVoiceAnnouncementSweep`
 * is safe to call after a crash or restart — it re-derives "what's new"
 * from the SAME durable task log `./memory-store.ts` already keeps
 * (`loadAllTasks`), the same log `recoverInterruptedTasks` already reads
 * — no second queue, no second task store.
 *
 * Input: none beyond the durable task log + its own two small JSON state
 * files.
 * Output: `runVoiceAnnouncementSweep`, `setVoiceBridgeEnabled`,
 * `isVoiceBridgeEnabled`.
 * Dependency ที่อนุญาต: ./memory-store.ts, ./host-runtime.ts,
 * ../../connections/os-ui/adapter-contract.ts's `runUiWorkOrder`
 * (its one documented public entry point for `speak`).
 * สิ่งที่ห้ามแตะ: never call `/usr/bin/say` or any OS audio API directly
 * from this file — always through `runUiWorkOrder`, so admission/audit
 * never has a bypass path. Never default `enabled` to true. Never add a
 * microphone/audio-input code path here.
 */
import { loadAllTasks, loadEvidenceForTask } from "./memory-store";
import { readFileUtf8, writeFileUtf8, fileExists, ensureDir, joinPath, repoRootDirname, nowIso } from "./host-runtime";
import type { Task, Status } from "./types";
import { isCredentialSurface } from "../../connections/os-ui/work-order";

// 2026-08-20 (Owner clarification, same round): unattended auto-announcement
// is scoped to LOW/MEDIUM-risk task results only, through the SAME
// policy+validator+evidence path every other Work Order uses. HIGH-risk
// results — a real file write via ai-write-control-adapter (production
// business code) or anything whose intent text names a credential surface —
// are never auto-spoken. They stay exactly as the real dispatcher already
// left them (COMPLETED/FAILED/BLOCKED/WAITING_OWNER_DECISION) and are simply
// left OUT of the announced set — the Owner reviews them directly in the
// Owner Console, never narrated aloud.
const HIGH_RISK_ADAPTER_IDS: readonly string[] = ["ai-write-control-adapter"];

function taskRisk(task: Task): "LOW_MEDIUM" | "HIGH" {
  if (isCredentialSurface(task.intent_text, "")) return "HIGH";
  const evidence = loadEvidenceForTask(task.task_id);
  const usedHighRiskAdapter = evidence.some((e) => e.kind === "execution_output" && HIGH_RISK_ADAPTER_IDS.includes(e.source));
  if (usedHighRiskAdapter) return "HIGH";
  if (task.work_order) return "HIGH"; // any Work Order that reaches a real file write is production business code by definition here
  return "LOW_MEDIUM";
}

const DATA_DIR_RELATIVE = "control/agent-gateway/data";
const TERMINAL_STATUSES: readonly Status[] = ["COMPLETED", "FAILED", "BLOCKED"];

interface EnabledState {
  enabled: boolean;
  approved_by: string | null;
  approved_at: string | null;
}

interface AnnounceState {
  announced_task_ids: string[];
}

function dataDir(): string {
  return joinPath(repoRootDirname(), DATA_DIR_RELATIVE);
}
function enabledFile(): string {
  return joinPath(dataDir(), "voice-bridge-enabled.json");
}
function stateFile(): string {
  return joinPath(dataDir(), "voice-bridge-state.json");
}

function readJson<T>(path: string, fallback: T): T {
  if (!fileExists(path)) return fallback;
  try {
    return JSON.parse(readFileUtf8(path)) as T;
  } catch {
    return fallback;
  }
}
function writeJson(path: string, value: unknown): void {
  ensureDir(dataDir());
  writeFileUtf8(path, JSON.stringify(value, null, 2));
}

export function isVoiceBridgeEnabled(): boolean {
  return readJson<EnabledState>(enabledFile(), { enabled: false, approved_by: null, approved_at: null }).enabled;
}

/**
 * The ONE real approval-gate action. `approvedBy` should be a real,
 * already-authenticated identity_id (the same one owner-command already
 * resolves per request) — never a hardcoded literal.
 */
export function setVoiceBridgeEnabled(enabled: boolean, approvedBy: string): EnabledState {
  const state: EnabledState = { enabled, approved_by: enabled ? approvedBy : null, approved_at: enabled ? nowIso() : null };
  writeJson(enabledFile(), state);
  return state;
}

function latestTasks(): Task[] {
  const latest = new Map<string, Task>();
  for (const task of loadAllTasks()) latest.set(task.task_id, task);
  return [...latest.values()];
}

function summaryFor(task: Task): string {
  const shortId = task.task_id.replace(/^task[_-]/, "").slice(0, 8);
  const status = task.status.toLowerCase();
  // Deterministic, built ONLY from real persisted task fields — never
  // AI-narrated on the spot, matching ../owner-command/'s explain()
  // convention repo-wide.
  return `Task ${shortId} ${status}.`.slice(0, 500);
}

export interface VoiceSweepResult {
  enabled: boolean;
  announced: string[];
  skipped_already_announced: number;
  /** HIGH-risk terminal tasks that were deliberately never spoken — production business-code writes and anything naming a credential surface. Owner must review these directly in the Owner Console. */
  skipped_high_risk: string[];
  errors: { task_id: string; error: string }[];
}

/**
 * Real, idempotent, restart-safe sweep: finds terminal tasks not yet in
 * the durable announced-set, speaks each one via the real `speak` Work
 * Order, and persists the announced-set AFTER each successful speak
 * (not batched at the end) — so a crash mid-sweep never re-announces
 * one that already spoke, and never permanently loses one that didn't.
 */
export async function runVoiceAnnouncementSweep(): Promise<VoiceSweepResult> {
  if (!isVoiceBridgeEnabled()) {
    return { enabled: false, announced: [], skipped_already_announced: 0, skipped_high_risk: [], errors: [] };
  }

  const state = readJson<AnnounceState>(stateFile(), { announced_task_ids: [] });
  const announcedSet = new Set(state.announced_task_ids);
  const terminalTasks = latestTasks().filter((t) => TERMINAL_STATUSES.includes(t.status));

  const announced: string[] = [];
  const skippedHighRisk: string[] = [];
  const errors: { task_id: string; error: string }[] = [];
  let skipped = 0;

  for (const task of terminalTasks) {
    if (announcedSet.has(task.task_id)) {
      skipped += 1;
      continue;
    }
    if (taskRisk(task) === "HIGH") {
      // Deliberately never spoken and never added to announcedSet — the
      // Owner must see it directly, not just once but every sweep, until
      // reviewed. Recorded as evidence via the returned result, not silently dropped.
      skippedHighRisk.push(task.task_id);
      continue;
    }
    const text = summaryFor(task);
    // Real `runUiWorkOrder({ ui_action: "speak", ... })` call permanently
    // removed here (see file header) — this synthetic, always-ok outcome
    // preserves the exact same idempotent-announced-set bookkeeping and
    // dedup guarantee this function already provided, without ever
    // producing real audio. `void text` keeps summaryFor's real,
    // deterministic-from-persisted-fields construction exercised (so a
    // future re-enable point has a real value to resume from), without
    // sending it anywhere.
    void text;
    const outcome = { ok: true, summary: "voice announcement permanently disabled — task tracked, not spoken" };
    if (outcome.ok) {
      announcedSet.add(task.task_id);
      state.announced_task_ids = [...announcedSet];
      writeJson(stateFile(), state); // persisted immediately, per-task — real idempotent-restart guarantee
      announced.push(task.task_id);
    } else {
      errors.push({ task_id: task.task_id, error: outcome.summary });
    }
  }

  return { enabled: true, announced, skipped_already_announced: skipped, skipped_high_risk: skippedHighRisk, errors };
}
