/**
 * หน้าที่: the real test for ../finding-receiver.ts — plain assert-based,
 * matching this repo's `npx tsx <file>` convention. Proves: a
 * well-formed FindingEvent-shaped payload is stored with a real
 * received_at; capability_id/severity are corrected to null even if a
 * malicious/buggy sender asserts otherwise; a malformed payload is
 * rejected, never silently stored.
 *
 * How to run: npx tsx dna-os-circuit/runtime/tests/finding-receiver.test.ts
 */

import { recordFinding, listFindings } from "../finding-receiver";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function run(): void {
  console.log("=== dna-os-circuit/runtime/finding-receiver.test.ts ===");

  const validPayload = {
    finding_id: "finding-test-scan-1-abc",
    source_system: "DNA-LAB-FILE-INTELLIGENCE",
    scan_id: "scan-test-1",
    warning_type: "ORPHAN",
    evidence: ["no importer found for this file"],
    owner_folder: "some/folder",
    capability_id: null,
    files_involved: ["some/folder/file.ts"],
    detected_at: "2026-08-18T00:00:00.000Z",
    severity: null,
    classification: "UNKNOWN",
    status: "DETECTED",
  };

  // 1. a well-formed payload is accepted and stored with a real received_at.
  {
    const before = listFindings().length;
    const outcome = recordFinding(validPayload);
    assert(outcome.ok, "well-formed FindingEvent payload is accepted");
    if (outcome.ok) {
      assert(outcome.received.finding.finding_id === "finding-test-scan-1-abc", "stored finding_id matches the real payload");
      assert(outcome.received.finding.scan_id === "scan-test-1", "stored scan_id matches the real payload");
      assert(typeof outcome.received.received_at === "string" && outcome.received.received_at.length > 0, "received_at is a real timestamp");
      assert(typeof outcome.received.receiver_evidence_id === "string" && outcome.received.receiver_evidence_id.startsWith("recv-"), "receiver_evidence_id is real and prefixed");
    }
    assert(listFindings().length === before + 1, "listFindings() reflects the newly recorded finding");
    console.log("PASS: well-formed FindingEvent is accepted and stored with real evidence fields");
  }

  // 2. capability_id/severity asserted non-null by the sender are corrected to null, never trusted.
  {
    const outcome = recordFinding({ ...validPayload, finding_id: "finding-test-scan-1-def", capability_id: "some-capability-i-should-not-be-trusted", severity: "CRITICAL" });
    assert(outcome.ok, "payload with untrusted capability_id/severity is still accepted (fields are corrected, not rejected)");
    if (outcome.ok) {
      assert(outcome.received.finding.capability_id === null, "capability_id asserted by the sender is corrected to null, never trusted");
      assert(outcome.received.finding.severity === null, "severity asserted by the sender is corrected to null, never trusted");
    }
    console.log("PASS: capability_id/severity are never trusted from the sender, always corrected to null");
  }

  // 3. a malformed payload (missing required fields) is rejected, never silently stored.
  {
    const before = listFindings().length;
    const outcome = recordFinding({ finding_id: "incomplete-only" });
    assert(!outcome.ok, "malformed payload (missing required fields) is rejected");
    assert(listFindings().length === before, "a rejected payload is never stored");
    console.log("PASS: malformed payload is rejected, never silently stored");
  }

  console.log("=== ALL finding-receiver.test.ts CASES PASSED ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
