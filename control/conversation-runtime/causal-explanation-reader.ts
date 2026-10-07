/**
 * หน้าที่: CONNECT_HUMAN_CAUSAL_EXPLANATION_READER (Owner UNLOCK
 * 2026-09-06). READ + ASSEMBLE FACTS + EXPLAIN ONLY — this file owns zero
 * facts. Every fact it states comes from a real, already-proven query in
 * `control/causal-change-chain/contract.ts` (`whyDidThisRelationshipChange`,
 * `whatChangedBecauseOf`); it never calls `recordRelationshipChange`,
 * `deriveImpact`, `evaluateCapabilityStateEffect`,
 * `evaluateMetricInvalidation`, or `evaluateProjectionInvalidation` — those
 * are write/derive-time producers, not something a conversation asks for
 * on demand.
 *
 * REFERENCE-DRIVEN, NOT GUESSED: a causal question must name the
 * `relationship_id` it is asking about, literally, in the Owner's text
 * (a UUID or a `test-relationship-<...>` token — the same identifiers a
 * real runtime event or the PHASE 8 proof already surfaces to the Owner).
 * If none is found, or more than one distinct one is found, this says so
 * honestly rather than picking one — the same AMBIGUOUS-fails-closed rule
 * `./subject-router.ts#resolveSubject` already applies to capability
 * labels.
 *
 * ONE RELATIONSHIP_ID DRIVES THE WHOLE ANSWER: `whyDidThisRelationshipChange`
 * returns the real `RelationshipChangeRecord` (subject/cause/reason/
 * evidence); its own `change_id` is then the ONLY key used to ask
 * `whatChangedBecauseOf` for the derived impact / capability-state effect /
 * metric invalidation / projection invalidation. No field here is ever
 * inferred from a timestamp or a file name — every UNKNOWN stays UNKNOWN.
 *
 * Input: raw Owner text.
 * Output: `classifyCausalQuestion(text)` (question-type detection),
 * `extractCausalReference(text)` (reference resolution, fails closed on
 * ambiguity), `answerCausalExplanationQuery(reference, questionType)` (the
 * assembled, evidence-traceable answer).
 * Dependency ที่อนุญาต: `../causal-change-chain/query-only.ts` (read-only
 * queries only — NOT `./contract.ts`, whose `deriveImpact`/
 * `evaluateCapabilityStateEffect` pull in `../machine-model/contract`, whose
 * own closure reaches `control/command-router/router.ts` → agent-host,
 * digitalocean, github connectors, etc. — proven by a real `tsc` build that
 * emitted 513 files instead of the isolated ~26 when this file imported
 * `./contract.ts` directly. `query-only.ts` has no such import).
 * สิ่งที่ห้ามแตะ: ห้ามแก้ causal-change-chain logic เดิม. ห้ามเดา cause/
 * reason/impact เมื่อ query จริงคืนค่า null. ห้าม auto-repair/auto-recompute/
 * auto-rebuild ใดๆ จากไฟล์นี้ — บอกแค่ว่าอะไรถูกทำเครื่องหมายไว้.
 */

import { whatChangedBecauseOf, whyDidThisRelationshipChange } from "../causal-change-chain/query-only";
import type { RelationshipChangeRecord } from "../causal-change-chain/types";

export type CausalQuestionType =
  | "WHY_DID_CHANGE"
  | "WHAT_CHANGED_BECAUSE_OF"
  | "WHAT_WAS_AFFECTED"
  | "WHY_METRIC_STALE"
  | "WHY_PROJECTION_INVALIDATED";

const REFERENCE_PATTERNS: readonly RegExp[] = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  /test-relationship-[0-9]+/gi,
];

// Order matters: metric/projection-specific shapes are checked before the
// generic WHY_DID_CHANGE/WHAT_WAS_AFFECTED shapes so a question naming
// "metric"/"projection" is never misclassified as a plain relationship
// question. Each pattern is a pair of independent keyword checks (not a
// fixed-distance window) since a real relationship/change reference token
// embedded between the keywords (a UUID, `test-relationship-<...>`) can be
// far longer than any fixed proximity window.
function hasBoth(text: string, a: RegExp, b: RegExp): boolean {
  return a.test(text) && b.test(text);
}

