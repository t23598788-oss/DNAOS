/**
 * หน้าที่: let DNA OS answer, from measured evidence rather than from anyone's
 * description, "what execution methods do I actually have right now, and what
 * can each of them really do?" (Owner, 2026-09-02).
 *
 * WHY THIS LAYER DID NOT EXIST. `software/live-census` already knows a great
 * deal — per capability: source digest, tests, registration, verification. And
 * `connections/connection-registry` already knows per connection: provider,
 * protocol, declared state. Neither knows the thing this file adds: what KIND
 * of execution channel a capability is, what authority it needs, what it can
 * observe, what it can verify, and which resource dimensions it can measure.
 * So this is an additive method layer that points at both, not a second
 * registry of either.
 *
 * REGISTERED IS NOT PROVEN, AND THE REGISTRY SAYS SO. All 118 canonical
 * capabilities carry `status: REGISTERED` and `verified_at: null`. Registration
 * state and evidence state are different dimensions and are kept apart here:
 * `RuntimeState` never reads a registry status, only measured evidence.
 *
 * THE STATE IS NOT WRITTEN, IT IS MEASURED. A declaration names which files
 * constitute proof for a method and how many rows, matching what, are required.
 * `deriveRuntimeState` then counts. Nobody — including a model — can assert
 * that a method is proven; the only way to reach RUNTIME_PROVEN is for the
 * named evidence to actually exist at the named path in the named quantity.
 *
 * ABSENCE IS A VALUE. A method with no implementation is NOT_IMPLEMENTED, not
 * missing. A dimension nobody measures is listed in `unmeasured_dimensions`
 * rather than reported as zero. A method whose declaration and observation
 * disagree is CONFIGURATION_DRIFT rather than quietly still proven.
 *
 * Input: typed declarations + measured facts about the named evidence files.
 * Output: the record contract, deriveRuntimeState, resolveSelfResource.
 * Dependency ที่อนุญาต: contracts/connector/connection-declaration (state vocabulary reuse).
 * สิ่งที่ห้ามแตะ: ห้ามให้โมเดลกำหนด runtime state, ห้ามใช้สถานะ REGISTERED เป็น
 * หลักฐาน runtime, ห้ามแทนมิติที่วัดไม่ได้ด้วยศูนย์.
 */
import type { DeclaredConnectionState } from "../../contracts/connector/connection-declaration";

/**
 * Evidence state. The first four literals are reused verbatim from
 * `DeclaredConnectionState` so a connection declaration and a method record
 * cannot drift into two dialects; `RUNTIME_PROVEN` is this layer's name for
 * that vocabulary's `PROVEN`, and the mapping below is explicit rather than
 * implied. The last three cover cases a connection declaration never had to
 * express.
 */
export type RuntimeState =
  | "DECLARED"
  | "OBSERVED"
  | "RUNTIME_PROVEN"
  | "PARTIAL"
  | "CONFIGURATION_DRIFT"
  | "NOT_IMPLEMENTED"
  | "UNKNOWN";

/** Explicit bridge to the existing connection vocabulary. No silent aliasing. */
export const CONNECTION_STATE_TO_RUNTIME_STATE: Readonly<Record<DeclaredConnectionState, RuntimeState>> = Object.freeze({
  DECLARED: "DECLARED",
  OBSERVED: "OBSERVED",
  PROVEN: "RUNTIME_PROVEN",
  CONFIGURATION_DRIFT: "CONFIGURATION_DRIFT",
});

/** How a method reaches the world. Named for what this repo actually has, not a universal enum. */
export type MethodKind =
  | "LOCAL_PROCESS" | "FILE" | "COMPUTER_USE"
  | "WEBHOOK_OUTBOUND" | "WEBHOOK_INBOUND" | "HTTP_INBOUND_CONTROL"
  | "API_OUTBOUND_PROVIDER" | "CONNECTOR" | "EMAIL_READ"
  | "DATABASE" | "REMOTE_SERVICE" | "BROWSER_DOM";

export type AuthorityRequirement =
  | "NONE"
  | "PROCESS_GATE_POLICY"
  | "WRITE_GATE_DECISION"
  | "COMPUTER_USE_LEASE"
  | "OWNER_SESSION"
  | "NETWORK_AUTH_GATE_SECRET"
  | "PROVIDER_CREDENTIAL"
  | "CALLER_AUTHENTICATED";

/** Secrets are pointers or they are nothing. There is no RAW_SECRET member on purpose. */
export type CredentialMode = "NOT_APPLICABLE" | "KEYCHAIN_REFERENCE" | "ENV_SHARED_SECRET" | "NONE_REQUIRED";

/** Dimensions something in this repo really records per execution. */
export type MeasuredDimension = "DURATION_MS" | "BYTES_WRITTEN" | "ROUND_TRIP_MS" | "READINESS_WAIT_MS" | "EXIT_CODE" | "HTTP_STATUS";

