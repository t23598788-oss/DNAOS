/** Common immutable decision contract for verifier adapters. */

import { createHash } from "node:crypto";

export const VERIFICATION_DECISION_SCHEMA_VERSION = "VERIFICATION_DECISION_V1" as const;

export type DecisionJsonValue = string | number | boolean | null | readonly DecisionJsonValue[] | { readonly [key: string]: DecisionJsonValue };

export interface VerificationDecisionV1 {
  readonly decision_id: string;
  readonly decision_class: string;
  readonly subject: DecisionJsonValue;
  readonly scope: DecisionJsonValue;
  readonly proposition: DecisionJsonValue;
  readonly verdict: string;
  readonly evidence_refs: readonly string[];
  readonly freshness: DecisionJsonValue;
  readonly authority: DecisionJsonValue;
  readonly decided_at: string;
  readonly decision_fingerprint: string;
}

export type VerificationDecisionSemanticInput = Omit<VerificationDecisionV1, "decision_id" | "decision_fingerprint" | "decided_at">;

function canonicalize(value: DecisionJsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.keys(value as Record<string, DecisionJsonValue>).sort().map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, DecisionJsonValue>)[key])}`);
  return `{${entries.join(",")}}`;
}

/** Identity is derived only from decision semantics; timestamps are excluded. */
export function decisionSemanticBytes(input: VerificationDecisionSemanticInput): string {
  return canonicalize(input);
}

export function computeDecisionFingerprint(input: DecisionJsonValue): string {
  return createHash("sha256").update(canonicalize(input), "utf8").digest("hex");
}

export function computeDecisionId(input: VerificationDecisionSemanticInput): string {
  return `decision-${computeDecisionFingerprint(input)}`;
}

export function createVerificationDecision(input: VerificationDecisionSemanticInput, decidedAt = new Date().toISOString()): VerificationDecisionV1 {
  const fingerprint = computeDecisionFingerprint(input);
  return {
    decision_id: `decision-${fingerprint}`,
    ...input,
    decided_at: decidedAt,
    decision_fingerprint: fingerprint,
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

export function freezeVerificationDecision(decision: VerificationDecisionV1): Readonly<VerificationDecisionV1> {
  return deepFreeze(decision);
}

export function validateVerificationDecision(decision: unknown): { valid: boolean; reason: string } {
  if (typeof decision !== "object" || decision === null || Array.isArray(decision)) return { valid: false, reason: "decision must be an object" };
  const value = decision as Record<string, unknown>;
  for (const field of ["decision_id", "decision_class", "verdict", "decided_at", "decision_fingerprint"] as const) {
    if (typeof value[field] !== "string" || value[field].trim().length === 0) return { valid: false, reason: `missing required decision field: ${field}` };
  }
  if (!Array.isArray(value.evidence_refs) || !value.evidence_refs.every((ref) => typeof ref === "string" && ref.length > 0)) return { valid: false, reason: "invalid evidence_refs" };
  if (typeof value.decision_fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(value.decision_fingerprint)) return { valid: false, reason: "invalid decision_fingerprint" };
  const { decision_id, decision_fingerprint, decided_at, ...semantic } = value;
  const expected = computeDecisionFingerprint(semantic as VerificationDecisionSemanticInput);
  if (expected !== decision_fingerprint || decision_id !== `decision-${expected}`) return { valid: false, reason: "decision identity does not match semantic material" };
  return { valid: true, reason: "valid immutable verification decision" };
}
