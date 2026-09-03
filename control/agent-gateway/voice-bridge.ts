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
import { statSync } from "node:fs";
import { loadAllTasks, loadEvidenceForTask, tasksFilePath } from "./memory-store";
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

/**
 * ปิดถาวรตามคำตัดสินของ Owner (2026-08-31) — ไฟล์สถานะเดิมปลุกมันคืนไม่ได้
 *
 * ── ทำไมไม่ใช่แค่เขียน false ลงไฟล์ ──
 * ไฟล์ `voice-bridge-enabled.json` ที่ค้างเป็น `enabled=true` (เขียนโดยเทสต์
 * ที่ถูกขัดจังหวะ) คือสิ่งที่ทำให้ Core ค้าง 100% CPU นาน 3 ชั่วโมง 47 นาที
 * ถ้าปิดด้วยการเขียนไฟล์อย่างเดียว ไฟล์ที่ค้างจากการรันครั้งอื่นก็ปลุกมันคืนได้อีก
 * ประตูนี้จึงตอบ `false` เสมอโดยไม่อ่านไฟล์ — สถานะที่บันทึกไว้กลายเป็นประวัติ
 * ที่อ่านได้ ไม่ใช่สวิตช์ที่สั่งงานได้
 *
 * `setVoiceBridgeEnabled` ยังเขียนบันทึกเหมือนเดิม เพื่อให้เส้นทางคำสั่งของ
 * `control/command-router/` ไม่พัง และหลักฐานของเหตุการณ์ไม่ถูกลบ — แต่สิ่งที่
 * มันเขียนไม่มีผลต่อการทำงานอีกต่อไป
 */
export function isVoiceBridgeEnabled(): boolean {
  return false;
}

/** สถานะที่บันทึกไว้ — เป็นประวัติเท่านั้น ไม่ใช่สวิตช์ควบคุมการทำงาน */
export function readPersistedVoiceBridgeState(): EnabledState {
  return readJson<EnabledState>(enabledFile(), { enabled: false, approved_by: null, approved_at: null });
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

/**
 * ผลของการอ่านคลังงานครั้งล่าสุด ผูกกับตัวตนของไฟล์ ณ ตอนที่อ่าน
 *
 * ── ทำไมต้องมีแคช ──
 * `loadAllTasks()` อ่าน `tasks.jsonl` ทั้งไฟล์แล้ว `JSON.parse` ทีละแถว
 * (2026-08-31: 14.5 MB / 16,611 แถว) การเรียกมันทุก 30 วินาทีจากตัวจับเวลา
 * ทำให้เธรดหลักถูกยึดจน HTTP ไม่ได้ทำงานเลย — เหตุการณ์จริงที่ทำให้ Core
 * ไม่ตอบนาน 3 ชั่วโมง 47 นาที
 *
 * ── ตัวตนของแคชคือตัวไฟล์เอง ──
 * คีย์คือ `size + mtimeMs` ของไฟล์จริง ไม่ใช่เวลาหมดอายุที่ตั้งเอง คลังนี้เขียน
 * แบบต่อท้ายอย่างเดียว ถ้าขนาดและเวลาแก้ไขไม่เปลี่ยน แปลว่าไม่มีงานใหม่ให้
 * ประกาศจริง ๆ — ไม่ใช่การเดาว่า "น่าจะยังไม่เปลี่ยน" และไฟล์ประวัติไม่ถูกแตะ
 */
let tasksCache: { readonly size: number; readonly mtimeMs: number; readonly tasks: Task[] } | null = null;

function latestTasks(): Task[] {
  const path = tasksFilePath();
  let stamp: { size: number; mtimeMs: number } | null = null;
  try {
    const s = statSync(path);
    stamp = { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    stamp = null;   // อ่านตัวตนของไฟล์ไม่ได้ = ไม่แคช อ่านจริงทุกครั้ง
  }
  if (stamp !== null && tasksCache !== null
      && tasksCache.size === stamp.size && tasksCache.mtimeMs === stamp.mtimeMs) {
    return tasksCache.tasks;
  }
  const latest = new Map<string, Task>();
  for (const task of loadAllTasks()) latest.set(task.task_id, task);
  const tasks = [...latest.values()];
  if (stamp !== null) tasksCache = { size: stamp.size, mtimeMs: stamp.mtimeMs, tasks };
  return tasks;
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
/**
 * รอบที่กำลังทำงานอยู่ — มีได้ครั้งละหนึ่งเท่านั้น
 *
 * ── ทำไมต้องมีตัวกั้น ──
 * ตัวจับเวลาใน `./supervisor.ts` ยิงทุก 30 วินาทีแบบ `void` (ไม่รอผล) ถ้ารอบหนึ่ง
 * ใช้เวลานานกว่า 30 วินาที รอบใหม่จะเริ่มทับ และแต่ละรอบอ่านคลังงานทั้งก้อนใหม่
 * จำนวนรอบที่ทับกันโตขึ้นเรื่อย ๆ จนเธรดหลักไม่เหลือเวลาให้ HTTP — นี่คือกลไก
 * ที่ทำให้ Core ค้างจริงเมื่อ 2026-08-31
 *
 * ผู้เรียกที่มาระหว่างรอบเดิมยังทำงานอยู่ จะได้ผลของรอบเดิม ไม่ใช่การเริ่มรอบใหม่
 * และตัวกั้นถูกปล่อยใน `finally` เสมอ — รอบที่โยน error จึงไม่ล็อกระบบค้างถาวร
 */
let sweepInFlight: Promise<VoiceSweepResult> | null = null;

export async function runVoiceAnnouncementSweep(): Promise<VoiceSweepResult> {
  if (sweepInFlight !== null) return sweepInFlight;
  const run = executeVoiceAnnouncementSweep();
  sweepInFlight = run;
  try {
    return await run;
  } finally {
    sweepInFlight = null;
  }
}

/** จำนวนรอบที่กำลังทำงานอยู่จริง — 0 หรือ 1 เท่านั้น ใช้ตรวจค่าคงตัวข้อนี้ได้ */
export function activeVoiceSweepCount(): 0 | 1 {
  return sweepInFlight === null ? 0 : 1;
}

async function executeVoiceAnnouncementSweep(): Promise<VoiceSweepResult> {
  // ตรวจสวิตช์ก่อนแตะคลังใด ๆ — ปิดอยู่ต้องไม่มีการอ่าน tasks.jsonl แม้แต่ครั้งเดียว
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
      // ต่อท้ายรายการเดิม แทนการสร้างอาร์เรย์ใหม่จาก Set ทุกครั้ง — ผลเหมือนเดิม
      // ทุกประการ (ไม่มีรายการซ้ำ เพราะผ่าน `announcedSet.has` มาแล้ว) แต่ไม่เป็น
      // O(n) ต่อหนึ่งงาน การรับประกันเดิม "เขียนทันทีต่อหนึ่งงาน" ยังอยู่ครบ
      state.announced_task_ids.push(task.task_id);
      writeJson(stateFile(), state); // persisted immediately, per-task — real idempotent-restart guarantee
      announced.push(task.task_id);
    } else {
      errors.push({ task_id: task.task_id, error: outcome.summary });
    }
  }

  return { enabled: true, announced, skipped_already_announced: skipped, skipped_high_risk: skippedHighRisk, errors };
}
