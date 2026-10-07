/**
 * Identity shape for one concrete logical PRIMARY Circuit Model Subsystem.
 *
 * This is deliberately not an Installation relationship or a cardinality
 * evaluator. A valid identity record does not, by itself, prove which
 * Installation owns it. The future HAS_SUBSYSTEM relationship supplies that
 * resolution and the cardinality contract evaluates that topology.
 */

import { createHash } from "node:crypto";

export const CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_SCHEMA_VERSION = "CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_V1" as const;
export const CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_CONTRACT_ID = "dna-os/circuit-model-subsystem-identity" as const;
export const CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_CONTRACT_VERSION = "1.0.0" as const;

export const CIRCUIT_MODEL_SUBSYSTEM_KIND = "CIRCUIT_MODEL_SUBSYSTEM" as const;
export const CIRCUIT_MODEL_SUBSYSTEM_ROLE = "PRIMARY" as const;

export interface CircuitModelSubsystemIdentityV1 {
  readonly schema_version: typeof CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_SCHEMA_VERSION;
  readonly contract_id: typeof CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_CONTRACT_ID;
  readonly contract_version: typeof CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_CONTRACT_VERSION;
  readonly subsystem_id: string;
  readonly subsystem_kind: typeof CIRCUIT_MODEL_SUBSYSTEM_KIND;
  readonly role: typeof CIRCUIT_MODEL_SUBSYSTEM_ROLE;
  readonly semantic_digest: string;
}

export interface CircuitModelSubsystemIdentityValidationResult {
  readonly valid: boolean;
  readonly reason: string;
}

const OPAQUE_SUBSYSTEM_ID = /^subsystem-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function circuitModelSubsystemIdentitySemanticMaterial(
  input: Omit<CircuitModelSubsystemIdentityV1, "semantic_digest">,
): unknown {
  return {
    schema_version: input.schema_version,
    contract_id: input.contract_id,
    contract_version: input.contract_version,
    subsystem_id: input.subsystem_id,
    subsystem_kind: input.subsystem_kind,
    role: input.role,
  };
}

export function canonicalCircuitModelSubsystemIdentityBytes(
  input: Omit<CircuitModelSubsystemIdentityV1, "semantic_digest">,
): string {
  return canonicalize(circuitModelSubsystemIdentitySemanticMaterial(input));
}

export function computeCircuitModelSubsystemIdentityDigest(
  input: Omit<CircuitModelSubsystemIdentityV1, "semantic_digest">,
): string {
  return createHash("sha256")
    .update(canonicalCircuitModelSubsystemIdentityBytes(input), "utf8")
    .digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

export function freezeCircuitModelSubsystemIdentity(
  identity: CircuitModelSubsystemIdentityV1,
): Readonly<CircuitModelSubsystemIdentityV1> {
  return deepFreeze(identity);
}

/** Requires an opaque caller-supplied ID; it never generates one. */
export function createCircuitModelSubsystemIdentity(
  input: { readonly subsystem_id: string },
): Readonly<CircuitModelSubsystemIdentityV1> {
  if (typeof input.subsystem_id !== "string" || !OPAQUE_SUBSYSTEM_ID.test(input.subsystem_id)) {
    throw new Error("subsystem_id must match subsystem-<uuid>");
  }
  const material = {
    schema_version: CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_SCHEMA_VERSION,
    contract_id: CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_CONTRACT_ID,
    contract_version: CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_CONTRACT_VERSION,
    subsystem_id: input.subsystem_id,
    subsystem_kind: CIRCUIT_MODEL_SUBSYSTEM_KIND,
    role: CIRCUIT_MODEL_SUBSYSTEM_ROLE,
  } as const;
  return freezeCircuitModelSubsystemIdentity({
    ...material,
    semantic_digest: computeCircuitModelSubsystemIdentityDigest(material),
  });
}

export function validateCircuitModelSubsystemIdentity(
  identity: unknown,
): CircuitModelSubsystemIdentityValidationResult {
  if (!isObject(identity)) return { valid: false, reason: "identity must be an object" };
  const allowedKeys = new Set([
    "schema_version", "contract_id", "contract_version", "subsystem_id",
    "subsystem_kind", "role", "semantic_digest",
  ]);
  if (Object.keys(identity).some((key) => !allowedKeys.has(key))) return { valid: false, reason: "identity contains unknown fields" };
  if (identity.schema_version !== CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_SCHEMA_VERSION) return { valid: false, reason: "invalid schema_version" };
  if (identity.contract_id !== CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_CONTRACT_ID) return { valid: false, reason: "invalid contract_id" };
  if (identity.contract_version !== CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_CONTRACT_VERSION) return { valid: false, reason: "invalid contract_version" };
  if (typeof identity.subsystem_id !== "string" || !OPAQUE_SUBSYSTEM_ID.test(identity.subsystem_id)) return { valid: false, reason: "invalid opaque subsystem_id" };
  if (identity.subsystem_kind !== CIRCUIT_MODEL_SUBSYSTEM_KIND) return { valid: false, reason: "invalid subsystem_kind" };
  if (identity.role !== CIRCUIT_MODEL_SUBSYSTEM_ROLE) return { valid: false, reason: "invalid role" };
  if (typeof identity.semantic_digest !== "string" || !/^[0-9a-f]{64}$/.test(identity.semantic_digest)) return { valid: false, reason: "invalid semantic_digest" };
  const { semantic_digest, ...withoutDigest } = identity as unknown as CircuitModelSubsystemIdentityV1;
  if (computeCircuitModelSubsystemIdentityDigest(withoutDigest) !== semantic_digest) return { valid: false, reason: "semantic_digest does not match canonical semantic material" };
  return { valid: true, reason: "valid immutable Circuit Model Subsystem identity" };
}
