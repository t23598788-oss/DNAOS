/**
 * หน้าที่: the real, minimal receiver for `contracts/worker/finding-event.ts`'s
 * `FindingEvent` — Owner, 2026-08-18: "Infrastructure receives the
 * FindingEvent and records evidence that it arrived... Circuit must NOT
 * create a WorkRequest yet." This file does exactly that and nothing
 * more: validate the shape loosely (never trust an external caller's
 * JSON blindly), store it with a real received_at timestamp, and make it
 * listable — no routing, no capability resolution, no WorkRequest.
 *
 * Storage is in-memory (this process's lifetime) PLUS an append-only real
 * evidence file on disk (`./findings-evidence.json`, this folder), so
 * "evidence that it arrived" survives a server restart — same durability
 * pattern DNA-LAB-FILE-INTELLIGENCE's own `reports/scanHistory.ts` uses
 * on the sending side this same round.
 *
 * Input: an unknown JSON value (the real HTTP request body from
 * `POST /findings`).
 * Output: `ReceivedFinding`, `recordFinding`, `listFindings`,
 * `listPersistedFindings`, `applyEvaluation` (real DETECTED -> EVALUATED
 * transition, ./finding-evaluator.ts), `applyDecision` (real EVALUATED
 * -> ROUTABLE/BLOCKED/RESOLVED transition, ./finding-decider.ts, both
 * added 2026-08-18).
 * Dependency ที่อนุญาต: `../../contracts/worker/finding-event.ts` (type
 * only), `./host-runtime.ts`.
 * สิ่งที่ห้ามแตะ: never construct or return a `WorkRequest` from this
 * file — that is explicitly out of scope this round (Owner: "No AI
 * worker. No code modification automation. No Gateway."). Never trust
 * `capability_id`/`severity` from an inbound payload if they are
 * anything other than `null` — File Intelligence has no authority to
 * assert either (see finding-event.ts's own rule); a non-null value in
 * either field on arrival is corrected to `null` here rather than
 * trusted, not silently accepted.
 */

import type { FindingEvent } from "../../contracts/worker/finding-event";
import { hostRandomId, readFileUtf8, writeFileUtf8, fileExists, joinPath, repoRootDirname } from "./host-runtime";

export interface ReceivedFinding {
  finding: FindingEvent;
  received_at: string;
  receiver_evidence_id: string;
}

const EVIDENCE_FILE_RELATIVE = "dna-os-circuit/runtime/findings-evidence.json";

const inMemoryFindings: ReceivedFinding[] = [];

function evidenceFilePath(): string {
  return joinPath(repoRootDirname(), EVIDENCE_FILE_RELATIVE);
}

function loadPersistedFindings(): ReceivedFinding[] {
  const p = evidenceFilePath();
  if (!fileExists(p)) return [];
  try {
    const parsed = JSON.parse(readFileUtf8(p));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupt evidence file must never crash the receiver — start fresh in memory, never overwrite the bad file blindly.
    return [];
  }
}

function persistFindings(all: ReceivedFinding[]): void {
  writeFileUtf8(evidenceFilePath(), JSON.stringify(all, null, 2));
}

/** True only if `value` has every field this receiver actually reads — a loose structural check, not full schema validation (out of scope this round), but enough to refuse an obviously-malformed body rather than store garbage. */
function looksLikeFindingEvent(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.finding_id === "string" &&
    typeof v.source_system === "string" &&
    typeof v.scan_id === "string" &&
    typeof v.warning_type === "string" &&
    Array.isArray(v.evidence) &&
    typeof v.owner_folder === "string" &&
    Array.isArray(v.files_involved) &&
    typeof v.detected_at === "string" &&
    typeof v.classification === "string" &&
    typeof v.status === "string"
  );
}

export type RecordFindingOutcome = { ok: true; received: ReceivedFinding } | { ok: false; reason: string };

/**
 * Validates loosely, corrects `capability_id`/`severity` to `null` if the
 * sender asserted otherwise (never trusted from an external system — see
 * this file's header), stores in memory, and appends to the real evidence
 * file. Never throws.
 */
