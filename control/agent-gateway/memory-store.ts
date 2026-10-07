/**
 * หน้าที่: persistent memory for the Agent Gateway — REUSES the exact
 * flat-JSON-file storage boundary already established repo-wide
 * (execution/file-write/write-audit-log.json,
 * dna-os-circuit/runtime/findings-evidence.json) instead of introducing
 * a new database engine. Real discovery confirmed (Phase 23): no
 * sqlite/postgres/mongodb dependency exists anywhere in this repo — this
 * file does not add one either.
 *
 * Survives process restart because it is a real file on disk, appended
 * to and read fresh on every call — never an in-memory-only Map like
 * dna-os-circuit/runtime/circuit-state.ts (that pattern is correct for
 * Circuit's own topology, wrong for durable task memory).
 *
 * Input: Task / Evidence / OwnerDecision records.
 * Output: append + read-all functions per record kind.
 * Dependency ที่อนุญาต: ./host-runtime.ts, ./types.ts (type only),
 * `../conversation-read-model/contract.ts` (producer-side projection
 * publish only, at the same moment a task/evidence row is actually saved —
 * see Owner UNLOCK 2026-09-06 physical separation of the Owner
 * Conversation Layer from this package).
 * สิ่งที่ห้ามแตะ: never store a raw credential/secret value in these
 * files — evidence payloads must reference, never embed, a secret.
 */
import { appendFileUtf8, ensureDir, fileExists, joinPath, readFileUtf8, repoRootDirname, writeFileUtf8 } from "./host-runtime";
import type { Evidence, HandoffRecord, Task } from "./types";
import { publishTaskEvidence, publishTaskStatus } from "../conversation-read-model/contract";

const DATA_DIR_RELATIVE = "control/agent-gateway/data";

/**
 * Where this capability's durable rows live.
 *
 * `AGENT_GATEWAY_DATA_DIR` added 2026-08-26 (Owner — durable work-state
 * authority phase). A proof that exercises the REAL production funnel
 * (`submitTask` -> `persistStatus`) necessarily writes real task, evidence and
 * handoff rows; without this they land in the production store, exactly the
 * live-registry residue that has already had to be cleaned up twice in this
 * repo. Production reads nothing from the env and is unchanged.
 */
function dataDir(): string {
  const override = process.env.AGENT_GATEWAY_DATA_DIR;
  if (override && override.length > 0) return override;
  return joinPath(repoRootDirname(), DATA_DIR_RELATIVE);
}
function tasksFile(): string {
  return joinPath(dataDir(), "tasks.jsonl");
}
function evidenceFile(): string {
  return joinPath(dataDir(), "evidence.jsonl");
}
function handoffsFile(): string {
  return joinPath(dataDir(), "handoffs.jsonl");
}

function ensureFiles(): void {
  ensureDir(dataDir());
  if (!fileExists(tasksFile())) writeFileUtf8(tasksFile(), "");
  if (!fileExists(evidenceFile())) writeFileUtf8(evidenceFile(), "");
  if (!fileExists(handoffsFile())) writeFileUtf8(handoffsFile(), "");
}

function readJsonl<T>(path: string): T[] {
  if (!fileExists(path)) return [];
  const raw = readFileUtf8(path);
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

/**
 * The REAL absolute path of the task log in use right now.
 *
 * Exported so a durable checkpoint can record a verification that points at the
 * file that actually holds the row, rather than at the production path spelled
 * out as a literal. Those are the same thing in production and different under
 * `AGENT_GATEWAY_DATA_DIR`, and a verification that resolves to the wrong file
 * reports a real, completed step as unprovable.
 */
export function tasksFilePath(): string {
  return tasksFile();
}

export function saveTask(task: Task): void {
  ensureFiles();
  appendFileUtf8(tasksFile(), JSON.stringify(task) + "\n");
  // Producer-side snapshot, at the moment this task's real state is saved —
  // never re-derived later on a conversation query.
  publishTaskStatus({ task_id: task.task_id, status: task.status, updated_at: task.updated_at, next_action: task.next_action ?? null });
}

/** Returns the LATEST record for a given task_id — a task is appended each time its status changes, never mutated in place, so history survives too. */
export function loadTask(taskId: string): Task | undefined {
  ensureFiles();
  const all = readJsonl<Task>(tasksFile());
  const matches = all.filter((t) => t.task_id === taskId);
  return matches[matches.length - 1];
}

export function loadTaskHistory(taskId: string): Task[] {
  ensureFiles();
  return readJsonl<Task>(tasksFile()).filter((t) => t.task_id === taskId);
}

export function saveEvidence(evidence: Evidence): void {
  ensureFiles();
  appendFileUtf8(evidenceFile(), JSON.stringify(evidence) + "\n");
  // Producer-side snapshot, at the moment this evidence row is saved. The
  // full current row set for this task_id is republished (not just the new
  // row) so a conversation read never has to reconstruct history itself.
  const rows = loadEvidenceForTask(evidence.task_id).map((row) => ({ kind: row.kind, source: row.source, recorded_at: row.recorded_at }));
  publishTaskEvidence({ task_id: evidence.task_id, rows });
}

export function loadEvidenceForTask(taskId: string): Evidence[] {
  ensureFiles();
  return readJsonl<Evidence>(evidenceFile()).filter((e) => e.task_id === taskId);
}

/**
 * Every evidence record, unfiltered. `loadEvidenceForTask` answers "what
 * happened for this task"; this answers "does a record with these properties
 * exist anywhere" — which is what a lookup by commit_sha needs, since the task
 * that produced a verification is not known to a later reader.
 * Same append-only file, same read path, no second store.
 */
export function loadAllEvidence(): Evidence[] {
  ensureFiles();
  return readJsonl<Evidence>(evidenceFile());
}

export function loadEvidenceForCorrelation(correlationId: string): Evidence[] {
  return loadAllEvidence().filter((row) =>
    row.correlation_id === correlationId
    || row.work_order_id === correlationId
    || row.task_id === correlationId,
  );
}

export function loadAllTasks(): Task[] {
  ensureFiles();
  return readJsonl<Task>(tasksFile());
}

export function saveHandoff(handoff: HandoffRecord): void {
  ensureFiles();
  appendFileUtf8(handoffsFile(), JSON.stringify(handoff) + "\n");
}

export function loadHandoffsForTask(taskId: string): HandoffRecord[] {
  ensureFiles();
  return readJsonl<HandoffRecord>(handoffsFile()).filter((handoff) => handoff.task_id === taskId);
}

export function loadAllHandoffs(): HandoffRecord[] {
  ensureFiles();
  return readJsonl<HandoffRecord>(handoffsFile());
}
