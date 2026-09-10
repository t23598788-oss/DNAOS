/**
 * หน้าที่: the append-only, on-disk journal of work-session checkpoints, plus
 * the deterministic reduce that turns it into "the current state of work X".
 * This is the storage DNA OS owns so that no AI memory is required to know
 * where work stands.
 *
 * Input: `WorkSessionCheckpoint` records from whoever is doing the work.
 * Output: `appendCheckpoint`, `currentCheckpoint`, `allCurrentCheckpoints`,
 * `checkpointHistory`, `journalPath`.
 * Dependency ที่อนุญาต: Node built-ins (`fs`/`path`/`crypto`) และ ./types.ts.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามแก้ record เดิมในที่เดิม — journal นี้ append-only เท่านั้น
 *   สถานะปัจจุบัน = record สุดท้ายของ work_id นั้น การแก้ทับทำให้ writer ที่ตายกลางคัน
 *   ทิ้ง state ครึ่งใบไว้ได้ ซึ่งเป็นสิ่งที่ไฟล์นี้มีไว้เพื่อกัน
 * - ห้าม truncate/prune journal ที่นี่ — ไฟล์นี้ไม่มีสิทธิ์ลบข้อมูล
 *   (ดู `control/machine-observation/` สำหรับ retention ที่ Owner ประกาศไว้แล้ว)
 * - ห้ามเดา `source_revision` — ถ้าอ่าน git ไม่ได้ ต้องบันทึกว่า `UNKNOWN_REVISION`
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { WorkSessionCheckpoint } from "./types";

/**
 * Where DNA OS keeps this.
 *
 * Default is this process's cwd `local-runtime/` (worktree-local). That is
 * intentional: a worktree does not silently inherit another checkout's journal.
 * `WORK_SESSION_STATE_ROOT` exists so a proof run — or a second runtime on the
 * same machine — can point at its own directory instead of writing test rows
 * into the live journal. It is read here, in the ONE place the path is
 * computed, so every reader and writer in every process agrees on it without
 * anyone passing it around.
 */
export function journalPath(root = process.env.WORK_SESSION_STATE_ROOT ?? resolve(process.cwd(), "local-runtime/work-session-state")): string {
  return resolve(root, "checkpoints.jsonl");
}

/**
 * The repository revision, read from real git. Never guessed: a repository we
 * cannot read a revision from is recorded as `UNKNOWN_REVISION`, and the resume
 * engine treats that as "drift cannot be ruled out" rather than "no drift".
 */
export function currentRevision(repoRoot = process.cwd()): string {
  try {
    return execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() || "UNKNOWN_REVISION";
  } catch {
    return "UNKNOWN_REVISION";
  }
}

/** The current branch, from real git. `UNKNOWN_BRANCH` when it cannot be read. */
export function currentBranch(repoRoot = process.cwd()): string {
  try {
    return execFileSync("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim() || "UNKNOWN_BRANCH";
  } catch {
    return "UNKNOWN_BRANCH";
  }
}

export function newCheckpointId(): string { return `wsc-${randomUUID()}`; }
export function newSessionId(): string { return `wss-${randomUUID()}`; }

export function appendCheckpoint(
  checkpoint: Omit<WorkSessionCheckpoint, "checkpoint_id" | "updated_at"> & Partial<Pick<WorkSessionCheckpoint, "checkpoint_id" | "updated_at">>,
  path = journalPath(),
): WorkSessionCheckpoint {
  const complete: WorkSessionCheckpoint = {
    ...checkpoint,
    checkpoint_id: checkpoint.checkpoint_id ?? newCheckpointId(),
    updated_at: checkpoint.updated_at ?? new Date().toISOString(),
  };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(complete)}\n`, { mode: 0o600 });
  return complete;
}

function readJournal(path: string): WorkSessionCheckpoint[] {
  if (!existsSync(path)) return [];
  const out: WorkSessionCheckpoint[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as WorkSessionCheckpoint;
      // A line without a work_id is not a checkpoint; skipped, never repaired.
      if (typeof parsed?.work_id === "string" && parsed.work_id.length > 0) out.push(parsed);
    } catch {
      // A half-written final line is skipped, never guessed at.
    }
  }
  return out;
}

/** Every checkpoint ever written for one work_id, oldest first. */
export function checkpointHistory(workId: string, path = journalPath()): WorkSessionCheckpoint[] {
  return readJournal(path).filter((c) => c.work_id === workId);
}

/** The current state of one work_id = its LAST checkpoint. `null` when there is none. */
export function currentCheckpoint(workId: string, path = journalPath()): WorkSessionCheckpoint | null {
  const history = checkpointHistory(workId, path);
  return history.length === 0 ? null : history[history.length - 1];
}

/** The current state of every work_id in the journal. */
export function allCurrentCheckpoints(path = journalPath()): WorkSessionCheckpoint[] {
  const latest = new Map<string, WorkSessionCheckpoint>();
  for (const c of readJournal(path)) latest.set(c.work_id, c);
  return Array.from(latest.values());
}