export function recordFinding(rawBody: unknown): RecordFindingOutcome {
  if (!looksLikeFindingEvent(rawBody)) {
    return { ok: false, reason: "payload does not match the minimum FindingEvent shape (missing/mistyped required field)" };
  }
  const raw = rawBody as Record<string, unknown>;

  const finding: FindingEvent = {
    finding_id: raw.finding_id as string,
    source_system: raw.source_system as string,
    scan_id: raw.scan_id as string,
    warning_type: raw.warning_type as FindingEvent["warning_type"],
    evidence: raw.evidence as readonly string[],
    owner_folder: raw.owner_folder as string,
    // Never trusted from the sender — see this file's header. File Intelligence
    // itself always sends null for both (per finding-event.ts's own rule); this
    // is the enforcement point that makes that a guarantee, not just a convention.
    capability_id: null,
    files_involved: raw.files_involved as readonly string[],
    detected_at: raw.detected_at as string,
    severity: null,
    classification: raw.classification as FindingEvent["classification"],
    status: raw.status as FindingEvent["status"],
  };

  const received: ReceivedFinding = {
    finding,
    received_at: new Date().toISOString(),
    receiver_evidence_id: `recv-${hostRandomId()}`,
  };

  inMemoryFindings.push(received);
  const all = [...loadPersistedFindings(), received];
  persistFindings(all);

  return { ok: true, received };
}

/** Every finding this process has received since it started, most recent last. Does not include findings persisted by a PRIOR process run unless explicitly reloaded — see loadPersistedFindings for the durable copy. */
export function listFindings(): readonly ReceivedFinding[] {
  return inMemoryFindings;
}

/** Reads the full durable evidence file from disk, including findings received by a prior process run — used by GET /findings so "Circuit can show RECEIVED/DETECTED state" survives a restart, not just this process's own memory. This is the AUTHORITATIVE store — recordFinding and applyEvaluation both read-modify-write through it. */
export function listPersistedFindings(): readonly ReceivedFinding[] {
  return loadPersistedFindings();
}

export type ApplyEvaluationOutcome = { ok: true; received: ReceivedFinding } | { ok: false; reason: string };

/**
 * Used by ./finding-evaluator.ts only — updates ONE finding's
 * `classification`/`status` in place (a real status transition on an
 * existing record, not a new record). Operates on the authoritative
 * disk-backed store (same one `GET /findings` reads), so an evaluation
 * result is visible immediately, and keeps the in-memory cache in sync
 * too. Returns `ok:false` rather than throwing if `finding_id` is
 * unknown — never silently create a finding here.
 */
export function applyEvaluation(finding_id: string, classification: FindingEvent["classification"], newStatus: FindingEvent["status"]): ApplyEvaluationOutcome {
  const all = loadPersistedFindings();
  const idx = all.findIndex((r) => r.finding.finding_id === finding_id);
  if (idx === -1) {
    return { ok: false, reason: `no finding with finding_id "${finding_id}" is known to this receiver` };
  }
  const updated: ReceivedFinding = { ...all[idx], finding: { ...all[idx].finding, classification, status: newStatus } };
  all[idx] = updated;
  persistFindings(all);

  const memIdx = inMemoryFindings.findIndex((r) => r.finding.finding_id === finding_id);
  if (memIdx !== -1) inMemoryFindings[memIdx] = updated;

  return { ok: true, received: updated };
}

/**
 * Used by ./finding-decider.ts only — updates ONE finding's `status`
 * only (never `classification`, which is EVALUATED's own concern, not
 * DECISION's). Same authoritative-store + in-memory-sync pattern as
 * applyEvaluation.
 */
export function applyDecision(finding_id: string, newStatus: FindingEvent["status"]): ApplyEvaluationOutcome {
  const all = loadPersistedFindings();
  const idx = all.findIndex((r) => r.finding.finding_id === finding_id);
  if (idx === -1) {
    return { ok: false, reason: `no finding with finding_id "${finding_id}" is known to this receiver` };
  }
  const updated: ReceivedFinding = { ...all[idx], finding: { ...all[idx].finding, status: newStatus } };
  all[idx] = updated;
  persistFindings(all);

  const memIdx = inMemoryFindings.findIndex((r) => r.finding.finding_id === finding_id);
  if (memIdx !== -1) inMemoryFindings[memIdx] = updated;

  return { ok: true, received: updated };
}
