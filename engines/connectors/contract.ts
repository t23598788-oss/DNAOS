/**
 * Connect Core — Provider-Neutral Contract (types only).
 *
 * Owner-approved design (CONNECT CORE DISCOVERY FINAL DESIGN REPORT, 2026-09-20).
 * This file is the single contract every provider plugs into, so the
 * pre-Connect layer (Discover -> Identify -> Prepare -> Owner Approve) can run
 * without any central route, gateway, or UI branching on a provider name.
 *
 * Reuse rules this file obeys (no parallel architecture):
 *   - `AuthMode` is the SAME union as the connectors table's `auth_type` CHECK
 *     constraint (core/connector-loader.ts#ConnectorAuthType) — never a second
 *     vocabulary.
 *   - `EvidenceRef` mirrors the real, already-existing evidence shape
 *     (`ProviderEvidenceItem` in providerRegistryRuntime.ts): source / detail /
 *     captured_at.
 *   - `DiscoveredResource` mirrors the shape the live discovery route already
 *     returns (engines/domains/railway-binding.ts#RailwayResourceNode, served by
 *     app/api/admin/connectors/discover/[slug]/route.ts).
 *   - Test/Enable/Run are NOT redefined here: the lifecycle stays
 *     Connect -> Register -> Test -> Enable -> Run, enforced by
 *     registry/connector-lifecycle.json, gateway/connectors.ts and
 *     core/connector-loader.ts#requireConnector exactly as today.
 *
 * Secret rule (hard): no type here may carry a secret VALUE. Credential
 * presence travels as status + FIELD NAMES only (`secret_keys`,
 * `missing_field_keys`, `required_secret_field_keys`) — the same discipline as
 * gateway/connectors.ts#redactConnector and
 * providerRegistryRuntime.ts#deriveCredentialStatus. Values stay in the
 * connectors table / Vault, reachable only through the existing lifecycle.
 *
 * Language rule (registry/dependency-graph.json -> language_boundary, owner
 * directive 2026-09-20): display text is exposed only as locale KEYS
 * (`label_key`), never as a human-language literal; this file keeps English
 * identifiers only.
 */
import type { ConnectorAuthType } from "@/core/connector-loader";

/** Same union as the connectors table's auth_type CHECK — one vocabulary. */
export type AuthMode = ConnectorAuthType;

/** Whether connecting this provider may proceed without an Owner decision. */
export type ApprovalRequirement = "NONE" | "OWNER_REQUIRED";

/** Derived exactly like providerRegistryRuntime.ts#CredentialStatus. */
export type CredentialStatus = "CONFIGURED" | "MISSING" | "INVALID" | "NOT_APPLICABLE";

export type CapabilityDirection = "INBOUND" | "OUTBOUND" | "BIDIRECTIONAL";

/** Declared capability metadata — identifier + locale key + direction. */
export interface CapabilityMetadata {
  /** Dot-namespaced, provider-agnostic verb (contracts/event.ts convention). */
  id: string;
  /** Locale key for human display, resolved outside technical source. */
  label_key: string;
  direction: CapabilityDirection;
}

/** Real evidence, never a guess. Mirrors ProviderEvidenceItem's shape. */
export interface EvidenceRef {
  /** e.g. "workspace_file:engines/domains/railway-binding.ts". */
  source: string;
  /** Factual, English, never a secret value. */
  detail: string;
  captured_at: string;
}

/** One field a Connect form must collect for this provider/auth mode. */
export interface FieldSpec {
  key: string;
  /** Locale key for the field label — never a literal. */
  label_key: string;
  /** Which existing jsonb column the value belongs to. */
  target: "config" | "secret";
  secret: boolean;
  required: boolean;
  placeholder?: string;
}

/** A concrete value the system produced (default or derived, read-only). */
export interface DerivedValue {
  key: string;
  value: string;
}

/** Normalized resource returned by a provider's own discovery API. */
export interface DiscoveredResource {
  kind: string;
  id: string;
  name: string;
  parent_id: string | null;
  children?: DiscoveredResource[];
}

