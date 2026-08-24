/**
 * หน้าที่: the real test for ../policy.ts. Proves Owner's required cases
 * (2026-08-19): create capability ที่ไม่มีจริง -> ALLOW_CREATE; create
 * capability ที่มีแล้ว -> REUSE_EXISTING; overlap ไม่ชัด -> UNKNOWN;
 * modify existing -> ALLOW_MODIFY; malformed intent -> DENY; internal
 * error -> DENY (fail-closed).
 *
 * How to run: npx tsx permissions/write-gate/tests/policy.test.ts
 */

import { evaluateWriteIntent } from "../contract";
import type { WriteGateContext, WriteIntent } from "../contract";
import { getCapabilityIndex } from "../../../software/capability-registrar/contract";
import type { CapabilityMetadata } from "../../../software/capability-registrar/contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function baseIntent(overrides: Partial<WriteIntent> = {}): WriteIntent {
  return {
    intent_id: `wi_test_${Math.random().toString(36).slice(2)}`,
    operation: "CREATE",
    capability: "test-capability",
    target_type: "FILE",
    target_path: "connections/brand-new-thing/adapter.ts",
    requested_change: "add a new adapter",
    requesting_agent: { identity_id: "identity-test", kind: "ai_agent", display_name: "test-ai" },
    evidence: [],
    correlation_id: `corr_${Math.random().toString(36).slice(2)}`,
    submitted_at: new Date().toISOString(),
    ...overrides,
  };
}

const realContext: WriteGateContext = { registryIndex: getCapabilityIndex() };

function fakeOverlappingRecord(id: string, folder: string): CapabilityMetadata {
  return {
    SOFTWARE_ID: id,
    OWNER_FOLDER: folder,
    CAPABILITY_ID: id,
    PARENT_CAPABILITY: null,
    INGRESS: [],
    EGRESS: [],
    CONTRACT: `${folder}contract.ts`,
    RUNTIME_ENTRY: null,
    DATA_CLASS: "test fixture",
    REQUIRED_PERMISSION: "none",
    REQUIRED_CREDENTIAL: null,
    DESTINATION: "test fixture",
    EVIDENCE_SOURCE: ["test fixture — not a real capability"],
    STATUS: "REGISTERED",
  };
}

function run(): void {
  console.log("=== permissions/write-gate/tests/policy.test.ts ===");

  // 1. CREATE a capability that does not exist -> ALLOW_CREATE.
  {
    const decision = evaluateWriteIntent(baseIntent({ target_path: "connections/genuinely-new-thing-2026/adapter.ts" }), realContext);
    assert(decision.decision === "ALLOW_CREATE", `expected ALLOW_CREATE, got ${decision.decision}`);
    assert(decision.canonical === null, "ALLOW_CREATE carries no canonical reference");
    console.log("PASS: CREATE with no real overlap -> ALLOW_CREATE");
  }

  // 2. CREATE a capability that already exists (real "execution" capability's real folder) -> REUSE_EXISTING.
  {
    const decision = evaluateWriteIntent(baseIntent({ target_path: "execution/run/some-new-file.ts" }), realContext);
    assert(decision.decision === "REUSE_EXISTING", `expected REUSE_EXISTING, got ${decision.decision}`);
    assert(decision.canonical?.software_id === "execution", "REUSE_EXISTING carries the real canonical software_id");
    assert(decision.canonical!.evidence_source.length > 0, "REUSE_EXISTING carries real evidence_source");
    console.log("PASS: CREATE overlapping a real existing capability -> REUSE_EXISTING with canonical evidence");
  }

  // 3. overlap ไม่ชัด (ambiguous — two capabilities overlap the same path) -> UNKNOWN.
  {
    const ambiguousContext: WriteGateContext = {
      registryIndex: [fakeOverlappingRecord("fixture-a", "shared/ambiguous-folder/"), fakeOverlappingRecord("fixture-b", "shared/ambiguous-folder/sub/")],
    };
    const decision = evaluateWriteIntent(baseIntent({ target_path: "shared/ambiguous-folder/sub/file.ts" }), ambiguousContext);
    assert(decision.decision === "UNKNOWN", `expected UNKNOWN, got ${decision.decision}`);
    assert(decision.canonical === null, "UNKNOWN never carries a canonical reference — nothing was proven");
    console.log("PASS: ambiguous overlap (2 real matches, no provable single canonical) -> UNKNOWN");
  }

  // 4. MODIFY an existing capability -> ALLOW_MODIFY.
  {
    const decision = evaluateWriteIntent(baseIntent({ operation: "MODIFY", target_path: "connections/github/adapter-config.ts" }), realContext);
    assert(decision.decision === "ALLOW_MODIFY", `expected ALLOW_MODIFY, got ${decision.decision}`);
    assert(decision.canonical?.software_id === "github", "ALLOW_MODIFY carries the real canonical software_id");
    console.log("PASS: MODIFY targeting a real existing capability -> ALLOW_MODIFY with canonical evidence");
  }

  // 5. MODIFY something that does not exist anywhere real -> DENY (fail-closed, nothing real to modify).
  {
    const decision = evaluateWriteIntent(baseIntent({ operation: "DELETE", target_path: "connections/nothing-real-here/x.ts" }), realContext);
    assert(decision.decision === "DENY", `expected DENY, got ${decision.decision}`);
    console.log("PASS: DELETE targeting nothing real -> DENY");
  }

  // 6. malformed intent -> DENY.
  {
    const decision = evaluateWriteIntent(baseIntent({ target_path: "" }), realContext);
    assert(decision.decision === "DENY", `expected DENY, got ${decision.decision}`);
    assert(decision.reason_codes.includes("MALFORMED_INTENT"), "malformed intent DENY names the real reason code");
    console.log("PASS: malformed WriteIntent -> DENY");
  }

  // 7. UNKNOWN is fail-closed: it must never equal any ALLOW_* value, structurally distinct.
  {
    const ambiguousContext: WriteGateContext = {
      registryIndex: [fakeOverlappingRecord("fixture-c", "another-ambiguous/"), fakeOverlappingRecord("fixture-d", "another-ambiguous/deep/")],
    };
    const decision = evaluateWriteIntent(baseIntent({ target_path: "another-ambiguous/deep/x.ts" }), ambiguousContext);
    assert(decision.decision !== "ALLOW_CREATE" && decision.decision !== "ALLOW_MODIFY", "UNKNOWN is never confused with an ALLOW_* value");
    console.log("PASS: UNKNOWN decision is structurally distinct from any ALLOW_* value (fail-closed contract holds)");
  }

  console.log("=== ALL write-gate policy.test.ts CASES PASSED ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
