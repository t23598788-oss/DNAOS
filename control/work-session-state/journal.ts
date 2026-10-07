/**
 * หน้าที่: §3 UNSAVED WORK JOURNAL — งานต้องรอดก่อนถึง commit.
 *
 * ปัญหาที่ปิด: ทุกวันนี้ขอบเขตแรกที่งานกลายเป็นของถาวรคือ "commit" ถ้า process
 * ตายระหว่างที่ตั้งใจจะแก้ไฟล์แล้วยังไม่ได้ commit เจตนานั้นหายไปทั้งหมด และไม่มี
 * ใครรู้ด้วยซ้ำว่ามันเคยมี ไฟล์นี้ย้ายขอบเขตความถาวรมาไว้ที่ **ก่อนลงมือ**
 *
 *   EDIT INTENT → JOURNAL → APPLY → CHECKPOINT → VERIFY → COMMIT
 *
 * ทุกลูกศรมีการเขียนลงดิสก์ก่อนจะยอมรับว่าผ่านขั้นนั้นมาแล้ว process ที่ตายที่
 * ลูกศรไหนก็ตาม จะถูกกู้กลับจาก record ถาวรอันสุดท้ายเสมอ
 *
 * Input: `openEntry` / `advanceEntry` / `failEntry` จากผู้ที่กำลังจะแก้ของจริง.
 * Output: `openEntry`, `advanceEntry`, `failEntry`, `readEntries`,
 * `recoverableEntries`, `entryJournalPath`.
 * Dependency ที่อนุญาต: Node built-ins + ./types.ts + ./store.ts.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามแก้ record เดิมในที่เดิม — append-only เหมือน checkpoint journal
 * - ห้ามข้ามขั้น — advanceEntry ปฏิเสธการกระโดดข้าม stage ที่ประกาศไว้
 * - ห้ามถือว่า COMMIT คือขอบเขตความถาวรแรก นั่นคือบั๊กที่ไฟล์นี้มีไว้เพื่อปิด
 * - ห้ามให้ไฟล์นี้ลบหรือแก้ไฟล์ของจริง — มันบันทึก "จะทำอะไร" กับ "ทำถึงไหนแล้ว"
 *   เท่านั้น การลงมือจริงเป็นของผู้เรียก
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

/**
 * The stages, in the only order they may be entered. `APPLIED` means the real
 * mutation happened; everything before it means it did not.
 */
export const JOURNAL_STAGES = ["INTENT", "JOURNALED", "APPLIED", "CHECKPOINTED", "VERIFIED", "COMMITTED"] as const;
export type JournalStage = (typeof JOURNAL_STAGES)[number];

export interface JournalEntry {
  entry_id: string;
  work_id: string;
  execution_id: string | null;
  /** What is about to change, in the words of whoever is changing it. */
  intent: string;
  /** Repo-relative paths this entry will touch. */
  target_paths: readonly string[];
  stage: JournalStage;
  /**
   * The content this entry intends to write, when it has one — a draft that
   * has not been applied yet. This is the "unsaved work" that used to die with
   * the process. `null` for an entry whose change is not a file body.
   */
  draft: Record<string, string> | null;
  /** Digest of each target path BEFORE the change, so a partial apply is detectable. */
  before_digests: Record<string, string | null>;
  evidence_refs: readonly string[];
  /** Set only when the entry failed; the exact reason, never a summary. */
  failure: string | null;
  at: string;
}

export function entryJournalPath(root = process.env.WORK_SESSION_STATE_ROOT ?? resolve(process.cwd(), "local-runtime/work-session-state")): string {
  return resolve(root, "work-journal.jsonl");
}

function append(entry: JournalEntry, path: string): JournalEntry {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return entry;
}

export function readEntries(path = entryJournalPath()): JournalEntry[] {
  if (!existsSync(path)) return [];
  const out: JournalEntry[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as JournalEntry;
      if (typeof parsed?.entry_id === "string") out.push(parsed);
    } catch {
      // a half-written final line is the normal shape of a killed writer
    }
  }
  return out;
}

/** The CURRENT state of every entry = its last record. */
export function currentEntries(path = entryJournalPath()): JournalEntry[] {
  const latest = new Map<string, JournalEntry>();
  for (const e of readEntries(path)) latest.set(e.entry_id, e);
  return Array.from(latest.values());
}

/**
 * Opens an entry at `INTENT` and immediately durably records it at
 * `JOURNALED`. Both are written before this function returns, so there is no
 * window in which the caller believes the intent is recorded and it is not.
 */
