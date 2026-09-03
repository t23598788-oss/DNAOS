/**
 * หน้าที่: type contracts for `control/alert-correlation/` — turning a
 * provider's alert EMAIL into a correlated incident state, using the real
 * current runtime state as the deciding evidence rather than the email's
 * own claim.
 *
 * THE ONE RULE: an email is a CLAIM, never a verdict. Every incident
 * state in this folder is decided by comparing the email's claim against
 * a freshly-observed system fact. No AI participates in that decision —
 * see ./correlate.ts.
 *
 * Input: none (pure type definitions).
 * Output: `RawAlertEmail`, `AlertEvent`, `AlertField`, `ResolvedTarget`,
 * `CurrentStateObservation`, `IncidentState`, `IncidentAssessment`,
 * `DedupVerdict`, `DedupIdentity`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller supply an
 * already-decided `IncidentState` — the state must always be derived
 * here from a real observation. Never let `UNKNOWN` be replaced by a
 * guessed value: a field the parser could not prove is `UNKNOWN`
 * forever, and downstream must treat it as absent, never as a default.
 */

/**
 * A raw email as handed in by ANY reader. Deliberately source-agnostic:
 * this folder never talks to Gmail, IMAP, or any mail API itself, so the
 * reader can be swapped (today: an operator-invoked fetch; tomorrow: a
 * credentialed worker) without touching a single line of the pipeline.
 * See ./README.md's INGESTION SEAM section for why that matters here.
 */
export interface RawAlertEmail {
  readonly message_id: string;
  readonly thread_id: string;
  readonly sender: string;
  /** RFC3339 UTC, exactly as the mail source reported it — never re-derived. */
  readonly received_at: string;
  readonly subject: string;
  /** Plain-text body. May be empty; parsers must handle that without throwing. */
  readonly body: string;
}

/**
 * Every extracted field is either a proven string or the literal
 * `"UNKNOWN"`. There is no `null`, no `""`, and no default — so a
 * consumer can never mistake "we could not find it" for "it is absent",
 * and a reader of the evidence can always tell which fields the parser
 * actually proved.
 */
export type AlertField = string;
export const UNKNOWN = "UNKNOWN" as const;

/**
 * Distinct from UNKNOWN on purpose (Owner, PHASE 4). UNKNOWN means "the
 * parser could not find this field at all". UNRESOLVED means "we looked
 * the sender up against the registered providers and none matched" — a
 * different, actionable fact. An UNRESOLVED provider MUST still flow
 * through correlation and stay visible; it is never a reason to discard
 * an email.
 */
export const PROVIDER_UNRESOLVED = "UNRESOLVED" as const;

export type AlertType =
  | "BUILD_FAILED"
  | "DEPLOY_FAILED"
  | "SERVICE_ERROR_SPIKE"
  | "SECURITY_ADVISORY"
  | "BILLING_FAILURE"
  | "UNCLASSIFIED";

/** The deterministic facts a parser proved from one email. Nothing inferred. */
export interface AlertEvent {
  readonly message_id: string;
  readonly thread_id: string;
  readonly sender: string;
  readonly received_at: string;
  /** Registry-known provider slug, or PROVIDER_UNRESOLVED when no registered sender domain matched. Never a reason to discard the email. */
  readonly provider: AlertField;
  readonly project: AlertField;
  readonly service: AlertField;
  readonly environment: AlertField;
  readonly alert_type: AlertType;
  /** The provider's own words for what it claims happened — a CLAIM, not a state. */
  readonly reported_status: AlertField;
  readonly deployment_id: AlertField;
  readonly build_id: AlertField;
  readonly error_code: AlertField;
  readonly region: AlertField;
  readonly referenced_url: AlertField;
  /** Stable pointer back to the source message, so evidence is re-checkable. */
  readonly raw_message_reference: string;
  /** Which named parser produced this, for provenance. */
  readonly parsed_by: string;
}

/** Resolution of a provider's own service name onto something DNA OS knows. */
export interface ResolvedTarget {
  readonly resolved: boolean;
  /** A real, probe-able URL when resolution succeeded; UNKNOWN otherwise. */
  readonly health_url: AlertField;
  /** Real repo path backing this service, when one is known. */
  readonly repo_path: AlertField;
  /** Why resolution succeeded or failed — always populated, never empty. */
  readonly reason: string;
}

/** A freshly-observed system fact. This is what outranks the email. */
export interface CurrentStateObservation {
  readonly observed_at: string;
  readonly probe_target: AlertField;
  readonly reachable: boolean;
  readonly http_status: number | null;
  readonly detail: string;
}

export type IncidentState =
  /** Email claims failure AND the system is currently unhealthy. */
  | "ACTIVE_INCIDENT"
  /** Email claims failure BUT the system is healthy now — the alert is history. */
  | "ALERT_HISTORICAL_RECOVERED"
  /** The email could not be tied to any service DNA OS knows. */
  | "UNRESOLVED_ALERT"
  /** Resolved, but no probe could be performed, so no claim is made either way. */
  | "UNVERIFIABLE";

export interface IncidentAssessment {
  readonly incident_state: IncidentState;
  readonly alert: AlertEvent;
  readonly target: ResolvedTarget;
  readonly observation: CurrentStateObservation | null;
  /** Seconds between the email's claim and the observation that judged it. */
  readonly claim_to_observation_seconds: number | null;
  /** Full, human-readable derivation — every state must justify itself. */
  readonly evidence: readonly string[];
}

export type DedupVerdict =
  | "NEW_INCIDENT"
  | "UPDATE_EXISTING_INCIDENT"
  | "DUPLICATE_ALERT"
  | "RECOVERY_NOTICE";

/**
 * The deterministic dedup key.
 *
 * NOTE, proven against real mail (see ./tests/runtime-proof.test.ts case B):
 * `thread_id` is deliberately NOT part of this key. Railway groups build
 * failures for DIFFERENT services into ONE Gmail thread — the real thread
 * `1a03cb91688a2d24` carries four messages covering two distinct services.
 * Keying on thread_id would collapse two genuine incidents into one and
 * silently lose an outage. The service is what identifies the incident.
 */
export interface DedupIdentity {
  readonly provider: AlertField;
  readonly project: AlertField;
  readonly service: AlertField;
  readonly alert_type: AlertType;
  /** Bucket index; alerts for the same target inside one window are the same incident. */
  readonly window_index: number;
}
