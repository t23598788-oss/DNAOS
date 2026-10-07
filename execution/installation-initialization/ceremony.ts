/**
 * Disarmed local authority boundary for the first installation ceremony.
 *
 * This module validates an explicit local invocation only. It deliberately
 * does not import the initialization store, read state, generate an ID, read
 * the clock, or perform any write. The store's public create function remains
 * a separate containment gap until a restricted persistence composition is
 * implemented.
 */

import { createHash } from "node:crypto";

export const LOCAL_INSTALLATION_CEREMONY_SCHEMA_VERSION = "LOCAL_INSTALLATION_CEREMONY_V1" as const;
export const LOCAL_INSTALLATION_CEREMONY_BOUNDARY_ID = "dna-os/installation/local-initialization-ceremony" as const;
export const LOCAL_INSTALLATION_CEREMONY_BOUNDARY_VERSION = "1.0.0" as const;
export const ONE_TIME_LOCAL_INSTALLATION_BOOTSTRAP_AXIOM = "ONE_TIME_LOCAL_INSTALLATION_BOOTSTRAP_AXIOM" as const;
export const INITIALIZE_INSTALLATION_OPERATION = "INITIALIZE_INSTALLATION" as const;
export const EXPLICIT_LOCAL_DIRECT_EXECUTION = "EXPLICIT_LOCAL_DIRECT_EXECUTION" as const;
export const CEREMONY_EXECUTION_ARMED = false as const;

export type LocalInstallationCeremonyAuthorityBasis = typeof ONE_TIME_LOCAL_INSTALLATION_BOOTSTRAP_AXIOM;
export type LocalInstallationCeremonyOperation = typeof INITIALIZE_INSTALLATION_OPERATION;
export type LocalInstallationCeremonyInvocationMode = typeof EXPLICIT_LOCAL_DIRECT_EXECUTION;
export type LocalInstallationCeremonyResultStatus = "AUTHORIZED_FOR_CEREMONY_ENTRY" | "DENIED" | "INVALID_INVOCATION" | "NOT_READY";

export interface LocalInstallationCeremonyBoundaryV1 {
  readonly schema_version: typeof LOCAL_INSTALLATION_CEREMONY_SCHEMA_VERSION;
  readonly boundary_id: typeof LOCAL_INSTALLATION_CEREMONY_BOUNDARY_ID;
  readonly boundary_version: typeof LOCAL_INSTALLATION_CEREMONY_BOUNDARY_VERSION;
  readonly authority_basis: LocalInstallationCeremonyAuthorityBasis;
  readonly operation: LocalInstallationCeremonyOperation;
  readonly invocation_mode: LocalInstallationCeremonyInvocationMode;
  readonly execution_armed: false;
  readonly semantic_digest: string;
}

export interface LocalInstallationCeremonyInvocationV1 {
  readonly schema_version: typeof LOCAL_INSTALLATION_CEREMONY_SCHEMA_VERSION;
  readonly operation: LocalInstallationCeremonyOperation;
  readonly authority_basis: LocalInstallationCeremonyAuthorityBasis;
  readonly invocation_mode: LocalInstallationCeremonyInvocationMode;
}

export interface LocalInstallationCeremonyResult {
  readonly status: LocalInstallationCeremonyResultStatus;
  readonly reason: string;
  readonly boundary: Readonly<LocalInstallationCeremonyBoundaryV1>;
}

export interface LocalInstallationCeremonyValidationResult {
  readonly valid: boolean;
  readonly reason: string;
}

