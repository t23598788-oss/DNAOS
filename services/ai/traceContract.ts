/**
 * DNA OS — Unified AI Trace & Response Verification (2026-10-20).
 *
 * Pure rules, no I/O and no imports, so the Deno mirror
 * (supabase/functions/_shared/ai/traceContract.ts) can be identical.
 *
 * Authority split (non-negotiable):
 *   - The AI layer only produces text. It never proves that a business
 *     transaction happened.
 *   - Only the Canonical Engine's own result (its ok flag and its record id)
 *     can establish that an outcome is real. This module verifies that result;
 *     it never creates one.
 *   - A response that claims a business outcome without verified canonical
 *     evidence is BLOCKED, and the block carries the trace id.
 */

export const TRACE_BLOCK_CODES = [
  "CANONICAL_EVIDENCE_MISSING",
  "CANONICAL_NOT_OK",
  "CANONICAL_TRACE_MISMATCH",
  "CANONICAL_CROSS_TENANT",
  "AI_SCHEMA_BLOCKED",
  "AI_EVIDENCE_MISSING",
] as const;
export type TraceBlockCode = (typeof TRACE_BLOCK_CODES)[number];

/** Three distinct identifiers, never merged:
 *  traceId          — one business request, across every hop (caller -> gateway -> adapter -> canonical -> response)
 *  requestId        — one gateway invocation
 *  providerRequestId — the id the provider/transport returned for its own call, when it returns one (null when not) */
export interface AiTraceIds {
  traceId: string;
  requestId: string;
  providerRequestId: string | null;
}

/** Data provenance — recorded from real evidence only. Never a guess. */
export interface AiDataProvenance {
  providerId: string | null;
  modelId: string | null;
  capability: string;
  runtime: string;
  /** Owner the data belongs to (tenant/company). */
  ownerId: string;
  /** Sources the model read (e.g. LINE message ids). Empty when none were supplied. */
  sourceRefs: string[];
  /** Who authorised this AI execution. null when no authorisation was recorded. */
  authorizedBy: string | null;
  updatedAt: string;
  /** Evidence row reference (evidence id / request id). null when evidence was not recorded. */
  evidenceRef: string | null;
  /** VERIFIED only when a canonical outcome confirmed it. Otherwise UNVERIFIED. */
  verification: "VERIFIED" | "UNVERIFIED";
}

/** What a canonical writer returns, normalised by the caller. The writer is the
 *  authority; this shape only carries what it said. */
export interface CanonicalOutcome {
  ok: boolean;
  recordId: string | null;
  /** Owner of the record the writer touched. */
  ownerId: string | null;
  /** Trace id the writer was called with, when the writer echoes it. */
  traceId: string | null;
  error?: string;
}

export type CanonicalVerdict =
  | { ok: true; recordId: string }
  | { ok: false; code: TraceBlockCode; reason: string };

/** Verify a canonical outcome against the request that produced it. */
export function verifyCanonicalOutcome(
  outcome: CanonicalOutcome | null | undefined,
  expected: { traceId: string; ownerId: string },
): CanonicalVerdict {
  if (!outcome) return { ok: false, code: "CANONICAL_EVIDENCE_MISSING", reason: "no canonical result was returned" };
  if (!outcome.ok) return { ok: false, code: "CANONICAL_NOT_OK", reason: outcome.error ?? "canonical writer reported failure" };
  if (!outcome.recordId) return { ok: false, code: "CANONICAL_EVIDENCE_MISSING", reason: "canonical result has no record id" };
  if (outcome.traceId !== expected.traceId) {
    return { ok: false, code: "CANONICAL_TRACE_MISMATCH", reason: "canonical result belongs to a different trace" };
  }
  if (outcome.ownerId !== expected.ownerId) {
    return { ok: false, code: "CANONICAL_CROSS_TENANT", reason: "canonical record belongs to a different owner" };
  }
  return { ok: true, recordId: outcome.recordId };
}

export interface ResponseGateInput {
  traceId: string;
  ownerId: string;
  /** The business result is schema-valid (validators in businessSchema). */
  schemaValid: boolean;
  /** Gateway recorded its evidence row. */
  evidenceRecorded: boolean;
  /** true when the response says something happened (booked, paid, saved, issued). */
  claimsOutcome: boolean;
  canonical?: CanonicalOutcome | null;
}

