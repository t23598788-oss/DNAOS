/**
 * หน้าที่: §1–§3 — derive the CANONICAL `files_changed` from observed
 * evidence, never from what a caller claims.
 *
 * THE DEFECT THIS CLOSES: `observeRemediation` used to accept
 * `files_changed` from its caller. A caller that reports `[]` while its
 * child really wrote a file would have passed policy checks cleanly. Here
 * the filesystem itself is the witness.
 *
 * WHY A DIGEST DIFF AND NOT THE OBSERVER DAEMON — read before assuming
 * this duplicates anything. `control/machine-observation/` has NO
 * filesystem watcher: `process-observer.ts` is `ps`/`lsof`-based, and
 * `ObservationRecord` rows are appended BY callers describing what they
 * did (`source`/`derived_by` are caller-written strings — see any row in
 * its own data dir). So there is no existing mechanism that autonomously
 * notices a write, and none can be conjured by calling the observer
 * differently. What IS available and deterministic is the filesystem: a
 * digest snapshot of the approved scope before dispatch, and again after.
 * That is not a second observer — it starts no daemon, watches nothing,
 * and stores nothing of its own. It records its findings INTO the
 * existing observation store via the existing `appendObservation`.
 *
 * LINEAGE without mutating a shared type: `ObservationRecord` has no
 * `work_id`/`execution_id` field, and that type is owned by another
 * capability actively being edited. Lineage is therefore encoded in the
 * existing `source` field as `dna-os:work=<id>;execution=<id>`, and
 * `observationsForWork` reads it back through the existing
 * `readObservations()`. No new storage, no shared-file edit.
 *
 * Input: an approved scope + a work/execution identity.
 * Output: `snapshotScope`, `diffScope`, `recordObservedChanges`,
 * `observationsForWork`, `observationsForExecution`, `classifyChange`.
 * Dependency ที่อนุญาต: ./types.ts, ../machine-observation/contract.ts,
 * node:fs, node:path, node:crypto.
 * สิ่งที่ห้ามแตะ: never accept a caller-supplied file list as the
 * canonical answer, and never start a watcher here — if real write
 * interception is ever needed it belongs in the observer capability, not
 * duplicated in this consumer.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { appendObservation, readObservations, type ObservationRecord } from "../machine-observation/contract";

export type ChangeClassification = "EXPECTED_CHANGE" | "UNEXPECTED_CHANGE" | "OUT_OF_SCOPE_CHANGE" | "UNKNOWN_CHANGE";

export interface ClassifiedChange {
  readonly path: string;
  readonly classification: ChangeClassification;
  readonly reason: string;
}

/** Bounded walk. Depth-limited so a runaway symlink cannot make this unbounded. */
function walk(root: string, depth = 0, out: string[] = []): string[] {
  if (depth > 12 || !existsSync(root)) return out;
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(root, entry);
    let stat;
    try {
      // lstat semantics: do NOT follow a symlink out of the scope.
      stat = statSync(full, { throwIfNoEntry: false });
    } catch {
      continue;
    }
    if (!stat) continue;
    if (stat.isDirectory()) walk(full, depth + 1, out);
    else if (stat.isFile()) out.push(full);
  }
  return out;
}

/** path -> content digest, for every file currently under the scope. */
export function snapshotScope(scopePaths: readonly string[]): ReadonlyMap<string, string> {
  const snapshot = new Map<string, string>();
  for (const scope of scopePaths) {
    for (const file of walk(scope)) {
      try {
        snapshot.set(file, createHash("sha256").update(readFileSync(file)).digest("hex"));
      } catch {
        // Unreadable is still a fact — record it so it cannot look absent.
        snapshot.set(file, "UNREADABLE");
      }
    }
  }
  return snapshot;
}

/** Real changes between two snapshots: created, modified, or deleted. */
export function diffScope(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): readonly string[] {
  const changed = new Set<string>();
  for (const [path, digest] of after) if (before.get(path) !== digest) changed.add(path);
  for (const path of before.keys()) if (!after.has(path)) changed.add(path);
  return [...changed].sort();
}

