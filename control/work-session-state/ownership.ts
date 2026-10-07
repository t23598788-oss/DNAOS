/**
 * หน้าที่: answers "which work session owns this change?" for a real repo path.
 * Git identity alone does not answer it — two agents committing as the same git
 * user, or an uncommitted working-tree edit, both look identical to git.
 *
 * Input: a repo-relative path.
 * Output: `resolveChangeOwner`, `resolveChangeOwners`.
 * Dependency ที่อนุญาต: ./types.ts, ./store.ts, and
 * `../work-coordination/contract.ts` — REUSED, not reimplemented: the live
 * write-lock directory and its path-containment rule already exist there and
 * this file must not grow a second copy of either.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเดาเจ้าของ — ถ้าไม่มี active work ประกาศ path นี้ ต้องตอบ `UNKNOWN`
 *   และถ้ามีมากกว่าหนึ่ง ต้องตอบ `UNKNOWN` แบบ `AMBIGUOUS` ห้ามเลือกอันแรก
 * - ห้ามสร้าง resource identity ใหม่ — ไฟล์นี้ตอบด้วย path กับ work_id
 *   ที่มีอยู่แล้วเท่านั้น
 */
import { listWriteLocks, normalizeScopePath, scopesOverlap } from "../work-coordination/contract";
import type { ChangeOwnership } from "./types";
import { allCurrentCheckpoints, journalPath } from "./store";

/**
 * Resolves the owner of one path.
 *
 * Order matters: a LIVE HELD WRITE LOCK is stronger evidence than a declared
 * scope, because a lock is a real file another process could not have taken at
 * the same time, while a declaration is only a statement of intent.
 */
export function resolveChangeOwner(rawPath: string, options: { path?: string } = {}): ChangeOwnership {
  const path = normalizeScopePath(rawPath);
  if (path === null) {
    return { path: rawPath, work_id: "UNKNOWN", task_id: null, session_id: null, execution_id: null, provenance: "UNOWNED", detail: "path is not a normalizable repo-relative path" };
  }

  const journal = options.path ?? journalPath();
  const active = allCurrentCheckpoints(journal).filter((c) => c.status === "ACTIVE" || c.status === "BLOCKED");

  // 1 — a live held write lock whose scope contains this path.
  const holders = listWriteLocks().filter((lock) => scopesOverlap(path, lock.scope_path));
  if (holders.length === 1) {
    const holder = holders[0];
    const owning = active.find((c) => c.work_id === holder.holder_id) ?? active.find((c) => c.session_id === holder.holder_id) ?? null;
    return {
      path, work_id: owning?.work_id ?? holder.holder_id,
      task_id: owning?.task_id ?? null, session_id: owning?.session_id ?? null, execution_id: owning?.execution_id ?? null,
      provenance: "WRITE_LOCK_HELD",
      detail: `held lock ${holder.lock_key} scope ${holder.scope_path} until ${holder.lease_expires_at}`,
    };
  }
  if (holders.length > 1) {
    return { path, work_id: "UNKNOWN", task_id: null, session_id: null, execution_id: null, provenance: "AMBIGUOUS", detail: `${holders.length} held locks cover this path: ${holders.map((h) => h.lock_key).join(", ")}` };
  }

  // 2 — exactly one ACTIVE checkpoint declares this path in its scope.
  const declaring = active.filter((c) =>
    c.affected_paths.some((p) => {
      const norm = normalizeScopePath(p);
      return norm !== null && scopesOverlap(path, norm);
    }),
  );
  if (declaring.length === 1) {
    const c = declaring[0];
    return { path, work_id: c.work_id, task_id: c.task_id, session_id: c.session_id, execution_id: c.execution_id, provenance: "CHECKPOINT_SCOPE", detail: `checkpoint ${c.checkpoint_id} phase ${c.current_phase} declares this path` };
  }
  if (declaring.length > 1) {
    return { path, work_id: "UNKNOWN", task_id: null, session_id: null, execution_id: null, provenance: "AMBIGUOUS", detail: `${declaring.length} active work sessions declare this path: ${declaring.map((c) => c.work_id).join(", ")}` };
  }

  return { path, work_id: "UNKNOWN", task_id: null, session_id: null, execution_id: null, provenance: "UNOWNED", detail: "no held write lock and no active work session declares this path" };
}

export function resolveChangeOwners(paths: readonly string[], options: { path?: string } = {}): ChangeOwnership[] {
  return paths.map((p) => resolveChangeOwner(p, options));
}