export function openEntry(
  input: { work_id: string; execution_id?: string | null; intent: string; target_paths: readonly string[]; draft?: Record<string, string> | null; evidence_refs?: readonly string[] },
  options: { path?: string; repoRoot?: string } = {},
): JournalEntry {
  const path = options.path ?? entryJournalPath();
  const repoRoot = options.repoRoot ?? process.cwd();
  const before: Record<string, string | null> = {};
  for (const p of input.target_paths) before[p] = digestOrNull(resolve(repoRoot, p));

  const base: Omit<JournalEntry, "stage" | "at"> = {
    entry_id: `wje-${randomUUID()}`,
    work_id: input.work_id,
    execution_id: input.execution_id ?? null,
    intent: input.intent,
    target_paths: input.target_paths,
    draft: input.draft ?? null,
    before_digests: before,
    evidence_refs: input.evidence_refs ?? [],
    failure: null,
  };
  append({ ...base, stage: "INTENT", at: new Date().toISOString() }, path);
  return append({ ...base, stage: "JOURNALED", at: new Date().toISOString() }, path);
}

function digestOrNull(full: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    return createHash("sha256").update(readFileSync(full)).digest("hex");
  } catch {
    return null;
  }
}

export type AdvanceResult = { ok: true; entry: JournalEntry } | { ok: false; reason: string };

/**
 * Moves an entry to the NEXT stage. Refuses to skip: an entry cannot claim
 * `VERIFIED` without having been `CHECKPOINTED`, because a stage that was never
 * durably recorded cannot be recovered to, which is the whole point.
 */
export function advanceEntry(entryId: string, to: JournalStage, options: { path?: string; evidence_refs?: readonly string[] } = {}): AdvanceResult {
  const path = options.path ?? entryJournalPath();
  const current = currentEntries(path).find((e) => e.entry_id === entryId);
  if (!current) return { ok: false, reason: `NO_SUCH_ENTRY:${entryId}` };
  if (current.failure !== null) return { ok: false, reason: `ENTRY_FAILED:${current.failure}` };
  const from = JOURNAL_STAGES.indexOf(current.stage);
  const next = JOURNAL_STAGES.indexOf(to);
  if (next !== from + 1) return { ok: false, reason: `STAGE_SKIP_REFUSED:${current.stage}->${to}` };
  return {
    ok: true,
    entry: append({ ...current, stage: to, at: new Date().toISOString(), evidence_refs: [...current.evidence_refs, ...(options.evidence_refs ?? [])] }, path),
  };
}

export function failEntry(entryId: string, reason: string, options: { path?: string } = {}): AdvanceResult {
  const path = options.path ?? entryJournalPath();
  const current = currentEntries(path).find((e) => e.entry_id === entryId);
  if (!current) return { ok: false, reason: `NO_SUCH_ENTRY:${entryId}` };
  return { ok: true, entry: append({ ...current, failure: reason, at: new Date().toISOString() }, path) };
}

export interface RecoverableEntry {
  entry: JournalEntry;
  /**
   * What a recovering worker must do, derived from the stage the entry died
   * at and from what the filesystem actually shows now — never from what the
   * entry claims about itself alone.
   */
  recovery: "REAPPLY" | "RESUME_AFTER_APPLY" | "VERIFY_ONLY" | "COMMIT_ONLY" | "NOTHING_TO_DO";
  detail: string;
}

/**
 * Every entry that did not reach `COMMITTED`, with the exact next move.
 *
 * The stage says where the writer THOUGHT it was; the digests say what really
 * happened to the files. An entry recorded as `JOURNALED` whose target file
 * has already changed is reported as `RESUME_AFTER_APPLY`, not `REAPPLY` —
 * writing the draft again over a file that already carries it is how a crash
 * recovery corrupts work.
 */
export function recoverableEntries(options: { path?: string; repoRoot?: string; work_id?: string } = {}): RecoverableEntry[] {
  const path = options.path ?? entryJournalPath();
  const repoRoot = options.repoRoot ?? process.cwd();
  const out: RecoverableEntry[] = [];
  for (const entry of currentEntries(path)) {
    if (options.work_id && entry.work_id !== options.work_id) continue;
    if (entry.stage === "COMMITTED") continue;
    if (entry.failure !== null) continue;
    const changed = entry.target_paths.filter((p) => digestOrNull(resolve(repoRoot, p)) !== entry.before_digests[p]);
    if (entry.stage === "INTENT" || entry.stage === "JOURNALED") {
      out.push(changed.length === 0
        ? { entry, recovery: "REAPPLY", detail: `died before applying; no target file changed (${entry.target_paths.length} path(s) still at their recorded digest)` }
        : { entry, recovery: "RESUME_AFTER_APPLY", detail: `recorded as ${entry.stage} but ${changed.length} target file(s) already differ from the recorded digest — the apply landed and the journal write did not; do NOT write the draft again: ${changed.join(", ")}` });
      continue;
    }
    if (entry.stage === "APPLIED") { out.push({ entry, recovery: "RESUME_AFTER_APPLY", detail: "applied but never checkpointed — checkpoint, then verify, then commit" }); continue; }
    if (entry.stage === "CHECKPOINTED") { out.push({ entry, recovery: "VERIFY_ONLY", detail: "applied and checkpointed — verification is the only thing missing" }); continue; }
    out.push({ entry, recovery: "COMMIT_ONLY", detail: "applied, checkpointed and verified — only the commit is missing" });
  }
  return out;
}