const QUESTION_TYPE_CHECKS: readonly [CausalQuestionType, (text: string) => boolean][] = [
  ["WHY_METRIC_STALE", (t) => /metric/i.test(t) && /(ตรวจใหม่|stale|recompute)/i.test(t)],
  ["WHY_PROJECTION_INVALIDATED", (t) => /projection/i.test(t) && /(refresh|invalidat)/i.test(t)],
  ["WHAT_CHANGED_BECAUSE_OF", (t) => hasBoth(t, /ทำให้/, /เปลี่ยนตาม/) || /because of this change|changed because of/i.test(t)],
  ["WHAT_WAS_AFFECTED", (t) => /กระทบอะไร|ได้รับผลจาก|what was affected|impact of this/i.test(t)],
  ["WHY_DID_CHANGE", (t) => (/ทำไม/.test(t) && /(เปลี่ยน|ถูกลบ|ถูกนำออก)/.test(t)) || hasBoth(t, /เปลี่ยน/, /เพราะอะไร/) || /why.*(chang|remov)/i.test(t)],
];

/** Any shape at all recognized as a causal question — used by the router to decide whether to even look for a reference. */
export function isCausalQuestionShape(text: string): boolean {
  return QUESTION_TYPE_CHECKS.some(([, check]) => check(text));
}

export function classifyCausalQuestion(text: string): CausalQuestionType | null {
  for (const [type, check] of QUESTION_TYPE_CHECKS) {
    if (check(text)) return type;
  }
  return null;
}

export type CausalReferenceResolution =
  | { readonly kind: "RESOLVED"; readonly relationship_id: string }
  | { readonly kind: "AMBIGUOUS"; readonly candidates: readonly string[] }
  | { readonly kind: "NONE" };

/** PHASE 1: reference resolution, independent of question type — fails closed on more than one distinct match, never guesses. */
export function extractCausalReference(text: string): CausalReferenceResolution {
  const found = new Set<string>();
  for (const pattern of REFERENCE_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.add(match[0]);
  }
  const candidates = [...found];
  if (candidates.length === 0) return { kind: "NONE" };
  if (candidates.length > 1) return { kind: "AMBIGUOUS", candidates };
  return { kind: "RESOLVED", relationship_id: candidates[0] };
}

export interface CausalExplanationResult {
  readonly answer: string;
  readonly status: "ANSWERED" | "UNRESOLVED";
  readonly fields: {
    readonly SUBJECT: string;
    readonly CHANGE: string;
    readonly CAUSE: string;
    readonly REASON: string;
    readonly IMPACT: string;
    readonly STATE_EFFECT: string;
    readonly METRIC_EFFECT: string;
    readonly PROJECTION_EFFECT: string;
  };
  readonly evidence_refs: readonly string[];
  readonly change_record: RelationshipChangeRecord | null;
}

function causeLine(record: RelationshipChangeRecord): string {
  const parts: string[] = [];
  parts.push(record.caused_by_request_id ? `จากคำสั่ง ${record.caused_by_request_id}` : "ไม่พบหลักฐานว่าใครสั่ง (caused_by_request_id = UNKNOWN)");
  if (record.caused_by_work_id) parts.push(`งาน ${record.caused_by_work_id}`);
  if (record.caused_by_event_id) parts.push(`เหตุการณ์ ${record.caused_by_event_id}`);
  return parts.join(", ");
}

/**
 * PHASE 2: assembles the fixed field set from real records only.
 * `whyDidThisRelationshipChange` returning `null` (old, pre-system history,
 * or a reference that never existed) produces an honest UNRESOLVED with
 * every field UNKNOWN — never an inferred answer.
 */
