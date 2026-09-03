/**
 * Common immutable semantic identity for a trusted verification composition
 * boundary. A declaration identifies composition only; it grants no runtime
 * trust and carries no producer, authority, source, or registry identity.
 */

import { createHash } from "node:crypto";

export const TRUSTED_EMISSION_BOUNDARY_DECLARATION_SCHEMA_VERSION = "TRUSTED_EMISSION_BOUNDARY_DECLARATION_V1" as const;

export interface TrustedEmissionBoundaryDeclarationV1 {
  readonly schema_version: typeof TRUSTED_EMISSION_BOUNDARY_DECLARATION_SCHEMA_VERSION;
  readonly boundary_id: string;
  readonly boundary_version: string;
  readonly composition_semantics: {
    readonly ordered_stages: readonly string[];
    readonly forbidden_stages: readonly string[];
  };
  readonly input_contract_identity: string;
  readonly output_contract_identity: string;
  readonly semantic_digest: string;
}

export interface BoundaryDeclarationValidationResult {
  readonly valid: boolean;
  readonly reason: string;
}

export type BoundaryComparison = "REPLAY" | "CORRUPT_VERSION" | "VALID_NEW_VERSION" | "DUPLICATE_BOUNDARY_CANDIDATE" | "UNRESOLVED";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function boundarySemanticMaterial(declaration: Omit<TrustedEmissionBoundaryDeclarationV1, "boundary_id" | "semantic_digest">): unknown {
  return {
    schema_version: declaration.schema_version,
    boundary_version: declaration.boundary_version,
    composition_semantics: declaration.composition_semantics,
    input_contract_identity: declaration.input_contract_identity,
    output_contract_identity: declaration.output_contract_identity,
  };
}

export function canonicalBoundaryBytes(declaration: Omit<TrustedEmissionBoundaryDeclarationV1, "boundary_id" | "semantic_digest">): string {
  return canonicalize(boundarySemanticMaterial(declaration));
}

export function computeBoundarySemanticDigest(declaration: Omit<TrustedEmissionBoundaryDeclarationV1, "boundary_id" | "semantic_digest">): string {
  return createHash("sha256").update(canonicalBoundaryBytes(declaration), "utf8").digest("hex");
}

function nonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }

export function validateTrustedEmissionBoundaryDeclaration(declaration: unknown): BoundaryDeclarationValidationResult {
  if (!isObject(declaration)) return { valid: false, reason: "declaration must be an object" };
  if (declaration.schema_version !== TRUSTED_EMISSION_BOUNDARY_DECLARATION_SCHEMA_VERSION) return { valid: false, reason: "unknown schema_version" };
  for (const field of ["boundary_id", "boundary_version", "input_contract_identity", "output_contract_identity"] as const) {
    if (!nonEmptyString(declaration[field])) return { valid: false, reason: `missing required identity: ${field}` };
  }
  const semantics = declaration.composition_semantics;
  if (!isObject(semantics) || !Array.isArray(semantics.ordered_stages) || semantics.ordered_stages.length === 0 || !semantics.ordered_stages.every(nonEmptyString) || !Array.isArray(semantics.forbidden_stages) || !semantics.forbidden_stages.every(nonEmptyString)) return { valid: false, reason: "invalid ordered composition semantics" };
  if (semantics.ordered_stages.includes("ACCEPT_VERIFICATION") || semantics.ordered_stages.includes("UPDATE_SYSTEM_TRUTH")) return { valid: false, reason: "forbidden acceptance/system-truth semantics present" };
  if (typeof declaration.semantic_digest !== "string" || !/^[0-9a-f]{64}$/.test(declaration.semantic_digest)) return { valid: false, reason: "invalid semantic_digest" };
  const { boundary_id, semantic_digest, ...material } = declaration as unknown as TrustedEmissionBoundaryDeclarationV1;
  if (computeBoundarySemanticDigest(material) !== semantic_digest) return { valid: false, reason: "semantic_digest does not match canonical boundary semantics" };
  return { valid: true, reason: "valid immutable trusted emission boundary declaration" };
}

export function freezeTrustedEmissionBoundaryDeclaration(declaration: TrustedEmissionBoundaryDeclarationV1): Readonly<TrustedEmissionBoundaryDeclarationV1> {
  const freeze = <T>(value: T): T => {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    return value;
  };
  return freeze(declaration);
}

export function compareTrustedEmissionBoundaryDeclarations(left: TrustedEmissionBoundaryDeclarationV1 | null | undefined, right: TrustedEmissionBoundaryDeclarationV1 | null | undefined): BoundaryComparison {
  if (!left || !right || !left.boundary_id || !right.boundary_id) return "UNRESOLVED";
  if (left.boundary_id === right.boundary_id) {
    if (left.boundary_version === right.boundary_version) return left.semantic_digest === right.semantic_digest ? "REPLAY" : "CORRUPT_VERSION";
    return left.semantic_digest !== right.semantic_digest ? "VALID_NEW_VERSION" : "UNRESOLVED";
  }
  return left.semantic_digest === right.semantic_digest ? "DUPLICATE_BOUNDARY_CANDIDATE" : "UNRESOLVED";
}
