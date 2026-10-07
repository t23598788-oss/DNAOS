/**
 * หน้าที่: the real "Evaluation Engine" for Owner's DETECTED -> Evaluation
 * Engine -> EVALUATED line (2026-08-18, confirmed: a new deterministic
 * evaluator built inside this repo, not a call to 5177 — the Research &
 * Evaluation Engine's real job is measuring executions, a different
 * concern, per this repo's own locked loop diagram).
 *
 * DELIBERATELY NOT an AI judgment call — every classification below
 * traces to one real, checkable rule applied to the finding's own real
 * fields (`owner_folder`, `files_involved`), never a guess. This is a
 * conservative v1: it only ever produces `"REAL_ISSUE"` (the honest
 * default — every File Intelligence warning type already represents a
 * real, evidence-based anomaly the scanner detected) or `"TEST_FIXTURE"`
 * (when the finding's own path clearly names a known test/fixture area
 * of the scanned repo). It never produces `"EXPECTED_DEPENDENCY"` or
 * `"FALSE_POSITIVE"` — there is no real signal in a FindingEvent today
 * that would justify either without guessing, so this evaluator refuses
 * to invent one (matches this repo's own "never invent" discipline,
 * applied to classification the same way it's applied everywhere else).
 *
 * Input: `ReceivedFinding` (from ./finding-receiver.ts).
 * Output: `EvaluationVerdict`, `evaluateFinding`, `evaluateAllDetected`.
 * Dependency ที่อนุญาต: ./finding-receiver.ts, ./host-runtime.ts,
 * ../../contracts/worker/finding-event.ts (type only).
 * สิ่งที่ห้ามแตะ: never add a rule that classifies based on `warning_type`
 * alone with no reference to the finding's own real path fields — that
 * would be a blanket guess dressed up as a rule. Never let this file
 * import from `execution/run/` or `control/command-router/` — a finding
 * being EVALUATED must never itself trigger execution (Owner: "Circuit
 * must NOT create a WorkRequest yet").
 */

import type { FindingEvent } from "../../contracts/worker/finding-event";
import type { ReceivedFinding } from "./finding-receiver";
import { applyEvaluation, listPersistedFindings } from "./finding-receiver";
import { hostRandomId, readFileUtf8, writeFileUtf8, fileExists, joinPath, repoRootDirname } from "./host-runtime";

/** Real path segments that indicate a known test/fixture area of a scanned repo — not a guess: these are the actual folder names DNA-LAB-FILE-INTELLIGENCE's own sandbox/security-lab machinery uses to hold intentionally-duplicated/violating fixtures (verified 2026-08-17/18 against that repo's real folder structure: sandbox/, sandbox/violations/, security-lab/fake-data/, security-lab/targets/). */
const TEST_FIXTURE_PATH_PATTERN = /(^|\/)(sandbox|fixtures?|violations|security-lab)(\/|$)/i;

export interface EvaluationVerdict {
  finding_id: string;
  scan_id: string;
  classification: FindingEvent["classification"];
  rule_fired: string;
  /** The exact real string (a path or evidence entry already present on the finding) that made this rule fire — never a paraphrase, always traceable back to the finding's own data. */
  matched_evidence: string;
  evaluated_at: string;
  evaluation_evidence_id: string;
}

/**
 * The one real rule set. Checks `owner_folder` first, then each of
 * `files_involved`, against `TEST_FIXTURE_PATH_PATTERN`. The first real
 * match wins and is recorded verbatim in `matched_evidence`; no match
 * means `"REAL_ISSUE"` with `rule_fired: "default_real_issue"` — the
 * honest default, not an absence of a rule.
 */
function classify(finding: FindingEvent): { classification: FindingEvent["classification"]; rule_fired: string; matched_evidence: string } {
  if (TEST_FIXTURE_PATH_PATTERN.test(finding.owner_folder)) {
    return { classification: "TEST_FIXTURE", rule_fired: "owner_folder_matches_test_fixture_pattern", matched_evidence: finding.owner_folder };
  }
  for (const path of finding.files_involved) {
    if (TEST_FIXTURE_PATH_PATTERN.test(path)) {
      return { classification: "TEST_FIXTURE", rule_fired: "files_involved_matches_test_fixture_pattern", matched_evidence: path };
    }
  }
  return { classification: "REAL_ISSUE", rule_fired: "default_real_issue", matched_evidence: `warning_type=${finding.warning_type} with no test-fixture path match` };
}

