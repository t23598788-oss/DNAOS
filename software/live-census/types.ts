/**
 * หน้าที่: type contracts for `software/live-census/` — the DERIVED system
 * census. Every field below is COMPUTED from a real observable source (source
 * tree, git, tests, runtime, registry, evidence ledger); none is hand-authored.
 *
 * OWNER DIRECTIVE this exists to satisfy: DNA OS must never depend on a
 * manually maintained, frozen capability map that goes stale when code changes.
 * The census is therefore a FUNCTION of the repository, not a file someone
 * edits. `reports/*.md` and the previous 2026-08-24 Census remain as historical
 * evidence and are never rewritten by this module.
 *
 * Input: none (pure type definitions).
 * Output: the record/enum shapes below.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a `status: "VERIFIED"` that can be SET rather than
 * DERIVED. Verification state is computed by comparing a capability's current
 * source digest against the digest recorded when it was last verified — that
 * comparison is the entire anti-staleness mechanism. REGISTERED never implies
 * VERIFIED.
 */

/** How a capability's implementation currently stands. Derived, never assigned. */
export type CapabilityStatus =
  | "VERIFIED"
  | "CHANGED_SINCE_VERIFICATION"
  | "REQUIRES_REVERIFICATION"
  | "VERIFYING"
  | "PARTIAL"
  | "FAILED"
  | "UNVERIFIED"
  | "UNWIRED"
  | "DECLARED_ONLY"
  | "BLOCKED"
  | "LEGACY"
  | "SUPERSEDED"
  | "DUPLICATE"
  | "UNKNOWN";

/** Whether anything is actually running this capability right now. */
export type RuntimeState = "RUNNING" | "REGISTERED_NOT_RUNNING" | "NOT_APPLICABLE" | "UNKNOWN";

/** What test material exists — NOT whether it passed. Pass/fail lives in the evidence ledger. */
export type TestState = "HAS_TESTS" | "NO_TESTS" | "UNKNOWN";

export type RegistrationState = "REGISTERED" | "UNREGISTERED" | "REGISTERED_STALE" | "UNKNOWN";

/** What changed about a capability between two censuses. */
export type ChangeKind =
  | "SOURCE_CHANGED"
  | "DEPENDENCY_CHANGED"
  | "CONNECTION_CHANGED"
  | "RUNTIME_CHANGED"
  | "TEST_CHANGED"
  | "EVIDENCE_CHANGED"
  | "REGISTRY_CHANGED"
  | "CAPABILITY_ADDED"
  | "CAPABILITY_REMOVED"
  | "CAPABILITY_MOVED"
  | "CAPABILITY_REPLACED";

/**
 * One verification event, appended to the ledger when a capability is actually
 * proven. `source_digest` is the whole point: it pins WHAT was verified, so a
 * later census can tell that the code has moved on. Append-only — lineage is
 * preserved, never overwritten.
 */
export interface VerificationRecord {
  capability_key: string;
  /** Digest of the capability's source at the moment it was verified. */
  source_digest: string;
  verified_at: string;
  /** Real proof: a test file + its literal result, a runtime artifact path, a kernel observation. */
  evidence_ref: string;
  outcome: "VERIFIED" | "PARTIAL" | "FAILED" | "BLOCKED";
  /** Who/what produced this evidence — a session id, an agent id, "owner". */
  verified_by: string;
}

export interface CapabilityRecord {
  /** Stable identity: repository + path. Survives rename of the display name. */
  capability_key: string;
  capability_id: string | null;
  resource_id: string | null;
  canonical_name: string;
  domain: string;
  repository: string;
  path: string;
  entrypoint: string | null;
  /** Commit that last touched this path — derived from git, not recorded by hand. */
  version_commit: string | null;
  last_changed: string | null;
  owner_boundary: string;
  input_contract: readonly string[];
  output_contract: readonly string[];
  dependencies: readonly string[];
  callers: readonly string[];
  downstream: readonly string[];
  runtime_state: RuntimeState;
  test_state: TestState;
  test_files: readonly string[];
  verification_state: CapabilityStatus;
  evidence_references: readonly string[];
  registration_state: RegistrationState;
  /** Registry rows whose canonical_name matches this capability — more than one means duplicate registration. */
  registry_matches: readonly string[];
  lineage: readonly string[];
  supersedes: readonly string[];
  duplicates: readonly string[];
  security_boundary: readonly string[];
  /** Digest of the capability's current source. The anti-staleness anchor. */
  source_digest: string;
  last_observed: string;
  last_verified: string | null;
  current_status: CapabilityStatus;
  /** Why the status is what it is — so a reader never has to guess at a verdict. */
  status_reason: string;
}

export interface CensusDrift {
  capability_key: string;
  change: ChangeKind;
  detail: string;
}

export interface LiveCensus {
  generated_at: string;
  repository: string;
  head_commit: string | null;
  capabilities: readonly CapabilityRecord[];
  drift: readonly CensusDrift[];
  totals: Readonly<Record<string, number>>;
}

/** One edge of the live system graph, with its own derived state. */
export type EdgeState = "CONNECTED_VERIFIED" | "CONNECTED_UNVERIFIED" | "BROKEN" | "BYPASS" | "DECLARED_ONLY" | "UNKNOWN";

export interface GraphEdge {
  from: string;
  to: string;
  state: EdgeState;
  reason: string;
}