export type ResponseGateDecision =
  | { allowed: true; traceId: string; verification: "VERIFIED" | "UNVERIFIED"; recordId: string | null }
  | { allowed: false; traceId: string; code: TraceBlockCode; reason: string; verification: "UNVERIFIED"; recordId: null };

/** Single decision point before any text reaches a user. Order is fixed so the
 *  first failing check is always the reported one. */
export function gateResponse(input: ResponseGateInput): ResponseGateDecision {
  const block = (code: TraceBlockCode, reason: string): ResponseGateDecision => ({
    allowed: false, traceId: input.traceId, code, reason, verification: "UNVERIFIED", recordId: null,
  });
  if (!input.evidenceRecorded) return block("AI_EVIDENCE_MISSING", "AI evidence was not recorded for this trace");
  if (!input.schemaValid) return block("AI_SCHEMA_BLOCKED", "AI output failed the business schema");
  if (!input.claimsOutcome) {
    // Pure answer or draft: nothing is claimed as done, so nothing needs canonical proof.
    return { allowed: true, traceId: input.traceId, verification: "UNVERIFIED", recordId: null };
  }
  const verdict = verifyCanonicalOutcome(input.canonical, { traceId: input.traceId, ownerId: input.ownerId });
  if (!verdict.ok) return block(verdict.code, verdict.reason);
  return { allowed: true, traceId: input.traceId, verification: "VERIFIED", recordId: verdict.recordId };
}

/** Release text only when the gate allowed it. A blocked decision yields null. */
export function releaseResponse(text: string, decision: ResponseGateDecision): string | null {
  return decision.allowed ? text : null;
}

/** Build provenance from real values only. Unknown stays null, and anything
 *  not confirmed by canonical evidence stays UNVERIFIED. */
export function buildDataProvenance(input: {
  providerId: string | null;
  modelId: string | null;
  capability: string;
  runtime: string;
  ownerId: string;
  sourceRefs: string[];
  authorizedBy?: string | null;
  updatedAt: string;
  evidenceRef: string | null;
  canonicalVerified: boolean;
}): AiDataProvenance {
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    capability: input.capability,
    runtime: input.runtime,
    ownerId: input.ownerId,
    sourceRefs: [...input.sourceRefs],
    authorizedBy: input.authorizedBy ?? null,
    updatedAt: input.updatedAt,
    evidenceRef: input.evidenceRef,
    verification: input.canonicalVerified && input.evidenceRef !== null ? "VERIFIED" : "UNVERIFIED",
  };
}

/** Trace id: reuse the caller's id when it is a non-empty string, otherwise mint one. */
export function ensureTraceId(supplied: string | undefined, mint: () => string): string {
  const trimmed = supplied?.trim();
  return trimmed ? trimmed : mint();
}

// ---------------------------------------------------------------------------
// Pre-write safety gate (2026-10-20). Runs BEFORE any canonical writer is called.
// A failed check means the writer is never invoked: no partial write, no retry.
// ---------------------------------------------------------------------------

export const PREWRITE_BLOCK_CODES = [
  "PREWRITE_TRACE_MISSING",
  "PREWRITE_UNAUTHENTICATED",
  "PREWRITE_TENANT_MISMATCH",
  "PREWRITE_INVALID_INPUT",
  "PREWRITE_EVIDENCE_MISSING",
  "PREWRITE_DUPLICATE",
] as const;
export type PreWriteBlockCode = (typeof PREWRITE_BLOCK_CODES)[number];

export interface PreWriteInput {
  traceId: string;
  /** Identity established by the server session. null = no session. */
  authenticatedOwner: string | null;
  /** Owner the write is requested for. Must equal the authenticated owner. */
  requestOwner: string;
  /** Schema validation of the AI output passed (businessSchema). */
  schemaValid: boolean;
  /** Source messages/records the write is based on. Empty = no evidence. */
  sourceRefs: string[];
  /** Source refs already attached to an existing record (create path). */
  alreadyLinkedRefs: string[];
  /** Business status the write would set. */
  status: string;
  allowedStatuses: readonly string[];
}

export type PreWriteDecision =
  | { ok: true }
  | { ok: false; code: PreWriteBlockCode; reason: string };

