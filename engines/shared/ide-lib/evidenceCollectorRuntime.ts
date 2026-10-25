/**
 * Evidence Collector Runtime (Owner, 2026-08-09, GAP-1 — one-time
 * Advisor-role exception, Rule 252-style, scoped to this gap only per the
 * Owner's own explicit instruction: "การอนุญาตครั้งนี้ไม่เปลี่ยน Role
 * ถาวร... นี่คือ exception เฉพาะ GAP-1 เท่านั้น").
 *
 * First stage of the locked loop in LOCKED_WORKFLOW.md:
 *   Front Office / Worker / Connector / Runtime
 *     -> Evidence Collector (this file)
 *     -> Normalization (normalizationRuntime.ts)
 *     -> Factory Central Registry (registryWriterRuntime.ts)
 *     -> MANAGER-07
 *
 * Real, mechanical validation only — no judgment calls, no LLM grading its
 * own input. Per LOCKED_WORKFLOW.md principle 2 ("ทุกผลลัพธ์ต้องมี Evidence
 * ก่อนเข้าระบบกลาง ไม่เอาผลลัพธ์ที่ไม่มีหลักฐาน"), an observation with no
 * evidence[] is rejected here — it never reaches Normalization.
 */

export type EvidenceSourceType =
  | "official_docs" | "aggregator" | "internal_registry" | "worker_report" | "test_output";

export interface EvidenceItem {
  source_url: string | null; // null for internal (e.g. test output, not a URL)
  source_type: EvidenceSourceType;
  excerpt: string;
  captured_at: string; // ISO 8601
}

export type ObservationOrigin = "worker" | "front_office" | "connector" | "runtime";

export interface RawObservation {
  origin: ObservationOrigin;
  origin_entity: string; // e.g. "Worker-05", "Front Office AI", "line-messaging-api"
  subject: string;
  evidence: EvidenceItem[];
}

export interface ValidationResult {
  valid: boolean;
  reason: string | null;
}

const VALID_ORIGINS: ObservationOrigin[] = ["worker", "front_office", "connector", "runtime"];
const VALID_SOURCE_TYPES: EvidenceSourceType[] = [
  "official_docs", "aggregator", "internal_registry", "worker_report", "test_output",
];

/**
 * Real, mechanical checks only:
 *  - origin is one of the 4 declared values (LOCKED_WORKFLOW.md's own
 *    "Input: Worker / Front Office / Connector / Runtime Evidence")
 *  - subject is non-empty
 *  - evidence[] is non-empty (no evidence, no entry — hard gate, not advisory)
 *  - every evidence item has a valid source_type and a non-empty excerpt
 *  - every evidence item's captured_at parses as a real date
 */
export function validateObservation(obs: RawObservation): ValidationResult {
  if (!VALID_ORIGINS.includes(obs.origin)) {
    return { valid: false, reason: `unknown origin "${obs.origin}" — must be one of ${VALID_ORIGINS.join("/")}` };
  }
  if (!obs.origin_entity || !obs.origin_entity.trim()) {
    return { valid: false, reason: "origin_entity is required (who/what reported this)" };
  }
  if (!obs.subject || !obs.subject.trim()) {
    return { valid: false, reason: "subject is required and cannot be empty" };
  }
  if (!obs.evidence || obs.evidence.length === 0) {
    return { valid: false, reason: "no evidence — LOCKED_WORKFLOW.md principle 2 forbids an evidence-less entry from proceeding" };
  }
  for (let i = 0; i < obs.evidence.length; i++) {
    const item = obs.evidence[i];
    if (!VALID_SOURCE_TYPES.includes(item.source_type)) {
      return { valid: false, reason: `evidence[${i}].source_type "${item.source_type}" is not a recognized type` };
    }
    if (!item.excerpt || !item.excerpt.trim()) {
      return { valid: false, reason: `evidence[${i}].excerpt is empty` };
    }
    if (Number.isNaN(Date.parse(item.captured_at))) {
      return { valid: false, reason: `evidence[${i}].captured_at "${item.captured_at}" is not a valid ISO date` };
    }
  }
  return { valid: true, reason: null };
}

/**
 * Batch entry point — validates every observation, splits into accepted vs
 * rejected. Rejected observations are never silently dropped — the caller
 * (registryWriterRuntime.ts's own test/CLI path) is expected to report them,
 * not lose them.
 */
export function collectEvidence(observations: RawObservation[]): {
  accepted: RawObservation[];
  rejected: { observation: RawObservation; reason: string }[];
} {
  const accepted: RawObservation[] = [];
  const rejected: { observation: RawObservation; reason: string }[] = [];
  for (const obs of observations) {
    const result = validateObservation(obs);
    if (result.valid) accepted.push(obs);
    else rejected.push({ observation: obs, reason: result.reason! });
  }
  return { accepted, rejected };
}
