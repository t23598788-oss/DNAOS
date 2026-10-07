/**
 * หน้าที่: the real test for ../finding-decider.ts. Proves: an EVALUATED
 * TEST_FIXTURE finding decides REJECT -> RESOLVED; an EVALUATED
 * REAL_ISSUE with a security-sensitive warning_type decides FORBIDDEN ->
 * BLOCKED; an EVALUATED REAL_ISSUE otherwise decides NEEDS_FIX ->
 * ROUTABLE; deciding a non-EVALUATED finding is refused; and every
 * decision is traceable back to a real evaluation-evidence entry.
 *
 * How to run: npx tsx dna-os-circuit/runtime/tests/finding-decider.test.ts
 */

import { recordFinding } from "../finding-receiver";
import { evaluateFinding, listEvaluationEvidence } from "../finding-evaluator";
import { decideFinding } from "../finding-decider";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function fixturePayload(overrides: Record<string, unknown> = {}) {
  return {
    finding_id: `finding-decide-test-${Math.random().toString(36).slice(2)}`,
    source_system: "DNA-LAB-FILE-INTELLIGENCE",
    scan_id: "scan-decide-test",
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

/** records + evaluates a finding for real, returns the resulting ReceivedFinding (post-evaluation). */
function recordAndEvaluate(overrides: Record<string, unknown> = {}) {
  const stored = recordFinding(fixturePayload(overrides));
  if (!stored.ok) throw new Error("test setup failed to record finding");
  const evalOutcome = evaluateFinding(stored.received);
  if (!evalOutcome.ok) throw new Error(`test setup failed to evaluate finding: ${evalOutcome.reason}`);
  return stored.received;
}

function run(): void {
  console.log("=== dna-os-circuit/runtime/tests/finding-decider.test.ts ===");

  // 1. REAL_ISSUE (normal warning_type) decides NEEDS_FIX -> ROUTABLE.
  {
    const received = recordAndEvaluate();
    const outcome = decideFinding(received);
    assert(outcome.ok, "decideFinding succeeds for an EVALUATED finding");
    if (outcome.ok) {
      assert(outcome.record.decision === "NEEDS_FIX", "normal REAL_ISSUE finding decides NEEDS_FIX");
      assert(outcome.record.new_status === "ROUTABLE", "NEEDS_FIX maps to status ROUTABLE");
      assert(outcome.record.based_on_evaluation_evidence_id !== null, "decision links back to a real evaluation-evidence id");
    }
    console.log("PASS: REAL_ISSUE (non-security warning_type) decides NEEDS_FIX -> ROUTABLE");
  }

  // 2. TEST_FIXTURE decides REJECT -> RESOLVED.
  {
    const received = recordAndEvaluate({ owner_folder: "sandbox/violations/x" });
    const outcome = decideFinding(received);
    assert(outcome.ok, "decideFinding succeeds");
    if (outcome.ok) {
      assert(outcome.record.decision === "REJECT", "TEST_FIXTURE finding decides REJECT");
      assert(outcome.record.new_status === "RESOLVED", "REJECT maps to status RESOLVED");
    }
    console.log("PASS: TEST_FIXTURE finding decides REJECT -> RESOLVED");
  }

  // 3. REAL_ISSUE + security-sensitive warning_type decides FORBIDDEN -> BLOCKED.
  {
    const received = recordAndEvaluate({ warning_type: "HARDCODED_CREDENTIAL", evidence: ["found a literal-looking secret assignment"] });
    const outcome = decideFinding(received);
    assert(outcome.ok, "decideFinding succeeds");
    if (outcome.ok) {
      assert(outcome.record.decision === "FORBIDDEN", "HARDCODED_CREDENTIAL REAL_ISSUE decides FORBIDDEN");
      assert(outcome.record.new_status === "BLOCKED", "FORBIDDEN maps to status BLOCKED");
      assert(outcome.record.matched_evidence.includes("HARDCODED_CREDENTIAL"), "matched_evidence names the real warning_type that triggered this rule");
    }
    console.log("PASS: security-sensitive REAL_ISSUE (HARDCODED_CREDENTIAL) decides FORBIDDEN -> BLOCKED");
  }

  // 4. deciding a non-EVALUATED (still DETECTED) finding is refused.
  {
    const stored = recordFinding(fixturePayload());
    assert(stored.ok, "test setup: finding recorded");
    if (!stored.ok) return;
    const outcome = decideFinding(stored.received); // never evaluated — still DETECTED
    assert(!outcome.ok, "deciding a still-DETECTED (never evaluated) finding is refused");
    console.log("PASS: decideFinding refuses a finding that was never EVALUATED");
  }

  // 5. the decision is independently traceable: its based_on_evaluation_evidence_id really exists in listEvaluationEvidence().
  {
    const received = recordAndEvaluate();
    const outcome = decideFinding(received);
    assert(outcome.ok, "decideFinding succeeds");
    if (outcome.ok) {
      const linked = listEvaluationEvidence().find((e) => e.evaluation_evidence_id === outcome.record.based_on_evaluation_evidence_id);
      assert(linked !== undefined, "the decision's based_on_evaluation_evidence_id resolves to a REAL entry in the evaluation-evidence log");
      assert(linked!.finding_id === outcome.record.finding_id, "the linked evaluation-evidence entry is for the SAME finding_id, not a coincidental id match");
    }
    console.log("PASS: decision is independently traceable back to its real evaluation-evidence entry");
  }

  console.log("=== ALL finding-decider.test.ts CASES PASSED ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