/** Pure decision. Order is fixed so the first failing check is the reported one. */
export function preWriteCheck(input: PreWriteInput): PreWriteDecision {
  const block = (code: PreWriteBlockCode, reason: string): PreWriteDecision => ({ ok: false, code, reason });
  if (!input.traceId || !input.traceId.trim()) return block("PREWRITE_TRACE_MISSING", "write has no trace id");
  if (!input.authenticatedOwner || !input.authenticatedOwner.trim()) return block("PREWRITE_UNAUTHENTICATED", "no authenticated owner");
  if (input.requestOwner !== input.authenticatedOwner) return block("PREWRITE_TENANT_MISMATCH", "request owner differs from authenticated owner");
  if (!input.schemaValid) return block("PREWRITE_INVALID_INPUT", "AI output failed the business schema");
  if (!(input.allowedStatuses as readonly string[]).includes(input.status)) return block("PREWRITE_INVALID_INPUT", `status not allowed: ${input.status}`);
  if (input.sourceRefs.length === 0) return block("PREWRITE_EVIDENCE_MISSING", "write has no source evidence");
  if (input.alreadyLinkedRefs.some((r) => input.sourceRefs.includes(r))) return block("PREWRITE_DUPLICATE", "source already linked to a record");
  return { ok: true };
}

/** Result of one canonical write attempt, as the writer reported it. */
export interface WriteAttempt {
  /** The writer returned ok with a record id. */
  writerOk: boolean;
  recordId: string | null;
  writerError?: string;
}

/** What the business can truthfully say about a write.
 *  CONFIRMED   — writer ok AND readback proves record + trace + owner.
 *  UNCONFIRMED — writer ok but readback failed or does not prove the record. Not a success, not a failure.
 *  FAILED      — writer reported an error. Nothing is claimed.
 *  Never ROLLED_BACK: nothing in this layer can prove a rollback. */
export type TransactionStatus = "CONFIRMED" | "UNCONFIRMED" | "FAILED";

export interface ReadbackRow {
  id: string;
  ownerId: string | null;
  traceId: string | null;
} 

export function classifyWriteOutcome(input: {
  attempt: WriteAttempt;
  readback: ReadbackRow | null;
  readbackError?: string | null;
  expected: { traceId: string; ownerId: string };
}): { status: TransactionStatus; recordId: string | null; reason: string } {
  const { attempt, readback, expected } = input;
  if (!attempt.writerOk) {
    return { status: "FAILED", recordId: null, reason: attempt.writerError ?? "canonical writer reported failure" };
  }
  if (!attempt.recordId) {
    return { status: "UNCONFIRMED", recordId: null, reason: "writer ok but returned no record id" };
  }
  if (input.readbackError || !readback) {
    return { status: "UNCONFIRMED", recordId: attempt.recordId, reason: input.readbackError ?? "readback returned no row" };
  }
  if (readback.id !== attempt.recordId) {
    return { status: "UNCONFIRMED", recordId: attempt.recordId, reason: "readback id differs from written id" };
  }
  if (readback.traceId !== expected.traceId) {
    return { status: "UNCONFIRMED", recordId: attempt.recordId, reason: "readback trace differs from request trace" };
  }
  if (readback.ownerId !== expected.ownerId) {
    return { status: "UNCONFIRMED", recordId: attempt.recordId, reason: "readback owner differs from request owner" };
  }
  return { status: "CONFIRMED", recordId: attempt.recordId, reason: "readback matches record, trace and owner" };
}

/** Map a block/verification code to the HTTP status a route must return. */
export function httpStatusForCode(code: string): number {
  if (code === "PREWRITE_UNAUTHENTICATED") return 401;
  if (code === "PREWRITE_TENANT_MISMATCH" || code === "CANONICAL_CROSS_TENANT") return 403;
  if (code === "PREWRITE_DUPLICATE" || code === "UNCONFIRMED" || code === "CANONICAL_TRACE_MISMATCH") return 409;
  if (code === "PREWRITE_INVALID_INPUT" || code === "PREWRITE_EVIDENCE_MISSING" || code === "PREWRITE_TRACE_MISSING") return 422;
  return 500;
}

/** Run a write only if the pre-write gate passes. The writer is NOT called on a block. */
export async function guardedWrite<T>(
  gate: PreWriteInput,
  writer: () => Promise<T>,
): Promise<{ written: true; value: T } | { written: false; code: PreWriteBlockCode; reason: string }> {
  const decision = preWriteCheck(gate);
  if (!decision.ok) return { written: false, code: decision.code, reason: decision.reason };
  return { written: true, value: await writer() };
}
