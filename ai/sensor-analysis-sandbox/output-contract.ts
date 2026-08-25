/**
 * หน้าที่: the STRUCTURED OUTPUT CONTRACT for `ai/sensor-analysis-sandbox/`,
 * and the deterministic validator that enforces it (Owner, 2026-08-26).
 *
 * THE VALIDATOR IS THE GUARANTEE, NOT THE PROMPT. A prompt asking a model not
 * to invent things is a request; this file is a check. Every id the model
 * claims is looked up in the input it was given, and every occurrence_count it
 * states is compared against the count the SQL pattern actually holds. A
 * finding that references an event that was never in the input, or that
 * inflates a count, is REJECTED here — the model cannot talk its way past it.
 *
 * There is also no path from this output back into DNA OS. Nothing in this
 * folder executes, evaluates, or dispatches anything the model returned: the
 * output is data that gets validated and written to a file, full stop.
 *
 * Input: the raw text the sandbox process printed + the `SandboxInput` it was
 * given.
 * Output: `ValidationResult` — either a typed `SandboxOutput` or the exact
 * reasons it was refused.
 * Dependency ที่อนุญาต: ./input-contract.ts.
 * สิ่งที่ห้ามแตะ:
 * - ห้าม eval/exec/spawn อะไรก็ตามจาก output ของโมเดล — ไม่มีบรรทัดไหนในโฟลเดอร์
 *   นี้ที่ทำแบบนั้น และห้ามเพิ่ม.
 * - ห้ามผ่อนปรน validator เพื่อให้ผลลัพธ์ "ดูดีขึ้น" — a rejected analysis is a
 *   real result, and is reported as one.
 */

import { referenceUniverse, type SandboxInput } from "./input-contract";

export const ANOMALY_CLASSES = [
  "REPEATED_SEQUENCE",
  "REPEATED_FAILURE",
  "LATENCY_OUTLIER",
  "UNEXPECTED_TRANSITION",
  "NONE",
  "INSUFFICIENT_EVIDENCE",
] as const;
export type AnomalyClass = (typeof ANOMALY_CLASSES)[number];

export const PATTERN_TYPES = [
  "repeated_sequence",
  "repeated_failure",
  "joint_health",
  "latency_outlier",
  "unexpected_transition",
  "none",
] as const;
export type PatternType = (typeof PATTERN_TYPES)[number];

export const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export interface SandboxFinding {
  joint_id: string | null;
  pattern_type: PatternType;
  /** Which row of which input pattern this claim rests on, e.g. the exact state_sequence string. */
  pattern_reference: string | null;
  occurrence_count: number | null;
  anomaly_class: AnomalyClass;
  related_event_ids: string[];
  evidence_refs: string[];
  confidence: Confidence;
  unknowns: string[];
}

export interface SandboxOutput {
  analysis_id: string;
  window: { from: string; to: string };
  findings: SandboxFinding[];
  insufficient_evidence: boolean;
  unknowns: string[];
}

export type ValidationResult =
  | { ok: true; output: SandboxOutput }
  | { ok: false; reasons: string[] };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** The reference strings that really exist in the input's pattern rows. A finding citing anything else is not checkable, and is refused. */
export function knownPatternReferences(input: SandboxInput): Set<string> {
  const references = new Set<string>();
  for (const row of input.patterns.repeated_sequence as Record<string, unknown>[]) if (typeof row.state_sequence === "string") references.add(row.state_sequence);
  for (const row of input.patterns.repeated_failure as Record<string, unknown>[]) if (typeof row.failure_class === "string") references.add(row.failure_class);
  return references;
}

/** The occurrence counts the SQL patterns really hold, keyed by the reference string a finding may cite. */
function trueOccurrenceCounts(input: SandboxInput): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of input.patterns.repeated_sequence as Record<string, unknown>[]) {
    if (typeof row.state_sequence === "string" && typeof row.occurrences === "number") counts.set(row.state_sequence, row.occurrences);
  }
  for (const row of input.patterns.repeated_failure as Record<string, unknown>[]) {
    if (typeof row.failure_class === "string" && typeof row.occurrences === "number") counts.set(row.failure_class, row.occurrences);
  }
  return counts;
}

