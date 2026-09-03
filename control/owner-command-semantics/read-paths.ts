/**
 * หน้าที่: the SYSTEM RESOLUTION read contracts for
 * `control/owner-command-semantics/` (Owner, 2026-08-26, Phase 2).
 *
 * Each direction is declared on its own — QUERY -> STORE and STORE -> RESULT
 * are never collapsed into one bidirectional edge. Every function here takes an
 * explicit lookup key, names the store it asked, and returns either a result
 * carrying its provenance or an explicit `NO_RESULT`. There is no third
 * outcome, and nothing here fills a gap with a plausible value: NO RESULT stays
 * NO RESULT.
 *
 * These are READS ONLY. Nothing in this file writes to any store — the whole
 * point of the layer is to retrieve system truth that already exists, not to
 * create more of it.
 *
 * Input: a lookup key per function (capability_id, task_id, identity_id).
 * Output: `ReadResult<T>` — `{ found: true, value, provenance, source }` or
 * `{ found: false, reason, source }`.
 * Dependency ที่อนุญาต: `../../software/registry-database/contract.ts`,
 * `../agent-gateway/contract.ts`, ./types.ts, node built-ins.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเขียนลง store ใดๆ จากไฟล์นี้.
 * - ห้ามคืน found:true โดยไม่มี source ที่ตรวจสอบได้.
 * - ห้ามสังเคราะห์ค่าที่หาไม่เจอ — a missing document index must report that it
 *   is missing, not return an empty list that reads like "nothing matched".
 */

declare const require: any;
declare const __dirname: string;

import type { Provenance } from "./types";
import { findCapability } from "../../software/registry-database/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import { getTask, loadEvidenceForTask } from "../agent-gateway/contract";

const fs = require("node:fs");
const path = require("node:path");

export type ReadResult<T> =
  | { found: true; value: T; provenance: Provenance; source: string }
  | { found: false; reason: string; source: string };

// ---------------------------------------------------------------------------
// QUERY -> EVIDENCE STORE  /  EVIDENCE STORE -> EVIDENCE RESULT
// ---------------------------------------------------------------------------

/**
 * Lookup key: `capability_id`. The evidence rows themselves live in
 * `software/registry-database`'s canonical `evidence.jsonl`, and the capability
 * lookup already projects the refs for one capability — so this is the existing
 * read path made explicit, not a new store API forced onto every adapter.
 *
 * Returns the REFERENCES only (file path, test-run id, URL). The underlying log
 * or source is never copied here — that is the registry's own stated rule.
 */
export function readEvidenceForCapability(capabilityId: string, store: RegistryStore | undefined): ReadResult<readonly string[]> {
  const source = "software/registry-database/contract.ts#findCapability -> evidence_refs";
  if (!store) return { found: false, reason: "no registry store was provided to this read", source };
  const result = findCapability({ capability_id: capabilityId }, store);
  if (!result) return { found: false, reason: `capability_id "${capabilityId}" is not in the registry database`, source };
  if (result.evidence_refs.length === 0) return { found: false, reason: `capability "${capabilityId}" exists but has no evidence rows`, source };
  return { found: true, value: result.evidence_refs, provenance: "EVIDENCE", source: `${source}#${capabilityId}` };
}

/**
 * The second, independent evidence direction: lookup key `task_id`, store
 * `control/agent-gateway/`'s own evidence log. Found via
 * DNA-OS-BLUEPRINT 03-RUNTIME_TOPOLOGY.md:1019, which lists
 * `loadEvidenceForTask(taskId)` among the real read APIs — the Blueprint was
 * right and this read had been missed. Kept separate from the registry
 * direction above on purpose: different key, different store, different
 * failure mode.
 */
export function readEvidenceForTask(taskId: string): ReadResult<readonly { kind: string; source: string; recorded_at: string }[]> {
  const source = "control/agent-gateway/contract.ts#loadEvidenceForTask";
  const rows = loadEvidenceForTask(taskId);
  if (!rows || rows.length === 0) return { found: false, reason: `no evidence rows for task_id "${taskId}"`, source };
  return {
    found: true,
    value: rows.map((row) => ({ kind: row.kind, source: row.source, recorded_at: row.recorded_at })),
    provenance: "EVIDENCE",
    source: `${source}#${taskId}`,
  };
}

// ---------------------------------------------------------------------------
// QUERY -> STATE STORE  /  STATE STORE -> STATE RESULT
// ---------------------------------------------------------------------------

export interface TaskStateResult {
  task_id: string;
  status: string;
  updated_at: string;
  next_action: string | null;
}

