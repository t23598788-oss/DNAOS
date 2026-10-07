/**
 * หน้าที่: proves Target Resolution is deterministic, registry-driven,
 * and honest — registry-internal classes always resolve; SOURCE_AUTHORITY
 * honestly reports TARGET_NOT_RESOLVED against this repo's REAL current
 * state (zero registered connections anywhere), and genuinely resolves
 * only when a real-shaped, connected ConnectionRegistration is supplied;
 * an invalid source_location is caught by the real, reused
 * checkRepoPath, never a new validator; Destination Mapping's own
 * MAPPING_NOT_FOUND/NOT_AVAILABLE pass through unchanged. Ends with the
 * real 5-artifact example carried all the way through Target Resolution.
 *
 * How to run: npx tsx control/target-resolution/tests/target-resolution.test.ts
 */

import { saveTask } from "../../agent-gateway/memory-store";
import { ingestWorkResult } from "../../work-result-ingress/contract";
import type { WorkResultInput } from "../../work-result-ingress/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { resolveTarget } from "../contract";
import type { ArtifactForTargetResolution } from "../contract";
import type { ConnectionRegistration } from "../../../contracts/connector/connection";
import type { Task, WorkOrder } from "../../agent-gateway/types";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

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

function artifact(overrides: Partial<ArtifactForTargetResolution> = {}): ArtifactForTargetResolution {
  return { resource_id: "resource-fixture", resource_type: "SOURCE_REFERENCE", capability_id: null, source_location: "src/fixture.ts", evidence_ref: "control/target-resolution/tests/target-resolution.test.ts", ...overrides };
}

check("a registry-internal class (CAPABILITY_GRAPH) always resolves once AVAILABLE — the target is the artifact's own real row", () => {
  const result = resolveTarget(artifact({ resource_id: "resource-cap-fixture", resource_type: "CAPABILITY", capability_id: "capability-cap-fixture" }));
  assert(result.target_status === "RESOLVED", `expected RESOLVED, got ${result.target_status}`);
  assert(result.target_kind === "REGISTRY_ROW", `expected REGISTRY_ROW, got ${result.target_kind}`);
  assert(result.target_ref === "software-registry://capability_graph/capability-cap-fixture", `expected the real capability_id in the target_ref, got ${result.target_ref}`);
});

check("SOURCE_AUTHORITY with the REAL current empty connection list honestly reports TARGET_NOT_RESOLVED — no fabricated repo/owner", () => {
  const result = resolveTarget(artifact(), { connections: [] });
  assert(result.destination_class === "SOURCE_AUTHORITY", `expected SOURCE_AUTHORITY, got ${result.destination_class}`);
  assert(result.target_status === "TARGET_NOT_RESOLVED", `expected TARGET_NOT_RESOLVED (this repo genuinely has zero registered connections), got ${result.target_status}`);
  assert(result.target_ref === null, "expected no target_ref when unresolved");
  assert(result.reason.includes("NOT_YET_BUILT"), `expected the real contracts/connector/connection.ts gap cited, got ${result.reason}`);
});

check("SOURCE_AUTHORITY genuinely resolves when a real-shaped, connected ConnectionRegistration is supplied — connection-driven, not hardcoded", () => {
  const fixtureConnection: ConnectionRegistration = { connection_id: "conn-fixture-github", account_id: "account-fixture", software_id: "dna-os-infrastructure", adapter: "github", credential_ref: { kind: "env_var", name: "GITHUB_PAT_FIXTURE" }, status: "connected" };
  const result = resolveTarget(artifact({ source_location: "src/real-path/fixture.ts" }), { connections: [fixtureConnection] });
  assert(result.target_status === "RESOLVED", `expected RESOLVED, got ${result.target_status}`);
  assert(result.target_kind === "GIT_SOURCE_LOCATION", `expected GIT_SOURCE_LOCATION, got ${result.target_kind}`);
  assert(result.target_ref === "github://conn-fixture-github/src/real-path/fixture.ts", `expected a target_ref built from the real connection_id + path, got ${result.target_ref}`);
});

check("a connection for a different adapter never matches — SOURCE_AUTHORITY still TARGET_NOT_RESOLVED", () => {
  const wrongAdapter: ConnectionRegistration = { connection_id: "conn-fixture-vercel", account_id: "account-fixture", software_id: "dna-os-infrastructure", adapter: "vercel", credential_ref: { kind: "not_yet_built" }, status: "connected" };
  const result = resolveTarget(artifact(), { connections: [wrongAdapter] });
  assert(result.target_status === "TARGET_NOT_RESOLVED", `expected TARGET_NOT_RESOLVED for a non-matching adapter, got ${result.target_status}`);
});

check("a disconnected connection for the right adapter never matches either", () => {
  const disconnected: ConnectionRegistration = { connection_id: "conn-fixture-github-2", account_id: "account-fixture", software_id: "dna-os-infrastructure", adapter: "github", credential_ref: { kind: "env_var", name: "GITHUB_PAT_FIXTURE" }, status: "disconnected" };
  const result = resolveTarget(artifact(), { connections: [disconnected] });
  assert(result.target_status === "TARGET_NOT_RESOLVED", `expected TARGET_NOT_RESOLVED for a disconnected connection, got ${result.target_status}`);
});

