/**
 * หน้าที่: the ONLY module outside this folder is allowed to import from —
 * the public contract of `control/conversation-read-model/`. `./store.ts`
 * (snapshot I/O) is private implementation.
 *
 * This folder is the HARD BOUNDARY between DNA OS Control/Execution
 * (`execution/run/`, `control/command-router/`, `control/agent-gateway/`)
 * and the Owner Conversation Layer (`control/owner-command-semantics/` and
 * any future read-only conversation component). It exists so the
 * conversation side never imports execution/control packages directly, not
 * even read-only (Owner UNLOCK, 2026-09-06 — see
 * `../../reports/CURRENT_CAPABILITY_MAP.md` for the narrow-projection round
 * that preceded this one).
 *
 * DIRECTION, no exceptions:
 *   producer (execution/run, command-router, agent-gateway)
 *     -> publish*() below (immutable/snapshot write)
 *     -> ./store.ts
 *     <- read*() below (read of what a producer already published)
 *   conversation consumer (owner-command-semantics, future ones)
 *
 * Input: re-exports only, plus every projection type a caller needs.
 * Output: `readCommandIdentities`, `readCapabilitySummaries`,
 * `readTaskStatusProjection`, `readTaskEvidenceProjection`,
 * `readSelfExplanationProjection`, `publishCommandIdentities`,
 * `publishCapabilitySummaries`, `publishTaskStatus`, `publishTaskEvidence`,
 * `publishSelfExplanationProjection` (Owner UNLOCK 2026-09-06,
 * PUBLISH_EXISTING_SELF_EXPLANATION_PROJECTIONS — fourth producer,
 * `./publish-self-explanation-projection.ts`, run standalone/on-demand,
 * never at server or conversation-request time).
 * Dependency ที่อนุญาต: ./store.ts, ./types.ts, node built-ins. Nothing
 * from `../../execution/`, `../command-router/`, or `../agent-gateway/` —
 * this folder must never import the packages it exists to separate from.
 * สิ่งที่ห้ามแตะ:
 * - ห้าม `control/owner-command-semantics/` (หรือ conversation component
 *   ใดๆ) เรียกฟังก์ชัน `publish*` — เรียกได้เฉพาะจากฝั่ง producer สามตัว
 *   ที่ระบุไว้ข้างบนเท่านั้น
 * - ห้าม publish ระหว่างการตอบคำถามของ conversation layer (publish-on-query)
 *   — publish เกิดขึ้นได้เฉพาะตอน producer เผยแพร่สถานะจริงของตัวเอง
 *   (registry snapshot ตอนโหลด, task/evidence ตอนบันทึกจริง)
 * - ห้ามเพิ่ม IPC หรือ network client ใดๆ ในไฟล์นี้หรือ ./store.ts — เป็น
 *   local snapshot file เท่านั้น
 * - ห้าม import กลับจากไฟล์นี้ไปยัง execution/control package ใดๆ
 */

import {
  appendProjectionRecord,
  readAllProjectionRecords,
  readLatestProjectionRecord,
  readSnapshot,
  snapshotFileExists,
  writeSnapshot,
} from "./store";
import type {
  CapabilityFolderLawMeasurement,
  CapabilitySummaryProjection,
  CommandIdentityProjection,
  SelfExplanationProjectionManifest,
  TaskEvidenceProjection,
  TaskStatusProjection,
} from "./types";

export type {
  CapabilityFolderLawMeasurement,
  CapabilitySummaryProjection,
  CommandIdentityProjection,
  SelfExplanationDuplicateFindingProjection,
  SelfExplanationEdgeProjection,
  SelfExplanationImpactProjection,
  SelfExplanationLineageProjection,
  SelfExplanationNodeProjection,
  SelfExplanationProjectionManifest,
  TaskEvidenceProjection,
  TaskEvidenceRowProjection,
  TaskStatusProjection,
} from "./types";

declare const require: any;

const crypto = require("node:crypto");

const COMMAND_IDENTITIES_FILE = "command-identities.json";
const CAPABILITY_SUMMARIES_FILE = "capability-summaries.json";
const TASK_STATUS_LOG = "task-status.jsonl";
const TASK_EVIDENCE_LOG = "task-evidence.jsonl";
const SELF_EXPLANATION_PROJECTION_FILE = "self-explanation-projection.json";
const CAPABILITY_FOLDER_LAW_MEASUREMENT_LOG = "capability-folder-law-measurements.jsonl";

/** How long a self-explanation snapshot may be read before it is treated as stale — see PUBLISH_EXISTING_SELF_EXPLANATION_PROJECTIONS PHASE 4. The producer script is meant to be re-run periodically/on demand, never per-request. */
const SELF_EXPLANATION_STALENESS_MS = 24 * 60 * 60 * 1000;

function hashNodes(nodes: SelfExplanationProjectionManifest["nodes"]): string {
  return crypto.createHash("sha256").update(JSON.stringify(nodes)).digest("hex");
}

