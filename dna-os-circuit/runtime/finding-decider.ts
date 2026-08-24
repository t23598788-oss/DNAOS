/**
 * หน้าที่: the real DECISION step — Owner, 2026-08-18: "EVALUATED แค่
 * ตอบว่า 'สิ่งที่ตรวจพบคืออะไรและมีหลักฐานอะไร' ส่วน DECISION ต้องตอบว่า
 * แล้วระบบตัดสินใจทำอะไรกับ finding นั้น... และ decision นั้นต้องย้อนกลับ
 * ไปหา evaluation + evidence เดิมได้เหมือนกัน". Same discipline as
 * ./finding-evaluator.ts: every decision traces to one real, checkable
 * rule over the finding's own EVALUATED `classification` and real
 * `warning_type` — never an AI guess, never invented signal.
 *
 * Real v1 rules (conservative — only 3 of the 5 real
 * `FindingDecisionOutcome` values are reachable today, honestly, because
 * only `REAL_ISSUE`/`TEST_FIXTURE` classifications exist yet — see
 * ../../contracts/worker/finding-event.ts's own note on `ACCEPT`/
 * `FORWARD` being currently unreachable):
 *   - classification TEST_FIXTURE                              -> REJECT   -> status RESOLVED
 *   - classification REAL_ISSUE + security-sensitive warning_type
 *     (HARDCODED_CREDENTIAL, DIRECT_DATABASE_ACCESS)            -> FORBIDDEN -> status BLOCKED
 *   - classification REAL_ISSUE + everything else               -> NEEDS_FIX -> status ROUTABLE
 *
 * Input: `ReceivedFinding` (must be EVALUATED — checked against the
 * authoritative store, never the caller's own possibly-stale copy, same
 * anti-staleness fix already applied in finding-evaluator.ts).
 * Output: `FindingDecisionRecord`, `decideFinding`, `decideAllEvaluated`,
 * `listDecisionEvidence`.
 * Dependency ที่อนุญาต: ./finding-receiver.ts, ./finding-evaluator.ts
 * (type + listEvaluationEvidence, to link a decision back to the exact
 * evaluation it was based on), ./host-runtime.ts,
 * ../../contracts/worker/finding-event.ts (type only).
 * สิ่งที่ห้ามแตะ: never let this file create/route a WorkRequest — a
 * `NEEDS_FIX` decision only ever sets `status: "ROUTABLE"`, it does not
 * itself route anywhere (WorkRequest conversion remains NOT_BUILT, see
 * ../../contracts/worker/finding-event-gap.ts). Never decide a finding
 * whose status is not currently `"EVALUATED"` — a decision without a
 * real evaluation behind it would have nothing real to trace back to.
 */

import type { FindingDecisionOutcome, FindingStatus } from "../../contracts/worker/finding-event";
import type { ReceivedFinding } from "./finding-receiver";
import { applyDecision, listPersistedFindings } from "./finding-receiver";
import { listEvaluationEvidence } from "./finding-evaluator";
import { hostRandomId, readFileUtf8, writeFileUtf8, fileExists, joinPath, repoRootDirname } from "./host-runtime";

/** Real, security-sensitive warning types — see this file's header for why only these two currently trigger FORBIDDEN, not a broader guess. */
const SECURITY_SENSITIVE_WARNING_TYPES = new Set(["HARDCODED_CREDENTIAL", "DIRECT_DATABASE_ACCESS"]);

/** The one real FindingStatus each decision outcome maps to. ACCEPT/FORWARD included for completeness even though unreachable by today's real rules (see this file's header). */
const DECISION_STATUS_MAP: Record<FindingDecisionOutcome, FindingStatus> = {
  ACCEPT: "ROUTABLE",
  REJECT: "RESOLVED",
  NEEDS_FIX: "ROUTABLE",
  FORWARD: "TRIAGED",
  FORBIDDEN: "BLOCKED",
};

export interface FindingDecisionRecord {
  finding_id: string;
  scan_id: string;
  decision: FindingDecisionOutcome;
  rule_fired: string;
  /** The exact real classification/warning_type value that made this rule fire — never a paraphrase. */
  matched_evidence: string;
  /** Links this decision back to the exact evaluation it was based on — the "ย้อนกลับไปหา evaluation" requirement, made a real, checkable field rather than an implicit assumption. `null` only if no matching evaluation-evidence entry could be found (should not happen for a real EVALUATED finding; recorded honestly if it does). */
  based_on_evaluation_evidence_id: string | null;
  new_status: FindingStatus;
  decided_at: string;
  decision_evidence_id: string;
}

