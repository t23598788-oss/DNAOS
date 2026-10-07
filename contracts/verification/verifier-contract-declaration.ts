/**
 * Common, semantic-only declaration contract for verifiers.
 *
 * This file describes what a verifier contract means. It does not contain
 * authority, producer, capability, source, or runtime provenance fields.
 * Those belong to the later authority/provenance boundaries.
 */

import { createHash } from "node:crypto";

export const VERIFIER_CONTRACT_DECLARATION_SCHEMA_VERSION = "VERIFIER_CONTRACT_DECLARATION_V1" as const;

export interface VerifierContractDeclarationV1 {
  schema_version: typeof VERIFIER_CONTRACT_DECLARATION_SCHEMA_VERSION;
  verifier_contract_id: string;
  contract_version: string;
  decision_class: string;
  proposition_kind: string;
  proposition_schema_or_parameters: JsonValue;
  input_contract_identity: string;
  output_contract_identity: string;
  verdict_semantics: JsonValue;
  required_evidence_identity: JsonValue;
  semantic_digest: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type DeclarationComparison =
  | "REPLAY"
  | "CORRUPT_VERSION"
  | "VALID_NEW_VERSION"
  | "DUPLICATE_CONTRACT_CANDIDATE"
  | "UNRESOLVED";

export interface DeclarationValidationResult {
  valid: boolean;
  reason: string;
}

const REQUIRED_STRING_FIELDS = [
  "verifier_contract_id",
  "contract_version",
  "decision_class",
  "proposition_kind",
  "input_contract_identity",
  "output_contract_identity",
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return isObject(value) ? Object.keys(value).length > 0 : value !== null && value !== undefined;
}

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as JsonValue)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Returns only semantic material. Object insertion order is discarded. Array
 * order is preserved because this generic primitive cannot assume an array is
 * order-insensitive; declarations must sort such collections explicitly.
 */
export function semanticMaterial(declaration: Omit<VerifierContractDeclarationV1, "semantic_digest">): JsonValue {
  return {
    schema_version: declaration.schema_version,
    contract_version: declaration.contract_version,
    decision_class: declaration.decision_class,
    proposition_kind: declaration.proposition_kind,
    proposition_schema_or_parameters: declaration.proposition_schema_or_parameters,
    input_contract_identity: declaration.input_contract_identity,
    output_contract_identity: declaration.output_contract_identity,
    verdict_semantics: declaration.verdict_semantics,
    required_evidence_identity: declaration.required_evidence_identity,
  };
}

export function canonicalSemanticBytes(declaration: Omit<VerifierContractDeclarationV1, "semantic_digest">): string {
  return canonicalize(semanticMaterial(declaration));
}

export function computeSemanticDigest(declaration: Omit<VerifierContractDeclarationV1, "semantic_digest">): string {
  return createHash("sha256").update(canonicalSemanticBytes(declaration), "utf8").digest("hex");
}

export function validateVerifierContractDeclaration(declaration: unknown): DeclarationValidationResult {
  if (!isObject(declaration)) return { valid: false, reason: "declaration must be an object" };
  if (declaration.schema_version !== VERIFIER_CONTRACT_DECLARATION_SCHEMA_VERSION) return { valid: false, reason: "invalid schema_version" };
  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof declaration[field] !== "string" || declaration[field].trim().length === 0) {
      return { valid: false, reason: `missing required identity: ${field}` };
    }
  }
  if (!hasMeaningfulValue(declaration.proposition_schema_or_parameters)) return { valid: false, reason: "missing proposition_schema_or_parameters" };
  if (!hasMeaningfulValue(declaration.verdict_semantics)) return { valid: false, reason: "missing verdict_semantics" };
  if (!hasMeaningfulValue(declaration.required_evidence_identity)) return { valid: false, reason: "missing required_evidence_identity" };
  if (typeof declaration.semantic_digest !== "string" || !/^[0-9a-f]{64}$/.test(declaration.semantic_digest)) return { valid: false, reason: "invalid semantic_digest" };
  const { semantic_digest, ...withoutDigest } = declaration as unknown as VerifierContractDeclarationV1;
  if (computeSemanticDigest(withoutDigest) !== semantic_digest) return { valid: false, reason: "semantic_digest does not match canonical semantic material" };
  return { valid: true, reason: "valid verifier contract declaration" };
}

export function compareVerifierContractDeclarations(
  left: VerifierContractDeclarationV1 | null | undefined,
  right: VerifierContractDeclarationV1 | null | undefined,
): DeclarationComparison {
  if (!left || !right || !left.verifier_contract_id || !right.verifier_contract_id) return "UNRESOLVED";
  if (left.verifier_contract_id === right.verifier_contract_id) {
    if (left.contract_version === right.contract_version) return left.semantic_digest === right.semantic_digest ? "REPLAY" : "CORRUPT_VERSION";
    return left.semantic_digest !== right.semantic_digest ? "VALID_NEW_VERSION" : "VALID_NEW_VERSION";
  }
  return left.semantic_digest === right.semantic_digest ? "DUPLICATE_CONTRACT_CANDIDATE" : "UNRESOLVED";
}