const EVALUATION_EVIDENCE_FILE_RELATIVE = "dna-os-circuit/runtime/findings-evaluation-evidence.json";

function evaluationEvidencePath(): string {
  return joinPath(repoRootDirname(), EVALUATION_EVIDENCE_FILE_RELATIVE);
}

function appendEvaluationEvidence(verdict: EvaluationVerdict): void {
  const p = evaluationEvidencePath();
  let existing: EvaluationVerdict[] = [];
  if (fileExists(p)) {
    try {
      const parsed = JSON.parse(readFileUtf8(p));
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      // A corrupt evidence file must never crash evaluation — start fresh rather than throw.
    }
  }
  existing.push(verdict);
  writeFileUtf8(p, JSON.stringify(existing, null, 2));
}

export type EvaluateFindingOutcome = { ok: true; verdict: EvaluationVerdict } | { ok: false; reason: string };

/**
 * Evaluates ONE finding by id: real rule -> real verdict ->
 * `finding-receiver.ts`'s `applyEvaluation` updates its `classification`/
 * `status` in place -> the verdict itself (including which real evidence
 * fired the rule) is appended to a durable, append-only evaluation
 * evidence file, separate from the finding's own record, so "how did
 * this finding get evaluated" stays independently traceable even if the
 * finding record is later updated again by a future step.
 *
 * The DETECTED-only guard below re-reads the finding's CURRENT status
 * from the authoritative store (`listPersistedFindings()`), never trusts
 * the caller's `received` argument's own `.finding.status` — a caller
 * holding a stale snapshot (e.g. fetched before another evaluation
 * already ran) must not be able to bypass the guard just because its own
 * copy is out of date. `received` still supplies which finding_id to
 * evaluate.
 */
export function evaluateFinding(received: ReceivedFinding): EvaluateFindingOutcome {
  const current = listPersistedFindings().find((r) => r.finding.finding_id === received.finding.finding_id);
  if (current === undefined) {
    return { ok: false, reason: `no finding with finding_id "${received.finding.finding_id}" is known to this receiver` };
  }
  if (current.finding.status !== "DETECTED") {
    return { ok: false, reason: `finding "${current.finding.finding_id}" has current status "${current.finding.status}", not "DETECTED" — refusing to re-evaluate` };
  }

  const { classification, rule_fired, matched_evidence } = classify(current.finding);

  const verdict: EvaluationVerdict = {
    finding_id: current.finding.finding_id,
    scan_id: current.finding.scan_id,
    classification,
    rule_fired,
    matched_evidence,
    evaluated_at: new Date().toISOString(),
    evaluation_evidence_id: `eval-${hostRandomId()}`,
  };

  const applied = applyEvaluation(current.finding.finding_id, classification, "EVALUATED");
  if (!applied.ok) {
    return { ok: false, reason: applied.reason };
  }

  appendEvaluationEvidence(verdict);

  return { ok: true, verdict };
}

/** Runs evaluateFinding over every currently-DETECTED finding in the authoritative store — the real batch "Evaluation Engine" pass. Returns every real per-finding outcome, never a swallowed summary. */
export function evaluateAllDetected(): EvaluateFindingOutcome[] {
  const detected = listPersistedFindings().filter((r) => r.finding.status === "DETECTED");
  return detected.map((r) => evaluateFinding(r));
}

/** The full durable evaluation-evidence trail — used by GET /findings/evaluation-evidence so any finding's verdict is traceable back independently of its current record. */
export function listEvaluationEvidence(): readonly EvaluationVerdict[] {
  const p = evaluationEvidencePath();
  if (!fileExists(p)) return [];
  try {
    const parsed = JSON.parse(readFileUtf8(p));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