// ---------------------------------------------------------------------------
// PRODUCER SIDE — call only from execution/run, command-router, agent-gateway
// ---------------------------------------------------------------------------

/** Producer: `execution/run/` only, at registry-load time. Whole-file snapshot. */
export function publishCommandIdentities(commandIds: readonly string[]): void {
  const projections: readonly CommandIdentityProjection[] = commandIds.map((command_id) => ({ command_id }));
  writeSnapshot(COMMAND_IDENTITIES_FILE, projections);
}

/** Producer: `control/command-router/` only, at registry-load time. Whole-file snapshot. */
export function publishCapabilitySummaries(summaries: readonly CapabilitySummaryProjection[]): void {
  writeSnapshot(CAPABILITY_SUMMARIES_FILE, summaries);
}

/** Producer: `control/agent-gateway/` only, at the moment it saves real task state. */
export function publishTaskStatus(projection: TaskStatusProjection): void {
  appendProjectionRecord(TASK_STATUS_LOG, projection);
}

/** Producer: `control/agent-gateway/` only, at the moment it saves real evidence. */
export function publishTaskEvidence(projection: TaskEvidenceProjection): void {
  appendProjectionRecord(TASK_EVIDENCE_LOG, projection);
}

/**
 * Producer: `./publish-self-explanation-projection.ts` ONLY (a script that
 * lives beside this boundary but is never imported by
 * `control/owner-command-semantics/` or `control/conversation-runtime/`) —
 * run manually or on a schedule, never at conversation-request time. Computes
 * `content_hash` itself so a caller cannot publish a manifest whose hash
 * does not match its own `nodes`.
 */
export function publishSelfExplanationProjection(nodes: SelfExplanationProjectionManifest["nodes"], sourceRevision: string | null): void {
  const manifest: SelfExplanationProjectionManifest = {
    generated_at: new Date().toISOString(),
    source_revision: sourceRevision,
    content_hash: hashNodes(nodes),
    nodes,
  };
  writeSnapshot(SELF_EXPLANATION_PROJECTION_FILE, manifest);
}

// ---------------------------------------------------------------------------
// CONSUMER SIDE — the only functions `owner-command-semantics/` may call
// ---------------------------------------------------------------------------

/**
 * PHASE 2F fail-closed check for consumers (Owner UNLOCK 2026-09-06): the
 * two static snapshots are published exactly once, at producer module load
 * (see `execution/run/registry.ts` and
 * `control/command-router/capability-registry.ts`). If NEITHER file has
 * ever been written, this boundary has never actually been fed — a
 * consumer must treat that as UNAVAILABLE, not silently read `[]` from
 * `readCommandIdentities()`/`readCapabilitySummaries()` and proceed as if
 * "no commands/capabilities are registered" were the real, current answer.
 */
export function isPublished(): boolean {
  return snapshotFileExists(COMMAND_IDENTITIES_FILE) && snapshotFileExists(CAPABILITY_SUMMARIES_FILE);
}

export function readCommandIdentities(): readonly CommandIdentityProjection[] {
  return readSnapshot<readonly CommandIdentityProjection[]>(COMMAND_IDENTITIES_FILE) ?? [];
}

export function readCapabilitySummaries(): readonly CapabilitySummaryProjection[] {
  return readSnapshot<readonly CapabilitySummaryProjection[]>(CAPABILITY_SUMMARIES_FILE) ?? [];
}

export function readTaskStatusProjection(taskId: string): TaskStatusProjection | null {
  return readLatestProjectionRecord<TaskStatusProjection & Record<string, unknown>>(TASK_STATUS_LOG, "task_id", taskId);
}

export function readTaskEvidenceProjection(taskId: string): TaskEvidenceProjection | null {
  return readLatestProjectionRecord<TaskEvidenceProjection & Record<string, unknown>>(TASK_EVIDENCE_LOG, "task_id", taskId);
}

export type SelfExplanationProjectionReadResult =
  | { status: "OK"; manifest: SelfExplanationProjectionManifest }
  | { status: "MISSING" | "MALFORMED" | "HASH_INVALID" | "STALE"; reason: string };

/**
 * PHASE 4 fail-closed read (PUBLISH_EXISTING_SELF_EXPLANATION_PROJECTIONS):
 * missing, malformed, hash-mismatched, or stale-beyond-policy all come back
 * as an explicit non-OK status — never a silently-empty `[]`/`null` that a
 * caller could mistake for "no self-explanation data exists". The caller
 * (`control/conversation-runtime/`) must never fall back to
 * machine-model/resource-reconciliation/agent-gateway/git/process
 * inspection on any of these — see that folder's own reader for the fail-
 * closed behavior this status drives.
 */
/**
 * Producer: `../../governance/source-validation/publish-capability-folder-law-measurement.ts`
 * ONLY, at the moment it runs the real gate — never at conversation-request
 * time. APPEND ONLY (Owner UNLOCK 2026-09-06,
 * PERSIST_FIRST_REAL_DNA_OS_MEASUREMENT): this calls `appendProjectionRecord`,
 * never `writeSnapshot` — every prior measurement stays on disk, unchanged,
 * forever.
 */