/** Real rule set — see this file's header. */
function decide(finding: ReceivedFinding["finding"]): { decision: FindingDecisionOutcome; rule_fired: string; matched_evidence: string } {
  if (finding.classification === "TEST_FIXTURE") {
    return { decision: "REJECT", rule_fired: "test_fixture_rejected", matched_evidence: `classification=${finding.classification}` };
  }
  if (finding.classification === "REAL_ISSUE" && SECURITY_SENSITIVE_WARNING_TYPES.has(finding.warning_type)) {
    return { decision: "FORBIDDEN", rule_fired: "security_sensitive_warning_type_forbidden", matched_evidence: `warning_type=${finding.warning_type}` };
  }
  if (finding.classification === "REAL_ISSUE") {
    return { decision: "NEEDS_FIX", rule_fired: "real_issue_needs_fix", matched_evidence: `classification=${finding.classification}, warning_type=${finding.warning_type}` };
  }
  // classification is UNKNOWN or a not-yet-reachable value (EXPECTED_DEPENDENCY/FALSE_POSITIVE) —
  // honestly forwarded for human review rather than guessed.
  return { decision: "FORWARD", rule_fired: "unclassified_or_unreachable_classification_forwarded", matched_evidence: `classification=${finding.classification}` };
}

const DECISION_EVIDENCE_FILE_RELATIVE = "dna-os-circuit/runtime/findings-decision-evidence.json";

function decisionEvidencePath(): string {
  return joinPath(repoRootDirname(), DECISION_EVIDENCE_FILE_RELATIVE);
}

function appendDecisionEvidence(record: FindingDecisionRecord): void {
  const p = decisionEvidencePath();
  let existing: FindingDecisionRecord[] = [];
  if (fileExists(p)) {
    try {
      const parsed = JSON.parse(readFileUtf8(p));
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      // A corrupt evidence file must never crash decision-making — start fresh rather than throw.
    }
  }
  existing.push(record);
  writeFileUtf8(p, JSON.stringify(existing, null, 2));
}

export type DecideFindingOutcome = { ok: true; record: FindingDecisionRecord } | { ok: false; reason: string };

/**
 * Decides ONE finding by id: re-reads its CURRENT record from the
 * authoritative store (never trusts the caller's possibly-stale
 * `received` argument's own status — same fix already applied in
 * finding-evaluator.ts), refuses unless status is currently `"EVALUATED"`,
 * applies the real rule, links back to the real evaluation-evidence entry
 * that produced this finding's classification, updates status via
 * `applyDecision`, and appends a durable decision-evidence record.
 */
export function decideFinding(received: ReceivedFinding): DecideFindingOutcome {
  const current = listPersistedFindings().find((r) => r.finding.finding_id === received.finding.finding_id);
  if (current === undefined) {
    return { ok: false, reason: `no finding with finding_id "${received.finding.finding_id}" is known to this receiver` };
  }
  if (current.finding.status !== "EVALUATED") {
    return { ok: false, reason: `finding "${current.finding.finding_id}" has current status "${current.finding.status}", not "EVALUATED" — refusing to decide without a real evaluation behind it` };
  }

  const { decision, rule_fired, matched_evidence } = decide(current.finding);
  const new_status = DECISION_STATUS_MAP[decision];

  // Real traceability link: find this finding's own evaluation-evidence entry (its verdict is
  // what current.finding.classification already reflects) so the decision record points at the
  // exact real evaluation it was based on, not just an assumption that one exists.
  const linkedEvaluation = listEvaluationEvidence()
    .filter((e) => e.finding_id === current.finding.finding_id)
    .sort((a, b) => (a.evaluated_at < b.evaluated_at ? 1 : -1))[0];

  const record: FindingDecisionRecord = {
    finding_id: current.finding.finding_id,
    scan_id: current.finding.scan_id,
    decision,
    rule_fired,
    matched_evidence,
    based_on_evaluation_evidence_id: linkedEvaluation?.evaluation_evidence_id ?? null,
    new_status,
    decided_at: new Date().toISOString(),
    decision_evidence_id: `dec-${hostRandomId()}`,
  };

  const applied = applyDecision(current.finding.finding_id, new_status);
  if (!applied.ok) {
    return { ok: false, reason: applied.reason };
  }

  appendDecisionEvidence(record);

  return { ok: true, record };
}

/** The real batch "Decision Engine" pass — every currently-EVALUATED finding, one real decision each. */
export function decideAllEvaluated(): DecideFindingOutcome[] {
  const evaluated = listPersistedFindings().filter((r) => r.finding.status === "EVALUATED");
  return evaluated.map((r) => decideFinding(r));
}

/** The full durable decision-evidence trail — every decision is traceable back to its own rule, its matched real field, and the exact evaluation-evidence entry it was based on. */
export function listDecisionEvidence(): readonly FindingDecisionRecord[] {
  const p = decisionEvidencePath();
  if (!fileExists(p)) return [];
  try {
    const parsed = JSON.parse(readFileUtf8(p));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
