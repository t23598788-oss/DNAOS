/**
 * Common immutable provenance contract for a future trusted verifier adapter.
 *
 * This records the lineage a future Decision will carry; it does not create a
 * Decision, authorize a caller, invoke a verifier, or establish freshness.
 */

import { createHash } from "node:crypto";
import type { VerifierContractIdentity } from "./verification-authority-binding";
import type { TrustedEmissionBoundaryDeclarationV1 } from "./trusted-emission-boundary";
export { computeDecisionFingerprint } from "./verification-decision";

export const VERIFICATION_PRODUCER_PROVENANCE_SCHEMA_VERSION = "VERIFICATION_PRODUCER_PROVENANCE_V1" as const;

export interface VerificationProducerProvenanceV1 {
  readonly producer_identity: string;
  readonly authority_binding_id: string;
  readonly binding_version: string;
  readonly verifier_contract_identity: VerifierContractIdentity;
  readonly verifier_result_fingerprint: string;
  readonly decision_fingerprint: string;
  readonly emission_boundary_identity: Pick<TrustedEmissionBoundaryDeclarationV1, "boundary_id" | "boundary_version" | "semantic_digest">;
}

export interface ProvenanceValidationResult {
  readonly valid: boolean;
  readonly reason: string;
}

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as JsonValue)}`).join(",")}}`;
}

/**
 * Fingerprints the exact semantic result representation supplied by the
 * verifier boundary. This generic primitive does not guess which fields are
 * semantic; the caller must pass the result contract's semantic value.
 */
export function canonicalResultBytes(result: JsonValue): string {
  return canonicalize(result);
}

export function computeVerifierResultFingerprint(result: JsonValue): string {
  return createHash("sha256").update(canonicalResultBytes(result), "utf8").digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

/** Freezes a record; it does not grant trust or validate caller authority. */
export function freezeVerificationProducerProvenance(provenance: VerificationProducerProvenanceV1): Readonly<VerificationProducerProvenanceV1> {
  return deepFreeze(provenance);
}

const SHA256 = /^[0-9a-f]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export function validateVerificationProducerProvenance(provenance: unknown): ProvenanceValidationResult {
  if (!isObject(provenance)) return { valid: false, reason: "provenance must be an object" };
  const requiredStrings = ["producer_identity", "authority_binding_id"] as const;
  for (const field of requiredStrings) {
    if (typeof provenance[field] !== "string" || provenance[field].trim().length === 0) return { valid: false, reason: `missing required provenance field: ${field}` };
  }
  if (typeof provenance.binding_version !== "string" || !SEMVER.test(provenance.binding_version)) return { valid: false, reason: "invalid binding_version" };
  for (const field of ["authority_binding_id", "verifier_result_fingerprint", "decision_fingerprint"] as const) {
    if (typeof provenance[field] !== "string" || !SHA256.test(provenance[field])) return { valid: false, reason: `invalid fingerprint: ${field}` };
  }
  const boundary = provenance.emission_boundary_identity;
  if (!isObject(boundary) || typeof boundary.boundary_id !== "string" || boundary.boundary_id.trim().length === 0 || typeof boundary.boundary_version !== "string" || !SEMVER.test(boundary.boundary_version) || typeof boundary.semantic_digest !== "string" || !SHA256.test(boundary.semantic_digest)) return { valid: false, reason: "invalid emission_boundary_identity" };
  const contract = provenance.verifier_contract_identity;
  if (!isObject(contract) || typeof contract.verifier_contract_id !== "string" || contract.verifier_contract_id.trim().length === 0 || typeof contract.contract_version !== "string" || !SEMVER.test(contract.contract_version) || typeof contract.semantic_digest !== "string" || !SHA256.test(contract.semantic_digest)) return { valid: false, reason: "invalid verifier_contract_identity" };
  return { valid: true, reason: "valid immutable producer provenance shape" };
}