export function publishCapabilityFolderLawMeasurement(measurement: CapabilityFolderLawMeasurement): void {
  appendProjectionRecord(CAPABILITY_FOLDER_LAW_MEASUREMENT_LOG, measurement);
}

export function readSelfExplanationProjection(): SelfExplanationProjectionReadResult {
  const manifest = readSnapshot<SelfExplanationProjectionManifest>(SELF_EXPLANATION_PROJECTION_FILE);
  if (!manifest) return { status: "MISSING", reason: `no ${SELF_EXPLANATION_PROJECTION_FILE} has ever been published` };
  if (!Array.isArray(manifest.nodes) || typeof manifest.content_hash !== "string" || typeof manifest.generated_at !== "string") {
    return { status: "MALFORMED", reason: "self-explanation-projection.json is missing required fields" };
  }
  const recomputed = hashNodes(manifest.nodes);
  if (recomputed !== manifest.content_hash) {
    return { status: "HASH_INVALID", reason: `stored content_hash does not match a fresh hash of the stored nodes (stored=${manifest.content_hash}, recomputed=${recomputed})` };
  }
  const ageMs = Date.now() - new Date(manifest.generated_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs > SELF_EXPLANATION_STALENESS_MS) {
    return { status: "STALE", reason: `generated_at=${manifest.generated_at} is older than the ${SELF_EXPLANATION_STALENESS_MS}ms staleness policy` };
  }
  return { status: "OK", manifest };
}

// ---------------------------------------------------------------------------
// CAPABILITY_FOLDER_LAW_COMPLIANCE — read-only delta queries (PHASE 6/7)
// ---------------------------------------------------------------------------

export function allCapabilityFolderLawMeasurements(): readonly CapabilityFolderLawMeasurement[] {
  return readAllProjectionRecords<CapabilityFolderLawMeasurement>(CAPABILITY_FOLDER_LAW_MEASUREMENT_LOG);
}

export function latestCapabilityFolderLawMeasurement(): CapabilityFolderLawMeasurement | null {
  const all = allCapabilityFolderLawMeasurements();
  return all.length > 0 ? all[all.length - 1] : null;
}

export function previousCapabilityFolderLawMeasurement(): CapabilityFolderLawMeasurement | null {
  const all = allCapabilityFolderLawMeasurements();
  return all.length > 1 ? all[all.length - 2] : null;
}

export function capabilityFolderLawMeasurementById(measurementId: string): CapabilityFolderLawMeasurement | null {
  return allCapabilityFolderLawMeasurements().find((m) => m.measurement_id === measurementId) ?? null;
}

export interface CapabilityFolderLawMeasurementComparison {
  readonly a: CapabilityFolderLawMeasurement;
  readonly b: CapabilityFolderLawMeasurement;
  readonly subject_count_delta: number;
  readonly passed_count_delta: number;
  readonly failed_count_delta: number;
  /** `a.passed_count/a.subject_count` and `b`'s equivalent, as percentages rounded to 2 decimals — derived from the stored raw counts, never stored as the authoritative value itself. */
  readonly percent_a: number;
  readonly percent_b: number;
  readonly percent_delta: number;
  /** Only populated when both measurements' `evidence_refs` allow an exact set comparison — never a guess from the count delta alone (PHASE 7). */
  readonly newly_passing: readonly string[] | "UNKNOWN";
  readonly newly_failing: readonly string[] | "UNKNOWN";
}

function pct(passed: number, total: number): number {
  return total > 0 ? Math.round((passed / total) * 10000) / 100 : 0;
}

/** Pure comparison of two ALREADY-STORED measurements — no new gate run, no model inference. */
export function compareCapabilityFolderLawMeasurements(a: CapabilityFolderLawMeasurement, b: CapabilityFolderLawMeasurement): CapabilityFolderLawMeasurementComparison {
  const canDiffEvidence = Array.isArray(a.evidence_refs) && Array.isArray(b.evidence_refs);
  const aFailing = canDiffEvidence ? new Set(a.evidence_refs) : null;
  const bFailing = canDiffEvidence ? new Set(b.evidence_refs) : null;
  return {
    a,
    b,
    subject_count_delta: b.subject_count - a.subject_count,
    passed_count_delta: b.passed_count - a.passed_count,
    failed_count_delta: b.failed_count - a.failed_count,
    percent_a: pct(a.passed_count, a.subject_count),
    percent_b: pct(b.passed_count, b.subject_count),
    percent_delta: pct(b.passed_count, b.subject_count) - pct(a.passed_count, a.subject_count),
    newly_passing: aFailing && bFailing ? [...aFailing].filter((ref) => !bFailing.has(ref)) : "UNKNOWN",
    newly_failing: aFailing && bFailing ? [...bFailing].filter((ref) => !aFailing.has(ref)) : "UNKNOWN",
  };
}