/** Result of a cheap, secret-free readiness inspection. */
export interface InspectionResult {
  credential_status: CredentialStatus;
  /** Field names still missing — names only, never values. */
  missing_field_keys: string[];
  evidence: EvidenceRef[];
}

/** Everything the pre-Connect layer needs before the user presses Connect. */
export interface ConnectPreparation {
  provider_id: string;
  fields: FieldSpec[];
  /** Non-secret defaults (e.g. a provider's real API base URL). */
  defaults: DerivedValue[];
  /** System-derived URLs the user copies outward — read-only by contract. */
  derived: DerivedValue[];
  /** Secret field names the user still has to supply. */
  required_secret_field_keys: string[];
  approval: ApprovalRequirement;
  evidence: EvidenceRef[];
}

export type DiscoverResourcesResult =
  | { ok: true; resources: DiscoveredResource[] }
  | { ok: false; code: string; error: string };

export interface ConnectTestResult {
  ok: boolean;
  error?: string;
  evidence: EvidenceRef[];
}

/**
 * Dependencies a caller injects for detection, so a provider adapter never
 * reaches into the filesystem or the environment itself (testable, one path).
 */
export interface DetectDeps {
  fileExists(relPath: string): boolean;
  envNames(): string[];
}

/**
 * The connector summary a provider is allowed to see: status/enabled/config and
 * secret FIELD NAMES only. There is deliberately no accessor for secret values —
 * a provider adapter cannot read a credential even by accident.
 */
export interface ConnectorSummary {
  id: string;
  slug: string;
  status: string;
  enabled: boolean;
  auth_type: AuthMode;
  config: Record<string, unknown>;
  secret_keys: string[];
}

/** Runtime wiring a provider adapter receives (built by the caller's own layer). */
export interface ConnectRuntimeDeps {
  /** This app's own public origin, or null when it is genuinely unset. */
  appOrigin(): string | null;
  getConnectorSummary(slug: string): Promise<ConnectorSummary | null>;
  /**
   * The canonical Test stage — gateway/connectors.ts#runConnectorTest, injected
   * rather than imported: engines may not import gateway
   * (registry/dependency-graph.json allowed_imports.engines = core/services/registry),
   * and this also guarantees a provider adapter can never reach the secret
   * itself. One Test path for the whole system, exactly as today.
   */
  runCanonicalTest(connectorId: string): Promise<{ status: string; last_error: string | null }>;
}

/** What the owner is trying to connect. */
export interface ConnectIntent {
  provider_id: string;
  auth_mode: AuthMode;
}

/**
 * The one contract. Implementations live in engines/connectors/providers/*, are
 * listed in engines/connectors/registry.ts, and are the ONLY place a provider
 * identifier appears — central routes look a contract up by id and never switch
 * on a provider name.
 */
export interface ConnectContract {
  readonly providerId: string;
  readonly authModes: readonly AuthMode[];
  readonly approvalRequirement: ApprovalRequirement;

  /** Declared capabilities (metadata only, no live call). */
  capabilityMetadata(): CapabilityMetadata[];

  /** Discover: real evidence that this provider exists in this system. */
  detect(deps: DetectDeps): EvidenceRef[];

  /** Identify: is a usable credential present, and what is still missing. */
  inspect(deps: ConnectRuntimeDeps): Promise<InspectionResult>;

  /** Prepare: fields to collect + values the system derives itself. */
  prepareConnect(deps: ConnectRuntimeDeps, intent?: ConnectIntent): Promise<ConnectPreparation>;

  /**
   * Resources the provider's own API can list. Lifecycle-gated by whatever
   * existing binding implements it (the binding owns the Run gate) — never a
   * second credential path.
   */
  discoverResources(): Promise<DiscoverResourcesResult>;

  /**
   * Real connection check. Must delegate to the existing
   * engines/connectors/tester.ts for auth-type-level behaviour; a provider may
   * add a provider-shaped assertion only inside that same tester.
   */
  test(deps: ConnectRuntimeDeps): Promise<ConnectTestResult>;
}