export function validateSandboxOutput(rawText: string, input: SandboxInput): ValidationResult {
  const reasons: string[] = [];

  // The model may only return JSON. A fenced block is tolerated because it is a
  // formatting habit, not a factual claim; anything else is a refusal.
  const trimmed = rawText.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return { ok: false, reasons: [`output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reasons: ["output is not a JSON object"] };

  const body = parsed as Record<string, unknown>;
  const allowedTop = new Set(["analysis_id", "window", "findings", "insufficient_evidence", "unknowns"]);
  for (const key of Object.keys(body)) if (!allowedTop.has(key)) reasons.push(`unexpected top-level field: ${key}`);

  if (body.analysis_id !== input.analysis_id) reasons.push(`analysis_id must echo the input's (${input.analysis_id}), got ${String(body.analysis_id)}`);
  const window = body.window as Record<string, unknown> | undefined;
  if (!window || window.from !== input.window.from || window.to !== input.window.to) reasons.push("window must echo the input window exactly");
  if (typeof body.insufficient_evidence !== "boolean") reasons.push("insufficient_evidence must be a boolean");
  if (!isStringArray(body.unknowns)) reasons.push("unknowns must be an array of strings");
  if (!Array.isArray(body.findings)) return { ok: false, reasons: [...reasons, "findings must be an array"] };

  const universe = referenceUniverse(input);
  const counts = trueOccurrenceCounts(input);
  const references = knownPatternReferences(input);
  const findings: SandboxFinding[] = [];

  body.findings.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { reasons.push(`findings[${index}] is not an object`); return; }
    const finding = raw as Record<string, unknown>;
    const allowedFinding = new Set(["joint_id", "pattern_type", "pattern_reference", "occurrence_count", "anomaly_class", "related_event_ids", "evidence_refs", "confidence", "unknowns"]);
    for (const key of Object.keys(finding)) if (!allowedFinding.has(key)) reasons.push(`findings[${index}] has unexpected field: ${key}`);

    if (!PATTERN_TYPES.includes(finding.pattern_type as PatternType)) reasons.push(`findings[${index}].pattern_type invalid: ${String(finding.pattern_type)}`);
    if (!ANOMALY_CLASSES.includes(finding.anomaly_class as AnomalyClass)) reasons.push(`findings[${index}].anomaly_class invalid: ${String(finding.anomaly_class)}`);
    if (!CONFIDENCE_LEVELS.includes(finding.confidence as Confidence)) reasons.push(`findings[${index}].confidence invalid: ${String(finding.confidence)}`);

    // FABRICATION CHECKS — the reason this validator exists.
    if (finding.joint_id !== null && typeof finding.joint_id === "string" && !universe.jointIds.has(finding.joint_id)) {
      reasons.push(`findings[${index}].joint_id was never in the input: ${finding.joint_id}`);
    }
    if (!isStringArray(finding.related_event_ids)) {
      reasons.push(`findings[${index}].related_event_ids must be an array of strings`);
    } else {
      for (const id of finding.related_event_ids) if (!universe.eventIds.has(id)) reasons.push(`findings[${index}] cites an event_id that was never in the input: ${id}`);
    }
    if (!isStringArray(finding.evidence_refs)) {
      reasons.push(`findings[${index}].evidence_refs must be an array of strings`);
    } else {
      for (const ref of finding.evidence_refs) if (!universe.evidenceRefs.has(ref)) reasons.push(`findings[${index}] cites an evidence_ref that was never in the input: ${ref}`);
    }
    // A reference that is not one of the input's own pattern rows cannot be
    // checked against anything, so it cannot be published either (added
    // 2026-08-26 when wiring the report adapter: an uncheckable reference
    // would have reached the Monitor as if it were established).
    if (typeof finding.pattern_reference === "string" &&
        (finding.pattern_type === "repeated_sequence" || finding.pattern_type === "repeated_failure") &&
        !references.has(finding.pattern_reference)) {
      reasons.push(`findings[${index}].pattern_reference is not one of the input's pattern rows: ${finding.pattern_reference}`);
    }
    if (typeof finding.occurrence_count === "number" && typeof finding.pattern_reference === "string") {
      const real = counts.get(finding.pattern_reference);
      if (real !== undefined && real !== finding.occurrence_count) {
        reasons.push(`findings[${index}].occurrence_count is ${finding.occurrence_count} but the input pattern "${finding.pattern_reference}" holds ${real}`);
      }
    }
    if (!isStringArray(finding.unknowns)) reasons.push(`findings[${index}].unknowns must be an array of strings`);

    findings.push(finding as unknown as SandboxFinding);
  });

  // An empty input cannot license a positive claim.
  const inputHasAnyPattern =
    input.patterns.repeated_sequence.length > 0 || input.patterns.repeated_failure.length > 0 ||
    input.patterns.latency_outlier.length > 0 || input.patterns.unexpected_transition.length > 0;
  if (!inputHasAnyPattern) {
    for (const [index, finding] of findings.entries()) {
      if (finding.anomaly_class !== "NONE" && finding.anomaly_class !== "INSUFFICIENT_EVIDENCE") {
        reasons.push(`findings[${index}] claims ${finding.anomaly_class} but the input contained no pattern rows at all`);
      }
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    output: {
      analysis_id: body.analysis_id as string,
      window: input.window,
      findings,
      insufficient_evidence: body.insufficient_evidence as boolean,
      unknowns: body.unknowns as string[],
    },
  };
}
