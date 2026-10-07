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
 * `../conversation-read-model/contract.ts` (read-only side only — never
 * `publish*`), ./types.ts, node built-ins. Never `../agent-gateway/`
 * directly (Owner UNLOCK, 2026-09-06 — task/evidence reads go through
 * `../conversation-read-model/`'s published projections instead, see that
 * folder's `contract.ts` for the boundary).
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเขียนลง store ใดๆ จากไฟล์นี้.
 * - ห้ามคืน found:true โดยไม่มี source ที่ตรวจสอบได้.
 * - ห้ามสังเคราะห์ค่าที่หาไม่เจอ — a missing document index must report that it
 *   is missing, not return an empty list that reads like "nothing matched".
 */

declare const require: any;
declare const process: { cwd(): string };

import type { Provenance, ReadOnlyKnowledgeMatch } from "./types";
import { findCapability } from "../../software/registry-database/contract";
import type { ReadOnlyRegistryView } from "./read-only-registry-view";
import { readTaskEvidenceProjection, readTaskStatusProjection } from "../conversation-read-model/contract";

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
export function readEvidenceForCapability(capabilityId: string, store: ReadOnlyRegistryView | undefined): ReadResult<readonly string[]> {
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
  const source = "control/conversation-read-model/contract.ts#readTaskEvidenceProjection";
  const projection = readTaskEvidenceProjection(taskId);
  if (!projection || projection.rows.length === 0) return { found: false, reason: `no evidence rows for task_id "${taskId}"`, source };
  return {
    found: true,
    value: projection.rows,
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
  const source = "control/conversation-read-model/contract.ts#readTaskStatusProjection";
  const projection = readTaskStatusProjection(taskId);
  if (!projection) return { found: false, reason: `task_id "${taskId}" is not in the published task-status projection`, source };
  return {
    found: true,
    value: projection,
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
  /**
   * Added (Owner UNLOCK 2026-09-06, BUILD_SELF_WORK_LEDGER_V1) on RESOLUTION
   * records only — the model's one-phrase reading of what the Owner wanted,
   * and everything this resolver could NOT prove, kept apart exactly as
   * `StructuredOwnerContext` keeps them. A self-work ledger built from this
   * history needs to know not just what resolved, but why something did not
   * — a `resolved_capability_ids: []` alone cannot distinguish "no capability
   * exists for this" from "a capability exists but no command matches" from
   * "a relationship never resolved". Records from before this field existed
   * carry none of it — a ledger reading an old record reports those fields
   * `UNKNOWN`, never guesses them retroactively.
   */
  intent?: string;
  resolved_state?: "RESOLVED" | "UNRESOLVED" | "NO_REFERENCES";
  unresolved_refs?: readonly { kind: string; mention: string; evidence_refs: readonly string[] }[];
  relationship_query_status?: string | null;
}

// `process.cwd()`, not `__dirname` — see control/conversation-read-model/store.ts's
// header for why (this file also compiles into control/conversation-runtime/dist/).
export const HISTORY_FILE: string = path.join(process.cwd(), "control/owner-command-semantics/data", "semantic-history.jsonl");

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
// QUERY -> REGISTERED KNOWLEDGE RECORD / KNOWLEDGE RESULT
// ---------------------------------------------------------------------------

const OWNER_COMMAND_DISPLAY_HISTORY = "OWNER_COMMAND_DISPLAY_HISTORY";
const OWNER_COMMAND_DISPLAY_HISTORY_SOURCE = "governance/system-knowledge/owner-command-display-history.knowledge.json";

function normalizeKnowledgeQuestion(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Reads one exact, already-registered knowledge record. The registry lookup is
 * the gate: this function never searches repositories or scans source files.
 * After the canonical capability points at the known source_location, only
 * that one registered JSON record is read. A question must match one of the
 * record's explicit match_exact phrases; otherwise it stays unresolved.
 */
export function readOwnerCommandDisplayHistory(rawText: string, store: ReadOnlyRegistryView | undefined): ReadResult<ReadOnlyKnowledgeMatch> {
  const source = `software/registry-database#canonical_name:${OWNER_COMMAND_DISPLAY_HISTORY}`;
  if (!store) return { found: false, reason: "no registry store was provided to this knowledge read", source };

  const registered = findCapability({ canonical_name: OWNER_COMMAND_DISPLAY_HISTORY }, store);
  if (!registered) return { found: false, reason: `knowledge capability "${OWNER_COMMAND_DISPLAY_HISTORY}" is not registered`, source };

  const resourceId = registered.resource_ids.find((id) => id.length > 0) ?? null;
  const sourceLocation = registered.source_location.find((location) => location === OWNER_COMMAND_DISPLAY_HISTORY_SOURCE);
  if (!sourceLocation) return { found: false, reason: `registered knowledge has no exact source_location "${OWNER_COMMAND_DISPLAY_HISTORY_SOURCE}"`, source };

  const repoRoot = process.cwd();
  const knowledgePath = path.resolve(repoRoot, sourceLocation);
  if (!knowledgePath.startsWith(`${repoRoot}${path.sep}`)) return { found: false, reason: "registered knowledge source escaped the infrastructure repository", source };

  let record: { record_id?: unknown; READBACK_INDEX?: unknown };
  try { record = JSON.parse(String(fs.readFileSync(knowledgePath, "utf8"))) as typeof record; }
  catch { return { found: false, reason: `registered knowledge record could not be read: ${sourceLocation}`, source };
  }

  const readback = record.READBACK_INDEX;
  if (!readback || typeof readback !== "object" || Array.isArray(readback)) {
    return { found: false, reason: `registered knowledge record has no READBACK_INDEX: ${sourceLocation}`, source };
  }
  const question = normalizeKnowledgeQuestion(rawText);
  for (const [key, value] of Object.entries(readback as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as { match_exact?: unknown; owner_reply_th?: unknown };
    const aliases = Array.isArray(item.match_exact) ? item.match_exact.filter((alias): alias is string => typeof alias === "string").map(normalizeKnowledgeQuestion) : [];
    const answer = typeof item.owner_reply_th === "string" ? item.owner_reply_th.trim() : "";
    if (answer !== "" && aliases.includes(question)) {
      return {
        found: true,
        value: {
          knowledge_id: `${String(record.record_id ?? OWNER_COMMAND_DISPLAY_HISTORY)}.${key}`,
          matched_query: rawText,
          owner_reply_th: answer,
          registry_capability_id: registered.capability_id,
          registry_resource_id: resourceId,
          source: sourceLocation,
          evidence_refs: [sourceLocation, `software/registry-database#${registered.capability_id}`],
        },
        provenance: "REGISTRY",
        source: `${source}#${key}`,
      };
    }
  }
  return { found: false, reason: `no exact registered readback question matched`, source };
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
