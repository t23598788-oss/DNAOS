/**
 * Common semantic contract for immutable verifier-authority bindings.
 *
 * This is authorization identity only. It does not execute a verifier, carry
 * a decision/result, resolve a caller, or make a freshness claim.
 */

import { createHash } from "node:crypto";

export const VERIFICATION_AUTHORITY_BINDING_SCHEMA_VERSION = "VERIFICATION_AUTHORITY_BINDING_V1" as const;

export interface VerifierContractIdentity {
  verifier_contract_id: string;
  contract_version: string;
  semantic_digest: string;
}

export interface VerificationAuthorityBindingV1 {
  schema_version: typeof VERIFICATION_AUTHORITY_BINDING_SCHEMA_VERSION;
  binding_id: string;
  decision_class: string;
  proposition_kind: string;
  authority_identity_type: "REGISTERED_CAPABILITY";
  authority_id: string;
  verifier_contract_identity: VerifierContractIdentity;
  binding_version: string;
  binding_evidence_refs: readonly string[];
}

export type AuthorityBindingResolutionStatus = "RESOLVED" | "UNRESOLVED" | "AMBIGUOUS" | "CORRUPT";

export interface AuthorityBindingResolution {
  status: AuthorityBindingResolutionStatus;
  binding: VerificationAuthorityBindingV1 | null;
  reason: string;
}

export type BindingSemanticMaterial = Omit<VerificationAuthorityBindingV1, "binding_id" | "binding_evidence_refs">;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

/** Evidence is deliberately excluded: it supports attribution, not identity. */
export function bindingSemanticMaterial(binding: Omit<VerificationAuthorityBindingV1, "binding_id">): BindingSemanticMaterial {
  return {
    schema_version: binding.schema_version,
    decision_class: binding.decision_class,
    proposition_kind: binding.proposition_kind,
    authority_identity_type: binding.authority_identity_type,
    authority_id: binding.authority_id,
    verifier_contract_identity: binding.verifier_contract_identity,
    binding_version: binding.binding_version,
  };
}

export function canonicalBindingBytes(binding: Omit<VerificationAuthorityBindingV1, "binding_id">): string {
  return canonicalize(bindingSemanticMaterial(binding));
}

export function computeBindingId(binding: Omit<VerificationAuthorityBindingV1, "binding_id">): string {
  return createHash("sha256").update(canonicalBindingBytes(binding), "utf8").digest("hex");
}

export function validateBindingIdentity(binding: VerificationAuthorityBindingV1): AuthorityBindingResolution {
  if (binding.schema_version !== VERIFICATION_AUTHORITY_BINDING_SCHEMA_VERSION) return { status: "CORRUPT", binding: null, reason: "invalid binding schema_version" };
  if (!binding.binding_id || !binding.decision_class || !binding.proposition_kind || !binding.authority_id || !binding.binding_version) return { status: "UNRESOLVED", binding: null, reason: "missing required binding identity" };
  if (binding.authority_identity_type !== "REGISTERED_CAPABILITY") return { status: "CORRUPT", binding: null, reason: "unsupported authority_identity_type" };
  if (!binding.verifier_contract_identity?.verifier_contract_id || !binding.verifier_contract_identity.contract_version || !binding.verifier_contract_identity.semantic_digest) return { status: "UNRESOLVED", binding: null, reason: "missing verifier contract identity" };
  if (!Array.isArray(binding.binding_evidence_refs) || binding.binding_evidence_refs.length === 0) return { status: "UNRESOLVED", binding: null, reason: "missing binding evidence" };
  const expected = computeBindingId(binding);
  if (expected !== binding.binding_id) return { status: "CORRUPT", binding: null, reason: "binding_id does not match semantic tuple" };
  return { status: "RESOLVED", binding, reason: "valid immutable binding identity" };
}

export function compareBindingIdentity(left: VerificationAuthorityBindingV1 | null | undefined, right: VerificationAuthorityBindingV1 | null | undefined): AuthorityBindingResolutionStatus {
  if (!left || !right || !left.binding_id || !right.binding_id) return "UNRESOLVED";
  if (left.binding_id === right.binding_id) {
    return canonicalBindingBytes(left) === canonicalBindingBytes(right) ? "RESOLVED" : "CORRUPT";
  }
  if (left.decision_class === right.decision_class && left.proposition_kind === right.proposition_kind && left.binding_version === right.binding_version) return "AMBIGUOUS";
  return "UNRESOLVED";
}

/** Pure classification helper for immutable candidate sets; it never creates or mutates authority. */
export function classifyImmutableBindingCandidates(candidates: readonly VerificationAuthorityBindingV1[], query: { decision_class: string; proposition_kind: string; binding_version?: string }): AuthorityBindingResolution {
  const matches = candidates.filter((candidate) => candidate.decision_class === query.decision_class && candidate.proposition_kind === query.proposition_kind && (query.binding_version === undefined || candidate.binding_version === query.binding_version));
  if (matches.length === 0) return { status: "UNRESOLVED", binding: null, reason: "no immutable binding matches the exact class/proposition/version" };
  const valid = matches.map(validateBindingIdentity);
  if (valid.some((result) => result.status === "CORRUPT")) return { status: "CORRUPT", binding: null, reason: "an immutable binding has a binding_id collision or invalid identity" };
  const unique = new Map(matches.map((binding) => [binding.binding_id, binding]));
  if (unique.size !== 1) return { status: "AMBIGUOUS", binding: null, reason: "multiple incompatible immutable bindings match the exact class/proposition/version" };
  return { status: "RESOLVED", binding: matches[0], reason: "exactly one valid immutable binding matches" };
}
