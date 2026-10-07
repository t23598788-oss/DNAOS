/**
 * INTEGRATION_VERIFICATION_CLOSURE_V1 / HERMETIC_SOURCE_VERIFICATION_PROFILE_V1
 * How to run:
 *   npx tsx control/integration-verification-closure/tests/integration-verification-closure.test.ts
 */

import {
  AUTH_REQUIRED_EQUALS_PASS,
  DNA_OS_TEST_FIXTURE_CONTRACT,
  HERMETIC_SOURCE_VERIFICATION_PROFILE,
  INTEGRATION_VERIFICATION_CLOSURE,
  NOT_AVAILABLE_EQUALS_PASS,
  SOURCE_ADMISSION_VERIFICATION_PROFILE,
  VERIFICATION_GATE_CLASSIFICATION,
  VERIFICATION_GATES,
  classifyLiveDetail,
  isSourceSafeFixture,
  mcpQueenCycleAbsent,
  sourceAdmissionGates,
} from "../contract";
import { evaluateIntegrationAdmission } from "../../diverged-source-integration/contract";

declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const process: { exitCode?: number };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function check(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

check("A. Schema identifiers exist", () => {
  assert(INTEGRATION_VERIFICATION_CLOSURE === "INTEGRATION_VERIFICATION_CLOSURE_V1", "closure");
  assert(HERMETIC_SOURCE_VERIFICATION_PROFILE === "HERMETIC_SOURCE_VERIFICATION_PROFILE_V1", "profile");
  assert(VERIFICATION_GATE_CLASSIFICATION === "VERIFICATION_GATE_CLASSIFICATION_V1", "class");
  assert(SOURCE_ADMISSION_VERIFICATION_PROFILE === "SOURCE_ADMISSION_VERIFICATION_PROFILE_V1", "admission");
  assert(DNA_OS_TEST_FIXTURE_CONTRACT === "DNA_OS_TEST_FIXTURE_CONTRACT_V1", "fixture");
});

check("B. Typecheck is SOURCE_REQUIRED and required for admission", () => {
  const typecheck = VERIFICATION_GATES.find((row) => row.gate_id === "typecheck");
  assert(typecheck?.classification === "SOURCE_REQUIRED", String(typecheck?.classification));
  assert(typecheck?.required_for_source_admission === true, "required");
});

check("C. Live Owner command is ENVIRONMENT_REQUIRED and not admission-blocking", () => {
  const live = VERIFICATION_GATES.find((row) => row.gate_id === "owner-command-live");
  assert(live?.classification === "ENVIRONMENT_REQUIRED", String(live?.classification));
  assert(live?.required_for_source_admission === false, "not required");
});

check("D. Railway provider live is PROVIDER_REQUIRED", () => {
  const live = VERIFICATION_GATES.find((row) => row.gate_id === "railway-provider-live");
  assert(live?.classification === "PROVIDER_REQUIRED", String(live?.classification));
  assert(live?.required_for_source_admission === false, "not required");
});

check("E. Every gate has exactly one classification", () => {
  const classes = new Set(["SOURCE_REQUIRED", "HERMETIC_INTEGRATION_REQUIRED", "ENVIRONMENT_REQUIRED", "PROVIDER_REQUIRED", "PRODUCTION_REQUIRED"]);
  for (const gate of VERIFICATION_GATES) {
    assert(classes.has(gate.classification), gate.gate_id);
  }
});

check("F. Source admission gates exclude live provider/environment", () => {
  const ids = sourceAdmissionGates().map((row) => row.gate_id);
  assert(ids.includes("typecheck"), "typecheck");
  assert(ids.includes("mcp-server"), "mcp");
  assert(!ids.includes("owner-command-live"), "owner live");
  assert(!ids.includes("railway-provider-live"), "railway live");
  assert(!ids.includes("canonical-information-live"), "canonical live");
});

check("G. Fixture contract rejects secrets and runtime jsonl", () => {
  assert(isSourceSafeFixture({ marked_fixture: true, contains_secret: false, production_revision: false, runtime_jsonl: false }) === true, "safe");
  assert(isSourceSafeFixture({ marked_fixture: true, contains_secret: true, production_revision: false, runtime_jsonl: false }) === false, "secret");
  assert(isSourceSafeFixture({ marked_fixture: true, contains_secret: false, production_revision: false, runtime_jsonl: true }) === false, "jsonl");
  assert(isSourceSafeFixture({ marked_fixture: false, contains_secret: false, production_revision: false, runtime_jsonl: false }) === false, "unmarked");
});

check("H. NOT_AVAILABLE and AUTH_REQUIRED are not PASS", () => {
  assert(NOT_AVAILABLE_EQUALS_PASS === false, "na");
  assert(AUTH_REQUIRED_EQUALS_PASS === false, "auth");
  assert(classifyLiveDetail("AUTH_REQUIRED 401 unauthorized") === "AUTH_REQUIRED", "classify auth");
  assert(classifyLiveDetail("NOT_AVAILABLE language processor") === "NOT_AVAILABLE", "classify na");
  assert(classifyLiveDetail("assertion failed") === "FAIL", "classify fail");
});

check("I. Coding client cannot self-admit even if tests passed", () => {
  const denied = evaluateIntegrationAdmission({
    actor: "CODING_CLIENT",
    machine_verification_passed: true,
    remote_features_preserved: true,
    integration_workspace_isolated: true,
    integration_base_is_live_remote: true,
    git_add_all_used: false,
    force_push: false,
  });
  assert(denied.decision === "DENY", denied.reason_code);
});

check("J. Queen/tool-registry cycle is absent", () => {
  assert(mcpQueenCycleAbsent() === true, "cycle");
});

console.log(`integration-verification-closure ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