/**
 * Lookup key: `task_id`. The real store is `control/agent-gateway/`'s task
 * store, read through its public contract — this layer never touches
 * `tasks.jsonl` directly.
 */
export function readTaskState(taskId: string): ReadResult<TaskStateResult> {
  const source = "control/agent-gateway/contract.ts#getTask";
  const task = getTask(taskId);
  if (!task) return { found: false, reason: `task_id "${taskId}" is not in the gateway task store`, source };
  return {
    found: true,
    value: { task_id: task.task_id, status: task.status, updated_at: task.updated_at, next_action: (task as { next_action?: string }).next_action ?? null },
    provenance: "RUNTIME",
    source: `${source}#${taskId}`,
  };
}

// ---------------------------------------------------------------------------
// QUERY -> HISTORY  /  HISTORY -> HISTORY RESULT
// ---------------------------------------------------------------------------

export interface HistoryRecord {
  /**
   * Two different things live in this log and must not be confused (found
   * 2026-08-26 in runtime: a continuation resolved against a TASK_LINK record
   * and reported UNRESOLVED, because that record holds no resolution at all).
   * RESOLUTION = what a command proved. TASK_LINK = which task a command
   * became, written after routing. Records from before this field existed are
   * read as RESOLUTION, which is what they were.
   */
  kind?: "RAW_MESSAGE" | "RESOLUTION" | "OWNER_RESULT" | "TASK_LINK";
  recorded_at: string;
  command_id: string;
  identity_id: string;
  raw_text: string;
  resolved_target_ids: string[];
  resolved_capability_ids: string[];
  /** The registered command descriptor the previous command PROVED. Inheritable — see resolver.ts#resolveContinuation. */
  policy_command_id?: string | null;
  /** Filled by a second record once routing produced a real task — see ../owner-command/owner-command.ts. */
  task_id?: string | null;
  owner_visible_result?: Record<string, unknown> | null;
}

export const HISTORY_FILE: string = path.join(__dirname, "data", "semantic-history.jsonl");

/** Lookup key: `identity_id`. Source: this layer's own durable append-only history. */
export function readHistoryForIdentity(identityId: string): ReadResult<readonly HistoryRecord[]> {
  const source = "control/owner-command-semantics/data/semantic-history.jsonl";
  let lines: string[];
  try {
    lines = String(fs.readFileSync(HISTORY_FILE, "utf8")).split("\n").filter((line: string) => line.trim().length > 0);
  } catch {
    return { found: false, reason: "no history file exists yet", source };
  }
  const records = lines.map((line) => JSON.parse(line) as HistoryRecord).filter((record) => record.identity_id === identityId);
  if (records.length === 0) return { found: false, reason: `no previous command by identity "${identityId}"`, source };
  return { found: true, value: records, provenance: "HISTORY", source };
}

/** Read the durable owner-command projection by its canonical command id. */
export function readHistoryForCommand(commandId: string): ReadResult<HistoryRecord> {
  const source = "control/owner-command-semantics/data/semantic-history.jsonl";
  let lines: string[];
  try { lines = String(fs.readFileSync(HISTORY_FILE, "utf8")).split("\n").filter((line: string) => line.trim().length > 0); }
  catch { return { found: false, reason: "no history file exists yet", source }; }
  const matches = lines.map((line: string) => JSON.parse(line) as HistoryRecord).filter((record) => record.command_id === commandId);
  if (matches.length === 0) return { found: false, reason: `command_id "${commandId}" is not in semantic history`, source };
  return { found: true, value: matches[matches.length - 1], provenance: "HISTORY", source };
}

// ---------------------------------------------------------------------------
// QUERY -> DOCUMENT / BLUEPRINT INDEX
// ---------------------------------------------------------------------------

/**
 * There is no read path to implement here, and this function exists to say so
 * rather than to leave the absence looking like an empty result.
 *
 * Checked 2026-08-26: DNA-OS-BLUEPRINT is a SEPARATE repository
 * (/Users/tam/Desktop/DNA-OS-BLUEPRINT). This repository references it nowhere
 * — `grep -ril "DNA-OS-BLUEPRINT"` across the whole source tree returns
 * nothing. There is no document index, no claim id resolver, and no runtime
 * contract between the two. Per the Owner's instruction, that is reported as
 * MISSING instead of invented.
 *
 * `found: false` here does NOT mean "no documents matched". It means the
 * lookup could not be performed at all, and the reason says which.
 */
export function readDocumentReferences(_mention: string): ReadResult<readonly string[]> {
  return {
    found: false,
    reason: "NO_RUNTIME_CONTRACT: DNA-OS-BLUEPRINT is a separate repository with no document/claim index reachable from this one",
    source: "none",
  };
}
