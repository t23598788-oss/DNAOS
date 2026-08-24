/**
 * หน้าที่: the missing contract boundary Phase 16's addendum proved
 * necessary — `contracts/worker/finding-event.ts` is closed to
 * `RealFileIntelligenceWarningType` (14 source-code-specific values) and
 * must stay that way (its own header: "never confuse this file's
 * FindingClassification with... never populate capability_id from
 * anything other than a real, proven match"). World/business evidence
 * (a price, a regulation, a job-listing count) is a different semantic
 * domain entirely — this file represents OBSERVATIONS, never
 * conclusions. No field here may ever hold "business_is_good",
 * "should_invest", "recommended_business", or an AI confidence score
 * treated as fact.
 *
 * Searched first, found none: grepped every *.ts in this repo for
 * ObservationEvent/EvidenceEvent/ResearchEvent/SignalEvent/
 * TelemetryEvent/ExternalEvent/FactEvent — zero hits (Phase 17). This is
 * the one new capability boundary that search justified.
 *
 * Input: none (pure type definitions).
 * Output: `Source`, `Observation`, `Metric`, `Subject`, `ObservationEvent`.
 * Dependency ที่อนุญาต: none — leaf contract, same discipline as
 * `contracts/identity/envelope-identity.ts`.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller assert a business
 * conclusion (good/bad, invest/don't, confidence-as-truth) — an
 * ObservationEvent may only ever state "X was observed by Y at time Z",
 * never "therefore do W". Never let `verification_status` be inferred —
 * it must be set by whatever extraction step produced this event, and
 * defaults to the least-trusting value when uncertain.
 */

/** Where the observation came from — a real, named source, never "the internet" or "AI knowledge". */
export interface Source {
  source_id: string;
  source_url: string | null;
  source_type: string;
  observed_at: string;
}

/** What kind of thing is being measured/observed — a real-world entity, never a DNA OS internal one. */
export interface Subject {
  subject_id: string;
  subject_type: string;
  geography: string | null;
  market_domain: string | null;
}

/** The measured quantity or fact itself — a metric name + value + unit, or a qualitative claim when no numeric unit applies. */
export interface Metric {
  metric_name: string;
  value: unknown;
  unit: string | null;
}

export type VerificationStatus = "UNVERIFIED_SINGLE_SOURCE" | "CROSS_CONFIRMED_MULTI_SOURCE" | "UNVERIFIED_ABSENCE_SINGLE_SEARCH" | "VERIFIED_PRIMARY_SOURCE";
export type EvidenceStatus = "MEASURED" | "KNOWN" | "ESTIMATED" | "UNKNOWN";

/**
 * ONE observation, ONE fact, full provenance. This is the only shape
 * `reports/phase16-world-evidence/`'s adapter (see ./adapter contract,
 * same folder) may emit — never a business conclusion, never a
 * candidate score.
 */
export interface ObservationEvent {
  observation_id: string;
  source: Source;
  subject: Subject;
  metric: Metric;
  extraction_method: string;
  verification_status: VerificationStatus;
  evidence_status: EvidenceStatus;
  freshness_rule: string | null;
  expires_at: string | null;
  /** Where this observation came from inside DNA OS's own data — never lost, never rewritten. */
  origin_registry: string;
  origin_record_id: string;
}