/** Dimensions nothing records. Listed so absence is a fact, never a zero. */
export type UnmeasuredDimension = "TOKEN_USAGE" | "NETWORK_BYTES" | "GPU_RUNTIME" | "EXECUTION_MONETARY_COST" | "CPU_TIME";

/** What a method cannot currently claim. Typed, so a limitation is queryable rather than prose. */
export type LimitationCode =
  | "NO_IMPLEMENTATION"
  | "NO_INBOUND_RECEIVER"
  | "CANNOT_SEND_ONLY_READ"
  | "AUTHENTICATED_EXECUTION_NOT_PROVEN"
  | "SUCCESSFUL_EXECUTION_NOT_PROVEN"
  | "LIVE_ROUND_TRIP_NOT_PROVEN"
  | "CURRENT_DECLARATION_DRIFTED"
  | "REACHABILITY_PROBE_ONLY"
  | "DEPENDS_ON_UPSTREAM_READER";

/** How an evidence file is counted. Finite, so "what counts as proof" is never a judgement call. */
export type EvidenceFileKind = "JSONL" | "JSON_ARRAY_FILE" | "FILE_EXISTS";

export interface EvidenceRule {
  /** Repository-relative path. The record's provenance is this literal string. */
  path: EvidenceFileKind extends never ? never : string;
  kind: EvidenceFileKind;
  /** How many matching rows must exist for this rule to be satisfied. */
  min_rows: number;
  /** A row must contain this substring to count. Absent means every row counts. */
  must_contain?: string;
  /** Field to read the newest timestamp from, for last_observed_at. */
  timestamp_field?: string;
}

export interface SelfResourceDeclaration {
  method_id: string;
  method_kind: MethodKind;
  /** The canonical capability this method belongs to, when one is registered. */
  capability_id: string | null;
  capability_canonical_name: string | null;
  /** The one module a caller goes through. */
  implementation_boundary: string;
  authority_requirement: AuthorityRequirement;
  credential_mode: CredentialMode;
  observation_support: boolean;
  observation_source: string | null;
  verification_support: boolean;
  verification_source: string | null;
  measured_dimensions: readonly MeasuredDimension[];
  unmeasured_dimensions: readonly UnmeasuredDimension[];
  /** Every rule must be satisfied to reach `state_when_satisfied`. */
  proof_rules: readonly EvidenceRule[];
  state_when_satisfied: RuntimeState;
  state_when_unsatisfied: RuntimeState;
  /** If this rule IS satisfied, the method is drifted regardless of the proof rules. */
  drift_rule?: EvidenceRule;
  known_limitations: readonly LimitationCode[];
}

/** What measuring one evidence rule produced. The provenance of a derived state. */
export interface MeasuredEvidence {
  path: string;
  exists: boolean;
  matching_rows: number;
  required_rows: number;
  satisfied: boolean;
  newest_timestamp: string | null;
}

export interface SelfResourceRecord {
  method_id: string;
  method_kind: MethodKind;
  capability_id: string | null;
  capability_canonical_name: string | null;
  implementation_boundary: string;
  authority_requirement: AuthorityRequirement;
  credential_mode: CredentialMode;
  observation_support: boolean;
  observation_source: string | null;
  verification_support: boolean;
  verification_source: string | null;
  measured_dimensions: readonly MeasuredDimension[];
  unmeasured_dimensions: readonly UnmeasuredDimension[];
  runtime_state: RuntimeState;
  /** Always the measurement, never an assertion. */
  runtime_state_source: "MEASURED_EVIDENCE";
  /** Newest timestamp seen across satisfied rules. Null when nothing was measured. */
  last_observed_at: string | null;
  evidence_refs: readonly MeasuredEvidence[];
  known_limitations: readonly LimitationCode[];
  /**
   * No rule exists anywhere in this repo for when measured evidence becomes too
   * old to support a claim. Recorded as a value so the absence is queryable and
   * a reader is never misled into treating an old measurement as current.
   */
  freshness_model: "MISSING";
  derived_at: string;
}

/**
 * Derives one method's state from measurements alone. Pure: it never reads a
 * file, never reads a registry status, and cannot be told an answer — the only
 * inputs are the declaration and what measuring its named files produced.
 */