check("an invalid source_location (path traversal) is caught by the real, reused checkRepoPath — never a new validator", () => {
  const fixtureConnection: ConnectionRegistration = { connection_id: "conn-fixture-github-3", account_id: "account-fixture", software_id: "dna-os-infrastructure", adapter: "github", credential_ref: { kind: "env_var", name: "GITHUB_PAT_FIXTURE" }, status: "connected" };
  const result = resolveTarget(artifact({ source_location: "../../etc/passwd" }), { connections: [fixtureConnection] });
  assert(result.target_status === "TARGET_NOT_RESOLVED", `expected TARGET_NOT_RESOLVED for a path-traversal source_location, got ${result.target_status}`);
  assert(result.reason.includes("checkRepoPath"), `expected the reason to cite checkRepoPath, got ${result.reason}`);
});

check("Destination Mapping's own MAPPING_NOT_FOUND passes through unchanged", () => {
  const result = resolveTarget(artifact({ resource_type: "DEPENDENCY" }));
  assert(result.target_status === "DESTINATION_MAPPING_NOT_FOUND", `expected DESTINATION_MAPPING_NOT_FOUND, got ${result.target_status}`);
  assert(result.destination_class === null, "expected null destination_class");
});

check("Destination Mapping's own NOT_AVAILABLE (UI_SURFACE) passes through unchanged", () => {
  const result = resolveTarget(artifact({ resource_type: "UI_SURFACE" }));
  assert(result.target_status === "DESTINATION_NOT_AVAILABLE", `expected DESTINATION_NOT_AVAILABLE, got ${result.target_status}`);
  assert(result.destination_class === "UI_REGISTRY", `expected UI_REGISTRY, got ${result.destination_class}`);
});

// The real 5-artifact example, carried all the way through Target Resolution.
check("REAL 5-artifact test: the exact Work Result Ingress example resolves a real target_status for all 5", () => {
  const store = createLocalFileStore();
  const taskId = `task-target-resolution-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workOrder: WorkOrder = {
    operation: "MODIFY", target_type: "FILE", target_path: "test-fixtures/target-resolution/target.ts",
    requested_change: "test fixture", content: "// test fixture\n", workspace_scope: "test-fixtures/target-resolution/",
    mode: "sandbox", required_tests: ["sandbox.write"], forbidden_files: [], evidence: [{ source: "target-resolution.test.ts", note: "test fixture" }],
  };
  const task: Task = {
    task_id: taskId,
    memory: { user_id: "test-owner", workspace_id: "test-workspace", conversation_id: `conv-${taskId}`, parent_task_id: null, task_id: taskId, created_at: new Date().toISOString() },
    intent_text: "target-resolution test fixture", submitted_by_client: "target-resolution.test.ts",
    status: "EXECUTING", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    work_order: workOrder, output_lane: "WORK_ITEM",
  };
  saveTask(task);

  const workResult: WorkResultInput = {
    task_id: taskId, agent_id: "codex", role: "test-fixture", input_reference: "work-order://test-fixture/target-resolution",
    files_read: [],
    files_changed: ["test-fixtures/target-resolution/a.ts", "test-fixtures/target-resolution/b.ts", "test-fixtures/target-resolution/c.ts"],
    tests_run: ["npx tsc --noEmit"],
    status: "VERIFIED",
    evidence_refs: ["control/target-resolution/tests/target-resolution.test.ts"],
    blockers: [], next_action: null,
    capabilities_introduced: [{ name: "test-fixture-target-resolution-capability", source_location: "test-fixtures/target-resolution/capability.ts", purpose: "prove target resolution against a real registered artifact" }],
  };
  const ingressResult = ingestWorkResult(workResult, { store });
  assert(ingressResult.blocker === null, `expected the work result to register cleanly, got ${ingressResult.blocker}`);
  assert(ingressResult.artifacts.length === 5, `expected 5 real registered artifacts, got ${ingressResult.artifacts.length}`);

  // Which exact real source_location string each artifact carries doesn't
  // change this test's assertions (all 3 SOURCE_REFERENCE artifacts land
  // on TARGET_NOT_RESOLVED regardless, since no connection is supplied) —
  // any real, valid repo-relative path from the same work result proves the point.
  const targets = ingressResult.artifacts.map((art) =>
    resolveTarget({ resource_id: art.resource_id!, resource_type: art.resource_type, capability_id: art.capability_id, source_location: workResult.files_changed[0] ?? "test-fixtures/target-resolution/capability.ts", evidence_ref: "control/work-result-ingress/ (real registration)" }),
  );

  assert(targets.every((t) => t.target_status !== undefined), "expected a real target_status for every artifact");
  const sourceRefs = targets.filter((t) => t.resource_type === "SOURCE_REFERENCE");
  const testResults = targets.filter((t) => t.resource_type === "TEST_RESULT");
  const capabilities = targets.filter((t) => t.resource_type === "CAPABILITY");
  assert(sourceRefs.length === 3 && sourceRefs.every((t) => t.destination_class === "SOURCE_AUTHORITY" && t.target_status === "TARGET_NOT_RESOLVED"), "expected all 3 SOURCE_REFERENCE targets to honestly report TARGET_NOT_RESOLVED (no registered GitHub connection exists)");
  assert(testResults.length === 1 && testResults[0]!.target_status === "RESOLVED" && testResults[0]!.target_kind === "REGISTRY_ROW", "expected the TEST_RESULT target to resolve to a real registry row");
  assert(capabilities.length === 1 && capabilities[0]!.target_status === "RESOLVED" && capabilities[0]!.target_kind === "REGISTRY_ROW", "expected the CAPABILITY target to resolve to a real registry row");
  console.log(`  resolved: ${targets.map((t) => `${t.resource_type}->${t.destination_class}:${t.target_status}`).join(", ")}`);
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