/** Narrow future write seam; no implementation or writer is exported here. */
export interface AuthorizedInitializationPersistencePort {
  persistInitializationFromAuthorizedCeremony: (authorization: LocalInstallationCeremonyResult) => never;
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

function semanticMaterial(boundary: Omit<LocalInstallationCeremonyBoundaryV1, "semantic_digest">): unknown {
  return {
    schema_version: boundary.schema_version,
    boundary_id: boundary.boundary_id,
    boundary_version: boundary.boundary_version,
    authority_basis: boundary.authority_basis,
    operation: boundary.operation,
    invocation_mode: boundary.invocation_mode,
    execution_armed: boundary.execution_armed,
  };
}

export function computeLocalInstallationCeremonyDigest(
  boundary: Omit<LocalInstallationCeremonyBoundaryV1, "semantic_digest">,
): string {
  return createHash("sha256").update(canonicalize(semanticMaterial(boundary)), "utf8").digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

export function createLocalInstallationCeremonyBoundary(): Readonly<LocalInstallationCeremonyBoundaryV1> {
  const material = {
    schema_version: LOCAL_INSTALLATION_CEREMONY_SCHEMA_VERSION,
    boundary_id: LOCAL_INSTALLATION_CEREMONY_BOUNDARY_ID,
    boundary_version: LOCAL_INSTALLATION_CEREMONY_BOUNDARY_VERSION,
    authority_basis: ONE_TIME_LOCAL_INSTALLATION_BOOTSTRAP_AXIOM,
    operation: INITIALIZE_INSTALLATION_OPERATION,
    invocation_mode: EXPLICIT_LOCAL_DIRECT_EXECUTION,
    execution_armed: false as const,
  };
  return deepFreeze({ ...material, semantic_digest: computeLocalInstallationCeremonyDigest(material) });
}

export function validateLocalInstallationCeremonyBoundary(
  boundary: unknown,
): LocalInstallationCeremonyValidationResult {
  if (!isObject(boundary)) return { valid: false, reason: "boundary must be an object" };
  if (boundary.schema_version !== LOCAL_INSTALLATION_CEREMONY_SCHEMA_VERSION) return { valid: false, reason: "invalid schema_version" };
  if (boundary.boundary_id !== LOCAL_INSTALLATION_CEREMONY_BOUNDARY_ID) return { valid: false, reason: "invalid boundary_id" };
  if (boundary.boundary_version !== LOCAL_INSTALLATION_CEREMONY_BOUNDARY_VERSION) return { valid: false, reason: "invalid boundary_version" };
  if (boundary.authority_basis !== ONE_TIME_LOCAL_INSTALLATION_BOOTSTRAP_AXIOM) return { valid: false, reason: "invalid authority_basis" };
  if (boundary.operation !== INITIALIZE_INSTALLATION_OPERATION) return { valid: false, reason: "invalid operation" };
  if (boundary.invocation_mode !== EXPLICIT_LOCAL_DIRECT_EXECUTION) return { valid: false, reason: "invalid invocation_mode" };
  if (boundary.execution_armed !== false) return { valid: false, reason: "ceremony execution must remain disarmed" };
  if (typeof boundary.semantic_digest !== "string" || !/^[0-9a-f]{64}$/.test(boundary.semantic_digest)) return { valid: false, reason: "invalid semantic_digest" };
  const { semantic_digest, ...withoutDigest } = boundary as unknown as LocalInstallationCeremonyBoundaryV1;
  return computeLocalInstallationCeremonyDigest(withoutDigest) === semantic_digest
    ? { valid: true, reason: "valid immutable disarmed local ceremony boundary" }
    : { valid: false, reason: "semantic_digest does not match boundary" };
}

export function validateLocalInstallationCeremonyInvocation(
  invocation: unknown,
): LocalInstallationCeremonyValidationResult {
  if (!isObject(invocation)) return { valid: false, reason: "invocation must be an object" };
  const allowed = new Set(["schema_version", "operation", "authority_basis", "invocation_mode"]);
  if (Object.keys(invocation).some((key) => !allowed.has(key))) return { valid: false, reason: "invocation contains unsupported authority or caller fields" };
  if (invocation.schema_version !== LOCAL_INSTALLATION_CEREMONY_SCHEMA_VERSION) return { valid: false, reason: "invalid schema_version" };
  if (invocation.operation !== INITIALIZE_INSTALLATION_OPERATION) return { valid: false, reason: "invalid operation" };
  if (invocation.authority_basis !== ONE_TIME_LOCAL_INSTALLATION_BOOTSTRAP_AXIOM) return { valid: false, reason: "invalid authority_basis" };
  if (invocation.invocation_mode !== EXPLICIT_LOCAL_DIRECT_EXECUTION) return { valid: false, reason: "invalid invocation_mode" };
  return { valid: true, reason: "valid explicit local ceremony invocation" };
}

/** Entry boundary only: valid authority crosses the gate, then stops disarmed. */
export function enterLocalInstallationCeremony(invocation: unknown): LocalInstallationCeremonyResult {
  const boundary = createLocalInstallationCeremonyBoundary();
  const validation = validateLocalInstallationCeremonyInvocation(invocation);
  if (!validation.valid) return { status: "INVALID_INVOCATION", reason: validation.reason, boundary };
  return {
    status: "NOT_READY",
    reason: "CEREMONY_EXECUTION_DISARMED",
    boundary,
  };
}

/** Internal composition checkpoint used only by the isolated test harness. */
export function authorizeLocalInstallationCeremonyEntry(invocation: unknown): LocalInstallationCeremonyResult {
  const boundary = createLocalInstallationCeremonyBoundary();
  const validation = validateLocalInstallationCeremonyInvocation(invocation);
  if (!validation.valid) return { status: "INVALID_INVOCATION", reason: validation.reason, boundary };
  return { status: "AUTHORIZED_FOR_CEREMONY_ENTRY", reason: "explicit local bootstrap authority validated", boundary };
}