export function deriveRuntimeState(
  declaration: SelfResourceDeclaration,
  measured: readonly MeasuredEvidence[],
  driftMeasured: MeasuredEvidence | null,
): { runtime_state: RuntimeState; last_observed_at: string | null } {
  const timestamps = measured.filter((m) => m.satisfied && m.newest_timestamp).map((m) => m.newest_timestamp!);
  const last_observed_at = timestamps.length > 0 ? timestamps.slice().sort().at(-1)! : null;

  // Drift wins outright: a declaration and an observation that disagree cannot
  // be resolved by counting more rows, and stale proof must not survive it.
  if (driftMeasured?.satisfied) return { runtime_state: "CONFIGURATION_DRIFT", last_observed_at };

  // No rules at all means nothing was ever claimed to constitute proof.
  if (declaration.proof_rules.length === 0) return { runtime_state: declaration.state_when_unsatisfied, last_observed_at };

  const allSatisfied = measured.length === declaration.proof_rules.length && measured.every((m) => m.satisfied);
  return { runtime_state: allSatisfied ? declaration.state_when_satisfied : declaration.state_when_unsatisfied, last_observed_at };
}

export interface SelfResourceQuery {
  required_method_kind: MethodKind;
  required_authority?: AuthorityRequirement;
  requires_observation?: boolean;
  requires_verification?: boolean;
  required_measurements?: readonly MeasuredDimension[];
  /** When true, only RUNTIME_PROVEN methods qualify. Default false — the caller sees state and decides. */
  requires_runtime_proof?: boolean;
}

export type NoResourceReason =
  | "NO_METHOD_OF_THIS_KIND"
  | "AUTHORITY_INCOMPATIBLE"
  | "OBSERVATION_UNSUPPORTED"
  | "VERIFICATION_UNSUPPORTED"
  | "MEASUREMENT_UNAVAILABLE"
  | "NOT_RUNTIME_PROVEN";

export interface SelfResourceCandidate {
  method_id: string;
  capability_id: string | null;
  runtime_state: RuntimeState;
  authority_compatible: boolean;
  observation_compatible: boolean;
  verification_compatible: boolean;
  measurement_compatible: boolean;
  evidence_refs: readonly MeasuredEvidence[];
  known_limitations: readonly LimitationCode[];
}

export interface SelfResourceResolution {
  candidates: readonly SelfResourceCandidate[];
  /** Present only when no candidate qualified. Finite reasons, never prose. */
  no_suitable_self_resource: readonly NoResourceReason[] | null;
}

/**
 * A pure query over already-derived records. It executes nothing, chooses
 * nothing by preference, and cannot invent a method that has no record — a
 * kind with no record yields NO_METHOD_OF_THIS_KIND rather than an empty
 * success.
 */
export function resolveSelfResource(
  records: readonly SelfResourceRecord[],
  query: SelfResourceQuery,
): SelfResourceResolution {
  const ofKind = records.filter((r) => r.method_kind === query.required_method_kind);
  if (ofKind.length === 0) return { candidates: [], no_suitable_self_resource: ["NO_METHOD_OF_THIS_KIND"] };

  const candidates = ofKind.map((r): SelfResourceCandidate => ({
    method_id: r.method_id,
    capability_id: r.capability_id,
    runtime_state: r.runtime_state,
    authority_compatible: query.required_authority === undefined || r.authority_requirement === query.required_authority,
    observation_compatible: query.requires_observation !== true || r.observation_support,
    verification_compatible: query.requires_verification !== true || r.verification_support,
    measurement_compatible: (query.required_measurements ?? []).every((d) => r.measured_dimensions.includes(d)),
    evidence_refs: r.evidence_refs,
    known_limitations: r.known_limitations,
  }));

  const qualifying = candidates.filter((c) =>
    c.authority_compatible && c.observation_compatible && c.verification_compatible && c.measurement_compatible
    && (query.requires_runtime_proof !== true || c.runtime_state === "RUNTIME_PROVEN"));

  if (qualifying.length > 0) return { candidates: qualifying, no_suitable_self_resource: null };

  // Nothing qualified. Return NO candidates — a caller must not be handed a
  // method that failed its own requirements and be left to notice the reason
  // list. The disqualified detail stays available in the records themselves.
  // Report every reason that actually applied, so a caller learns what is
  // missing rather than only that something is.
  const reasons: NoResourceReason[] = [];
  if (candidates.every((c) => !c.authority_compatible)) reasons.push("AUTHORITY_INCOMPATIBLE");
  if (candidates.every((c) => !c.observation_compatible)) reasons.push("OBSERVATION_UNSUPPORTED");
  if (candidates.every((c) => !c.verification_compatible)) reasons.push("VERIFICATION_UNSUPPORTED");
  if (candidates.every((c) => !c.measurement_compatible)) reasons.push("MEASUREMENT_UNAVAILABLE");
  if (query.requires_runtime_proof === true && candidates.every((c) => c.runtime_state !== "RUNTIME_PROVEN")) reasons.push("NOT_RUNTIME_PROVEN");
  return { candidates: [], no_suitable_self_resource: reasons.length > 0 ? reasons : ["NOT_RUNTIME_PROVEN"] };
}
