/**
 * หน้าที่: ลงทะเบียน n8n เป็น "test/execution RESOURCE" ของ DNA OS ตาม CAPABILITY
 * (ไม่ route ด้วยชื่อ "n8n") + ลงทะเบียน harness เอง (Owner, 2026-09-03 —
 * BUILD_N8N_SYSTEM_BEHAVIOR_TEST_HARNESS).
 *
 * n8n = TEST DRIVER/OBSERVER/REGRESSION RUNNER เท่านั้น — ไม่ใช่ Core/Registry/
 * decision/permission/repair authority. ขับ DNA OS ผ่าน boundary จริง :8791
 * (client ของ boundary สาธารณะเดิม ไม่ใช่ listener ใหม่ ไม่ใช่ bypass).
 *
 * หลักฐาน: real-first-suite รันจริงผ่าน :8791 = 15/15 PASS
 * (tests/system-behavior-harness/test-run-evidence.json). live deploy บน :5678
 * = BLOCKED (n8n-api-key 401 บน instance นี้) — ไม่ bypass auth.
 *
 * Output: N8N_TEST_HARNESS_CANDIDATES. ห้ามใส่ credential.
 */
import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

const HARNESS = "tests/system-behavior-harness";
const EV = [
  "real-first-suite executed through real boundary 127.0.0.1:8791 = 15/15 PASS",
  "evidence: tests/system-behavior-harness/test-run-evidence.json",
  "matrix: tests/system-behavior-harness/canonical-test-matrix.json",
  "behavior-coverage: tests/system-behavior-harness/behavior-coverage-map.json",
  "importable n8n workflows: tests/system-behavior-harness/n8n-workflows/ (TEST_CASE_RUNNER, BEHAVIOR_SUITE_REAL_FIRST)",
  "direction: n8n(:5678 loopback) -> DNA OS real boundary(:8791); orchestrator/observer only, not authority",
  "live_n8n_deploy_status:BLOCKED (credential://macos-keychain/dna-os/n8n-api-key -> 401 on :5678; retired-host key; no bypass)",
  "no_backdoors: no ?test=true/skipPermission/fakeResource/forcePass/directDatabaseMutation",
  "live_business_data_damaged:NO",
];
const COMMON = {
  kind: "capability" as const, version: "1.0.0",
  domain: "SOFTWARE_CONTROL_PLANE" as const, resource_type: "CAPABILITY" as const,
  data_classification: "INTERNAL", source_system: "dna-os-infrastructure",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/n8n-behavior-test-harness.ts",
  origin: {
    origin_kind: "EXTERNAL_TEST_ORCHESTRATOR",
    origin_reference: "TASK:BUILD_N8N_SYSTEM_BEHAVIOR_TEST_HARNESS",
    introduced_by: "software/capability-registrar/register-n8n-behavior-test-harness.ts",
  },
};
function cap(name: string, purpose: string, extra: string[] = []): RegistrationCandidate {
  // Each capability owns its OWN existing folder (CAPABILITY_FOLDER_LAW §10):
  // distinct source_location per capability, no shared/overlapping owner.
  const folder = name === "system-behavior-test-harness" ? HARNESS : `${HARNESS}/roles/${name}`;
  return {
    ...COMMON,
    candidate_id: `candidate-${name}-v1`,
    name,
    source_location: folder,
    input: ["test_case object {test_case_id,method,path,payload,asserts}"],
    output: ["verdict PASS/FAIL/BLOCKED", "per-case evidence {request,http_status,body_excerpt}"],
    side_effects: ["drives real :8791 boundary (read + reversible registry fixture); NO live business data"],
    dependencies: ["DNA OS Core HTTP boundary 127.0.0.1:8791", "n8n :5678 (external, loopback)"],
    behavior: `${purpose} n8n is TEST DRIVER/OBSERVER only, not Core/Registry/decision/permission/repair authority; selected by capability, never by provider name. ${extra.join(" ")}`,
    evidence_refs: EV,
    scope: `test/${name}`,
  } as RegistrationCandidate;
}
export const N8N_TEST_HARNESS_CANDIDATES: readonly RegistrationCandidate[] = [
  cap("behavior-test-orchestration", "Orchestrate DNA OS behavior tests across real execution boundaries (SETUP->INVOKE->OBSERVE->ASSERT->EVIDENCE->CLEANUP->REPORT)."),
  cap("workflow-test-execution", "Execute a test case as an n8n workflow that invokes a real DNA OS boundary and asserts on the real response."),
  cap("integration-test-execution", "Run multi-boundary integration tests (owner command -> plan -> resource resolution -> evidence) via real boundaries."),
  cap("regression-suite-execution", "Run the real-first regression suite (15 boundary cases) and produce a pass/fail matrix with evidence."),
  // NO umbrella capability: an umbrella owning tests/system-behavior-harness/ would be an
  // ANCESTOR of the 4 role folders (roles/<role>/). Different capabilities owning nesting
  // folders => AMBIGUOUS_OVERLAP in write-ownership-index (whole subtree write-DENY) +
  // DUPLICATE_OR_OVERLAPPING in runCapabilityFolderLawGate. The 4 non-nesting role folders
  // fully represent "n8n as test resource by capability". Harness knowledge readback
  // (matrix/coverage/README) should be a SOURCE_REFERENCE *resource* (kind:resource) pointing
  // at a FILE, not a capability — added separately so it is not subject to the folder law.
  // CONSTRAINT (folder-law gate rule 1): that file-pointing knowledge resource must NOT be
  // linked in resource_capabilities.jsonl as a capability's OWNER, or it is flagged
  // CAPABILITY_WITHOUT_OWN_FOLDER / REJECT. Keep it unlinked, or link only under a
  // non-ownership relationship kind.
  //
  // COMPLETION NOTE (deferred until :8791 + filesystem healthy): complete via the atomic
  // POST /registry/candidates boundary, NOT a kill-prone in-process tsx run on a degraded FS.
  // Also re-register cap-8923fc36 (behavior-test-orchestration) and cap-5c137dbb
  // (workflow-test-execution): they landed partial (source_location=null, invisible to the
  // gate) from a killed mid-write and must resolve to roles/<role>/ when re-registered.
];