export function answerCausalExplanationQuery(relationshipId: string, questionType: CausalQuestionType): CausalExplanationResult {
  const record = whyDidThisRelationshipChange(relationshipId);
  if (!record) {
    return {
      answer: `พบว่า relationship "${relationshipId}" ไม่มีบันทึกการเปลี่ยนแปลงในระบบ causal-change-chain — อาจเป็นเพราะเกิดขึ้นก่อนระบบนี้จะถูกสร้าง (ไม่ backfill ข้อมูลเก่า) หรือ id นี้ไม่มีอยู่จริง`,
      status: "UNRESOLVED",
      fields: {
        SUBJECT: "UNKNOWN",
        CHANGE: "UNKNOWN",
        CAUSE: "UNKNOWN",
        REASON: "UNKNOWN",
        IMPACT: "UNKNOWN",
        STATE_EFFECT: "UNKNOWN",
        METRIC_EFFECT: "UNKNOWN",
        PROJECTION_EFFECT: "UNKNOWN",
      },
      evidence_refs: [],
      change_record: null,
    };
  }

  const consequences = whatChangedBecauseOf(record.change_id);
  const impactText = consequences.impact && consequences.impact.affected_subject_ids.length > 0
    ? `กระทบ ${consequences.impact.affected_subject_ids.join(", ")}`
    : "ไม่พบ capability อื่นที่ได้รับผลกระทบจาก dependency graph จริง";
  const stateText = consequences.capability_state_changes.length > 0
    ? consequences.capability_state_changes.map((s) => `${s.subject_id}: ${s.before_status ?? "UNKNOWN"} → ${s.after_status ?? "UNKNOWN"}`).join("; ")
    : "ยังไม่พบหลักฐานว่า state ของ capability ใดเปลี่ยนจริง";
  const metricText = consequences.metric_invalidations.length > 0
    ? consequences.metric_invalidations.map((m) => `${m.metric_id} ถูกทำเครื่องหมาย ${m.measurement_state}`).join("; ")
    : "ไม่มี metric ใดถูกทำเครื่องหมายว่าต้องตรวจใหม่จากการเปลี่ยนนี้";
  const projectionText = consequences.projection_invalidations.length > 0
    ? consequences.projection_invalidations.map((p) => `${p.projection_id} ถูกทำเครื่องหมายว่าต้อง refresh`).join("; ")
    : "ไม่มี projection ใดถูกทำเครื่องหมายว่าต้อง refresh จากการเปลี่ยนนี้";

  const fields = {
    SUBJECT: record.subject_id,
    CHANGE: `${record.change_type} (${record.change_id})`,
    CAUSE: causeLine(record),
    REASON: record.reason_detail ?? record.reason_code ?? "UNKNOWN",
    IMPACT: impactText,
    STATE_EFFECT: stateText,
    METRIC_EFFECT: metricText,
    PROJECTION_EFFECT: projectionText,
  };

  let answer: string;
  switch (questionType) {
    case "WHY_DID_CHANGE":
      answer = `relationship ${relationshipId} (${record.change_type}) เปลี่ยนแปลง${causeLine(record)}. เหตุผลที่บันทึกไว้: ${fields.REASON}`;
      break;
    case "WHAT_CHANGED_BECAUSE_OF":
      answer = `จากการเปลี่ยน ${record.change_id}: ${impactText}. ${stateText}. ${metricText}. ${projectionText}`;
      break;
    case "WHAT_WAS_AFFECTED":
      answer = `${impactText} (จาก dependency graph จริงของ control/machine-model)`;
      break;
    case "WHY_METRIC_STALE":
      answer = metricText;
      break;
    case "WHY_PROJECTION_INVALIDATED":
      answer = projectionText;
      break;
  }

  return {
    answer,
    status: "ANSWERED",
    fields,
    evidence_refs: [
      ...record.evidence_refs,
      ...(consequences.impact?.evidence_refs ?? []),
      "control/causal-change-chain/contract.ts#whyDidThisRelationshipChange",
      "control/causal-change-chain/contract.ts#whatChangedBecauseOf",
    ],
    change_record: record,
  };
}
