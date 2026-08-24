/**
 * หน้าที่: the real test for ../ai-write-control.ts. Proves: an ai_agent
 * identity's well-formed request becomes a real WriteIntent; an
 * external_program identity is also accepted; a human identity is
 * refused (control/owner-command/'s boundary is never crossed); malformed
 * operation/target_type/empty fields are refused.
 *
 * How to run: npx tsx control/ai-write-control/tests/ai-write-control.test.ts
 */

import { submitWriteRequest } from "../contract";
import type { RawWriteRequest } from "../contract";
import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function aiIdentity(kind: "ai_agent" | "external_program" | "human"): EnvelopeIdentity {
  return { identity_id: "identity-test-1", acting_as_account_id: "acct-1", acting_as_tenant_id: "tenant-1", software_id: "test-external-ai", kind };
}

function validRequest(overrides: Partial<RawWriteRequest> = {}): RawWriteRequest {
  return {
    operation: "CREATE",
    capability: "some-capability",
    target_type: "FILE",
    target_path: "connections/brand-new-thing/adapter.ts",
    requested_change: "add a new read-only adapter",
    ...overrides,
  };
}

function run(): void {
  console.log("=== control/ai-write-control/tests/ai-write-control.test.ts ===");

  {
    const outcome = submitWriteRequest(validRequest(), aiIdentity("ai_agent"));
    assert(outcome.ok, "well-formed request from an ai_agent identity succeeds");
    if (outcome.ok) {
      assert(outcome.intent.requesting_agent.kind === "ai_agent", "requesting_agent.kind is carried through honestly");
      assert(outcome.intent.intent_id.startsWith("wi_"), "a real intent_id is generated");
      assert(typeof outcome.intent.submitted_at === "string" && outcome.intent.submitted_at.length > 0, "submitted_at is a real timestamp");
    }
    console.log("PASS: ai_agent identity produces a real WriteIntent, never a decision");
  }

  {
    const outcome = submitWriteRequest(validRequest(), aiIdentity("external_program"));
    assert(outcome.ok, "external_program identity is also accepted");
    console.log("PASS: external_program identity is accepted (same as ai_agent)");
  }

  {
    const outcome = submitWriteRequest(validRequest(), aiIdentity("human"));
    assert(!outcome.ok, "a human identity is refused — control/owner-command/'s boundary is never crossed here");
    if (!outcome.ok) assert(outcome.reason.includes("human"), "refusal reason names the actual identity kind");
    console.log("PASS: human identity is refused (must go through control/owner-command/ instead)");
  }

  {
    const outcome = submitWriteRequest(validRequest({ operation: "DEPLOY" as unknown as RawWriteRequest["operation"] }), aiIdentity("ai_agent"));
    assert(!outcome.ok, "an unknown operation is refused");
    console.log("PASS: unknown operation refused");
  }

  {
    const outcome = submitWriteRequest(validRequest({ target_type: "DATABASE" as unknown as RawWriteRequest["target_type"] }), aiIdentity("ai_agent"));
    assert(!outcome.ok, "an unknown target_type is refused");
    console.log("PASS: unknown target_type refused");
  }

  {
    const outcome = submitWriteRequest(validRequest({ target_path: "" }), aiIdentity("ai_agent"));
    assert(!outcome.ok, "an empty target_path is refused");
    console.log("PASS: empty target_path refused");
  }

  console.log("=== ALL ai-write-control.test.ts CASES PASSED ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
