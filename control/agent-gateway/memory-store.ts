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
 * Dependency ที่อนุญาต: ./host-runtime.ts, ./types.ts (type only).
 * สิ่งที่ห้ามแตะ: never store a raw credential/secret value in these
 * files — evidence payloads must reference, never embed, a secret.
 */
import { appendFileUtf8, ensureDir, fileExists, joinPath, readFileUtf8, repoRootDirname, writeFileUtf8 } from "./host-runtime";
import type { Evidence, HandoffRecord, Task } from "./types";

const DATA_DIR_RELATIVE = "control/agent-gateway/data";

function dataDir(): string {
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

export function saveTask(task: Task): void {
  ensureFiles();
  appendFileUtf8(tasksFile(), JSON.stringify(task) + "\n");
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
}

export function loadEvidenceForTask(taskId: string): Evidence[] {
  ensureFiles();
  return readJsonl<Evidence>(evidenceFile()).filter((e) => e.task_id === taskId);
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