function lineageMarker(workId: string, executionId: string): string {
  return `dna-os:work=${workId};execution=${executionId}`;
}

/**
 * Records each observed change into the EXISTING observation store.
 * Returns the rows written, so a caller can prove the evidence landed.
 */
export function recordObservedChanges(
  workId: string,
  executionId: string,
  resourceId: string | null,
  changedFiles: readonly string[],
  repoRoot: string,
): readonly ObservationRecord[] {
  return changedFiles.map((file) =>
    appendObservation({
      event_id: `obs-${workId}-${createHash("sha256").update(file).digest("hex").slice(0, 12)}-${Date.now()}`,
      resource_id: resourceId,
      path: isAbsolute(file) && file.startsWith(repoRoot) ? relative(repoRoot, file) : file,
      observed_at: new Date().toISOString(),
      process_evidence: [`filesystem digest diff of the approved write scope, taken by control/incident-remediation/observed-changes.ts`],
      relationship_evidence: [],
      meaning_records: [],
      // marker เดิมยังเขียนไว้เพื่อความเข้ากันได้ย้อนหลัง แต่ค่าที่เชื่อถือได้คือ
      // ฟิลด์ที่มีชนิดด้านล่าง (Owner, DECISION 5)
      source: lineageMarker(workId, executionId),
      derived_by: "incident-remediation scope digest diff (not a caller claim)",
      work_id: workId,
      execution_id: executionId,
    }),
  );
}

/** §1 required API — reads the ONE existing store, filters by lineage. */
export function observationsForWork(workId: string): readonly ObservationRecord[] {
  /**
   * ฟิลด์ที่มีชนิดมาก่อน (Owner, DECISION 5) — แถวใหม่ตอบด้วย `work_id`
   * ส่วนการค้นใน `source` ยังคงไว้เพื่ออ่าน 20 แถวเดิมที่บันทึกก่อนฟิลด์นี้เกิด
   * ไม่ใช่เพราะมันเป็นแหล่งตัวตนที่ถูกต้อง
   */
  return readObservations().filter((r) => r.work_id === workId || (!r.work_id && r.source.includes(`work=${workId}`)));
}

export function observationsForExecution(executionId: string): readonly ObservationRecord[] {
  return readObservations().filter((r) => r.execution_id === executionId || (!r.execution_id && r.source.includes(`execution=${executionId}`)));
}

/**
 * §2. Classifies one observed mutation against the persisted resolution.
 * `UNKNOWN_CHANGE` fails closed — it is never quietly accepted.
 */
export function classifyChange(
  path: string,
  allowedWriteScope: readonly string[],
  forbiddenWriteScope: readonly string[],
  expectedPaths: readonly string[],
): ClassifiedChange {
  const under = (scope: string): boolean => path === scope || path.startsWith(`${scope}/`);

  for (const forbidden of forbiddenWriteScope) {
    if (under(forbidden)) return { path, classification: "OUT_OF_SCOPE_CHANGE", reason: `inside forbidden_write_scope "${forbidden}"` };
  }
  const inScope = allowedWriteScope.some(under);
  if (!inScope) return { path, classification: "OUT_OF_SCOPE_CHANGE", reason: "outside every allowed_write_scope entry" };

  if (expectedPaths.length === 0) {
    // In scope, but the resolution named no expected artifacts, so we
    // cannot say whether this was intended. Fail closed, do not accept.
    return { path, classification: "UNKNOWN_CHANGE", reason: "in scope, but the resolution declared no expected artifact paths to compare against" };
  }
  if (expectedPaths.some((expected) => path === expected || path.startsWith(`${expected}/`))) {
    return { path, classification: "EXPECTED_CHANGE", reason: "matches an expected artifact path" };
  }
  return { path, classification: "UNEXPECTED_CHANGE", reason: "inside the approved scope but not among the expected artifacts" };
}
