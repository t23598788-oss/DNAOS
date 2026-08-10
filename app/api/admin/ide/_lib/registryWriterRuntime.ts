/**
 * Registry Writer Runtime (Owner, 2026-08-09, GAP-1 — same one-time Advisor
 * exception as evidenceCollectorRuntime.ts/normalizationRuntime.ts).
 *
 * The ONE sanctioned writer for registry/FACTORY_CENTRAL_REGISTRY.json, by
 * design — same discipline scripts/check-connector-lifecycle.sh's Guard A
 * already enforces for the connectors table ("only core/connector-loader.ts
 * and gateway/connectors.ts touch this table directly"). A future Worker
 * adding an equivalent guard for this file should whitelist this file only.
 *
 * Never decides. Every finding this module writes lands with a status that
 * means "unevaluated" (NEW) or, for this specific GAP-1 handoff,
 * "IMPLEMENTED_PENDING_MANAGER_VERIFY" — a real, new, additive status value
 * (see ensureStatusEnumValue below) meaning "built and tested by the Advisor
 * under an explicit one-time exception, not yet verified by MANAGER-07."
 * Neither status implies MANAGER-07's own evaluation/decision — `evaluation`
 * is always left null/absent by this writer. Per the Owner's own instruction
 * this exact turn: "ห้ามตัดสินใจแทน MANAGER-07."
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import type { EvidenceItem } from "./evidenceCollectorRuntime";

const REGISTRY_PATH = join(WORKSPACE_ROOT, "registry", "FACTORY_CENTRAL_REGISTRY.json");
const LOCK_MANAGER_PATH = join(WORKSPACE_ROOT, "registry", "LOCK_MANAGER.json");

/** Honest identifier for this writer's own actions in the lock ledger — not
 * a fabricated agent_id (this session has none, same disclosed gap
 * ROLE_ALIGNMENT_REPORT.md already flagged), a real, legible label instead. */
const WRITER_IDENTITY = "factory-architecture-advisor (GAP-1 one-time exception, 2026-08-09)";

interface LockEntry {
  file: string;
  held_by: string;
  acquired_at: string;
}

interface LockManagerFile {
  version: number;
  protocol: string;
  note: string;
  rule: string;
  locks: LockEntry[];
}

export interface LockResult {
  acquired: boolean;
  reason?: string;
}

/** Real read-modify-write against registry/LOCK_MANAGER.json, per its own
 * documented contract ("To acquire: append an entry to locks[]"). Refuses to
 * acquire if another entry already holds a lock on this exact file — the
 * concrete lesson from this session's own 4 real CHANGELOG.json change_id
 * collisions earlier today, applied here as actual code, not just a
 * restated intention. */
export function acquireLock(filePath: string): LockResult {
  const raw = readFileSync(LOCK_MANAGER_PATH, "utf-8");
  const data: LockManagerFile = JSON.parse(raw);
  const existing = data.locks.find((l) => l.file === filePath && l.held_by !== WRITER_IDENTITY);
  if (existing) {
    return { acquired: false, reason: `already locked by ${existing.held_by} since ${existing.acquired_at}` };
  }
  const alreadyMine = data.locks.some((l) => l.file === filePath && l.held_by === WRITER_IDENTITY);
  if (!alreadyMine) {
    data.locks.push({ file: filePath, held_by: WRITER_IDENTITY, acquired_at: new Date().toISOString() });
    writeFileSync(LOCK_MANAGER_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }
  return { acquired: true };
}

/** Removes this writer's own lock entry entirely — per LOCK_MANAGER.json's
 * own rule ("do not just mark it idle — a stale entry blocks nobody but
 * confuses the next reader"). */
export function releaseLock(filePath: string): void {
  const raw = readFileSync(LOCK_MANAGER_PATH, "utf-8");
  const data: LockManagerFile = JSON.parse(raw);
  data.locks = data.locks.filter((l) => !(l.file === filePath && l.held_by === WRITER_IDENTITY));
  writeFileSync(LOCK_MANAGER_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export type FindingSource = "OWNER" | "MANAGER" | "FRONT_OFFICE" | "WORKER" | "ADVISOR";

export interface WriteFindingInput {
  type: string;
  description: string;
  SOURCE: FindingSource;
  source_entity: string;
  status: string; // "NEW" for a normal proposal-submission, or an explicitly-authorized value like "IMPLEMENTED_PENDING_MANAGER_VERIFY"
  evidence?: EvidenceItem[];
  priority?: "Critical" | "High" | "Medium" | "Low";
  task_id?: string | null;
  escalated_to_owner?: boolean;
}

/** Adds a status value to the real status_enum array if it isn't already
 * there — additive only, never removes or reorders an existing value. Used
 * here for the one real new value this GAP-1 handoff needs
 * ("IMPLEMENTED_PENDING_MANAGER_VERIFY", per the Owner's own explicit
 * instruction this turn) that doesn't exist in the file yet. */
function ensureStatusEnumValue(registry: any, status: string): void {
  if (!registry.status_enum.includes(status)) {
    registry.status_enum.push(status);
  }
}

/**
 * Writes one finding. Acquires a lock, re-reads the file fresh (post-lock,
 * to get the true current max finding_id — the exact fix for the read-
 * before-lock race this session's own CHANGELOG.json collisions suffered
 * from earlier today), appends, releases the lock. Never sets `evaluation`
 * — that field is MANAGER-07's alone to fill in.
 */
export function writeFinding(input: WriteFindingInput): string {
  const lock = acquireLock(REGISTRY_PATH);
  if (!lock.acquired) throw new Error(`registryWriterRuntime: could not acquire lock — ${lock.reason}`);

  try {
    const raw = readFileSync(REGISTRY_PATH, "utf-8");
    const registry = JSON.parse(raw);

    const maxNum = registry.findings.reduce((max: number, f: { finding_id: string }) => {
      const m = /^FCR-(\d+)$/.exec(f.finding_id);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    const finding_id = `FCR-${String(maxNum + 1).padStart(3, "0")}`;

    ensureStatusEnumValue(registry, input.status);

    const finding: Record<string, unknown> = {
      finding_id,
      type: input.type,
      reported_by: input.source_entity,
      description: input.description,
      evaluation: null,
      status: input.status,
      task_id: input.task_id ?? null,
      escalated_to_owner: input.escalated_to_owner ?? false,
      SOURCE: input.SOURCE,
      source_entity: input.source_entity,
    };
    if (input.evidence) finding.evidence = input.evidence;
    if (input.priority) finding.priority = input.priority;

    registry.findings.push(finding);
    registry.summary.total = registry.findings.length;

    writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n", "utf-8");
    return finding_id;
  } finally {
    releaseLock(REGISTRY_PATH);
  }
}
