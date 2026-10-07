/**
 * Architecture-only cardinality declaration for the logical Circuit Model
 * Subsystem. This contract describes a rule; it does not create an
 * InstallationIdentity, a subsystem identity, a relationship, or a store.
 */

import { createHash } from "node:crypto";

export const CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_SCHEMA_VERSION = "CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_V1" as const;
export const CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_CONTRACT_ID = "dna-os/circuit-model-subsystem-cardinality" as const;
export const CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_CONTRACT_VERSION = "1.0.0" as const;

export type CircuitModelSubsystemParentKind = "INSTALLATION";
export type CircuitModelSubsystemKind = "CIRCUIT_MODEL_SUBSYSTEM";
export type CircuitModelSubsystemRole = "PRIMARY";
export type CircuitModelSubsystemCardinality = "ZERO_OR_ONE";
export type CircuitModelSubsystemCardinalityEvaluationStatus = "VALID" | "CARDINALITY_VIOLATION";

export interface CircuitModelSubsystemCardinalityV1 {
  readonly schema_version: typeof CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_SCHEMA_VERSION;
  readonly contract_id: typeof CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_CONTRACT_ID;
  readonly contract_version: typeof CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_CONTRACT_VERSION;
  readonly parent_kind: CircuitModelSubsystemParentKind;
  readonly subsystem_kind: CircuitModelSubsystemKind;
  readonly role: CircuitModelSubsystemRole;
  readonly cardinality: CircuitModelSubsystemCardinality;
  readonly semantic_digest: string;
}

export interface CircuitModelSubsystemCardinalityValidationResult {
  readonly valid: boolean;
  readonly reason: string;
}

export interface CircuitModelSubsystemCardinalityEvaluation {
  readonly status: CircuitModelSubsystemCardinalityEvaluationStatus;
  readonly primary_instance_count: number;
  readonly reason: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function circuitModelSubsystemCardinalitySemanticMaterial(
  input: Omit<CircuitModelSubsystemCardinalityV1, "semantic_digest">,
): unknown {
  return {
    schema_version: input.schema_version,
    contract_id: input.contract_id,
    contract_version: input.contract_version,
    parent_kind: input.parent_kind,
    subsystem_kind: input.subsystem_kind,
    role: input.role,
    cardinality: input.cardinality,
  };
}

export function canonicalCircuitModelSubsystemCardinalityBytes(
  input: Omit<CircuitModelSubsystemCardinalityV1, "semantic_digest">,
): string {
  return canonicalize(circuitModelSubsystemCardinalitySemanticMaterial(input));
}

export function computeCircuitModelSubsystemCardinalityDigest(
  input: Omit<CircuitModelSubsystemCardinalityV1, "semantic_digest">,
): string {
  return createHash("sha256")
    .update(canonicalCircuitModelSubsystemCardinalityBytes(input), "utf8")
    .digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

export function freezeCircuitModelSubsystemCardinality(
  declaration: CircuitModelSubsystemCardinalityV1,
): Readonly<CircuitModelSubsystemCardinalityV1> {
  return deepFreeze(declaration);
}

export function createCircuitModelSubsystemCardinality(): Readonly<CircuitModelSubsystemCardinalityV1> {
  const material = {
    schema_version: CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_SCHEMA_VERSION,
    contract_id: CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_CONTRACT_ID,
    contract_version: CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_CONTRACT_VERSION,
    parent_kind: "INSTALLATION" as const,
    subsystem_kind: "CIRCUIT_MODEL_SUBSYSTEM" as const,
    role: "PRIMARY" as const,
    cardinality: "ZERO_OR_ONE" as const,
  };
  return freezeCircuitModelSubsystemCardinality({
    ...material,
    semantic_digest: computeCircuitModelSubsystemCardinalityDigest(material),
  });
}

export function validateCircuitModelSubsystemCardinality(
  declaration: unknown,
): CircuitModelSubsystemCardinalityValidationResult {
  if (!isObject(declaration)) return { valid: false, reason: "declaration must be an object" };
  if (declaration.schema_version !== CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_SCHEMA_VERSION) return { valid: false, reason: "invalid schema_version" };
  if (declaration.contract_id !== CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_CONTRACT_ID) return { valid: false, reason: "invalid contract_id" };
  if (declaration.contract_version !== CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_CONTRACT_VERSION) return { valid: false, reason: "invalid contract_version" };
  if (declaration.parent_kind !== "INSTALLATION") return { valid: false, reason: "invalid parent_kind" };
  if (declaration.subsystem_kind !== "CIRCUIT_MODEL_SUBSYSTEM") return { valid: false, reason: "invalid subsystem_kind" };
  if (declaration.role !== "PRIMARY") return { valid: false, reason: "invalid role" };
  if (declaration.cardinality !== "ZERO_OR_ONE") return { valid: false, reason: "invalid cardinality" };
  if (typeof declaration.semantic_digest !== "string" || !/^[0-9a-f]{64}$/.test(declaration.semantic_digest)) return { valid: false, reason: "invalid semantic_digest" };
  const { semantic_digest, ...withoutDigest } = declaration as unknown as CircuitModelSubsystemCardinalityV1;
  if (computeCircuitModelSubsystemCardinalityDigest(withoutDigest) !== semantic_digest) return { valid: false, reason: "semantic_digest does not match canonical semantic material" };
  return { valid: true, reason: "valid immutable Circuit Model Subsystem cardinality declaration" };
}

/** Pure interpretation of already-resolved primary subsystem instances. */
export function evaluateCircuitModelSubsystemCardinality(
  primaryInstanceCount: number,
): CircuitModelSubsystemCardinalityEvaluation {
  if (!Number.isInteger(primaryInstanceCount) || primaryInstanceCount < 0) {
    throw new Error("primaryInstanceCount must be a non-negative integer");
  }
  if (primaryInstanceCount <= 1) {
    return { status: "VALID", primary_instance_count: primaryInstanceCount, reason: "zero or one PRIMARY Circuit Model Subsystem is permitted" };
  }
  return { status: "CARDINALITY_VIOLATION", primary_instance_count: primaryInstanceCount, reason: "more than one PRIMARY Circuit Model Subsystem is not permitted per Installation" };
}
