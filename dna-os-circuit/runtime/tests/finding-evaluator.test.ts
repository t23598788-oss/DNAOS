/**
 * หน้าที่: the real test for ../finding-evaluator.ts. Proves: a
 * DETECTED finding with a normal (non-fixture) path is classified
 * REAL_ISSUE; one whose owner_folder/files_involved names a real
 * test-fixture area is classified TEST_FIXTURE; the finding's own status
 * flips to EVALUATED; re-evaluating an already-EVALUATED finding is
 * refused (not silently re-run); and every verdict is independently
 * traceable via listEvaluationEvidence(), separate from the finding
 * record itself.
 *
 * How to run: npx tsx dna-os-circuit/runtime/tests/finding-evaluator.test.ts
 */

import { recordFinding } from "../finding-receiver";
import { evaluateFinding, evaluateAllDetected, listEvaluationEvidence } from "../finding-evaluator";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function fixturePayload(overrides: Record<string, unknown> = {}) {
  return {
    finding_id: `finding-eval-test-${Math.random().toString(36).slice(2)}`,
    source_system: "DNA-LAB-FILE-INTELLIGENCE",
    scan_id: "scan-eval-test",
    warning_type: "ORPHAN",
    evidence: ["no importer found"],
    owner_folder: "some/real/source/folder",
    capability_id: null,
    files_involved: ["some/real/source/folder/file.ts"],
    detected_at: "2026-08-18T00:00:00.000Z",
    severity: null,
    classification: "UNKNOWN",
    status: "DETECTED",
    ...overrides,
  };
}

function run(): void {
  console.log("=== dna-os-circuit/runtime/tests/finding-evaluator.test.ts ===");

  // 1. a normal-path finding evaluates to REAL_ISSUE with a real, traceable rule.
  {
    const stored = recordFinding(fixturePayload());
    assert(stored.ok, "test setup: finding recorded");
    if (!stored.ok) return;
    const outcome = evaluateFinding(stored.received);
    assert(outcome.ok, "evaluateFinding succeeds for a DETECTED finding");
    if (outcome.ok) {
      assert(outcome.verdict.classification === "REAL_ISSUE", "normal-path finding classifies REAL_ISSUE");
      assert(outcome.verdict.rule_fired === "default_real_issue", "rule_fired names the real default rule");
      assert(outcome.verdict.finding_id === stored.received.finding.finding_id, "verdict.finding_id matches the evaluated finding");
    }
    console.log("PASS: normal-path finding evaluates to REAL_ISSUE via the real default rule");
  }

  // 2. a finding whose path names a real test-fixture area classifies TEST_FIXTURE.
  {
    const stored = recordFinding(fixturePayload({ owner_folder: "sandbox/violations/15_semantic_duplicate", finding_id: `finding-eval-test-fixture-${Math.random().toString(36).slice(2)}` }));
    assert(stored.ok, "test setup: fixture-path finding recorded");
    if (!stored.ok) return;
    const outcome = evaluateFinding(stored.received);
    assert(outcome.ok, "evaluateFinding succeeds");
    if (outcome.ok) {
      assert(outcome.verdict.classification === "TEST_FIXTURE", "fixture-path finding classifies TEST_FIXTURE");
      assert(outcome.verdict.rule_fired === "owner_folder_matches_test_fixture_pattern", "rule_fired names the real path-match rule");
      assert(outcome.verdict.matched_evidence === "sandbox/violations/15_semantic_duplicate", "matched_evidence is the exact real owner_folder value, not a paraphrase");
    }
    console.log("PASS: real test-fixture path classifies TEST_FIXTURE with exact matched_evidence");
  }

  // 3. status really flips to EVALUATED, and re-evaluation is refused, not silently re-run.
  {
    const stored = recordFinding(fixturePayload({ finding_id: `finding-eval-test-status-${Math.random().toString(36).slice(2)}` }));
    if (!stored.ok) return;
    const first = evaluateFinding(stored.received);
    assert(first.ok, "first evaluation succeeds");
    const second = evaluateFinding(stored.received); // same stale ReceivedFinding object, still says DETECTED
    assert(!second.ok, "re-evaluating an object whose finding.status no longer matches the store's real DETECTED state is refused");
    console.log("PASS: evaluateFinding refuses to re-run on a non-DETECTED finding");
  }

  // 4. evaluateAllDetected processes every real DETECTED finding, and every verdict is independently traceable.
  {
    const before = listEvaluationEvidence().length;
    recordFinding(fixturePayload({ finding_id: `finding-eval-test-batch-a-${Math.random().toString(36).slice(2)}` }));
    recordFinding(fixturePayload({ finding_id: `finding-eval-test-batch-b-${Math.random().toString(36).slice(2)}`, owner_folder: "security-lab/targets/x" }));
    const outcomes = evaluateAllDetected();
    assert(outcomes.length >= 2, "evaluateAllDetected processes at least the 2 freshly-added DETECTED findings");
    assert(outcomes.every((o) => o.ok), "every outcome in this batch succeeds");
    assert(listEvaluationEvidence().length >= before + 2, "listEvaluationEvidence grows by at least the number of newly evaluated findings — independently traceable evidence, not just the in-memory outcome list");
    console.log("PASS: evaluateAllDetected processes every real DETECTED finding with independently traceable evidence");
  }

  console.log("=== ALL finding-evaluator.test.ts CASES PASSED ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
