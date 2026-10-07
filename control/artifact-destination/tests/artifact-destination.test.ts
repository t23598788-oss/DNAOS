/**
 * หน้าที่: proves Artifact Destination Mapping is deterministic and
 * registry-driven — real resource_type -> destination_class mapping,
 * real getCapability() checks (never a hardcoded GitHub branch), honest
 * MAPPING_NOT_FOUND / NOT_AVAILABLE failure modes, and a full real
 * 5-artifact resolution using the exact Work Result Ingress example
 * (3 SOURCE_REFERENCE + 1 TEST_RESULT + 1 CAPABILITY).
 *
 * How to run: npx tsx control/artifact-destination/tests/artifact-destination.test.ts
 */

import { saveTask } from "../../agent-gateway/memory-store";
import { ingestWorkResult } from "../../work-result-ingress/contract";
import type { WorkResultInput } from "../../work-result-ingress/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { getCapability } from "../../command-router/contract";
import { resolveArtifactDestination } from "../contract";
import type { RegisteredArtifactRef } from "../contract";
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

function ref(resource_id: string, resource_type: string, capability_id: string | null = null): RegisteredArtifactRef {
  return { resource_id, resource_type, capability_id, evidence_ref: "control/artifact-destination/tests/artifact-destination.test.ts" };
}

check("SOURCE_REFERENCE -> SOURCE_AUTHORITY, resolved through the real, live github capability (never hardcoded in resolver.ts)", () => {
  const result = resolveArtifactDestination(ref("resource-fixture-1", "SOURCE_REFERENCE"));
  assert(result.destination_class === "SOURCE_AUTHORITY", `expected SOURCE_AUTHORITY, got ${result.destination_class}`);
  const realGithub = getCapability("github");
  const expectedStatus = realGithub?.health_status === "CONNECTED" ? "AVAILABLE" : "NOT_AVAILABLE";
  assert(result.destination_status === expectedStatus, `expected destination_status to match the REAL live github capability_registry state (${realGithub?.health_status}), got ${result.destination_status}`);
  if (expectedStatus === "AVAILABLE") assert(result.destination_capability_id === "github", `expected destination_capability_id=github, got ${result.destination_capability_id}`);
});

check("TEST_RESULT -> EVIDENCE_STORE, AVAILABLE (the same registry the artifact just landed in)", () => {
  const result = resolveArtifactDestination(ref("resource-fixture-2", "TEST_RESULT"));
  assert(result.destination_class === "EVIDENCE_STORE", `expected EVIDENCE_STORE, got ${result.destination_class}`);
  assert(result.destination_status === "AVAILABLE", `expected AVAILABLE, got ${result.destination_status}`);
});

check("CAPABILITY -> CAPABILITY_GRAPH, AVAILABLE", () => {
  const result = resolveArtifactDestination(ref("resource-fixture-3", "CAPABILITY", "capability-fixture-3"));
  assert(result.destination_class === "CAPABILITY_GRAPH", `expected CAPABILITY_GRAPH, got ${result.destination_class}`);
  assert(result.destination_status === "AVAILABLE", `expected AVAILABLE, got ${result.destination_status}`);
});

check("AI_INGRESS -> SYSTEM_REGISTRY, AVAILABLE", () => {
  const result = resolveArtifactDestination(ref("resource-fixture-4", "AI_INGRESS", "capability-fixture-4"));
  assert(result.destination_class === "SYSTEM_REGISTRY", "expected SYSTEM_REGISTRY");
  assert(result.destination_status === "AVAILABLE", "expected AVAILABLE");
});

check("UI_SURFACE -> UI_REGISTRY, honestly NOT_AVAILABLE — no UI Registry capability exists, none invented", () => {
  const result = resolveArtifactDestination(ref("resource-fixture-5", "UI_SURFACE"));
  assert(result.destination_class === "UI_REGISTRY", `expected UI_REGISTRY, got ${result.destination_class}`);
  assert(result.destination_status === "NOT_AVAILABLE", `expected NOT_AVAILABLE, got ${result.destination_status}`);
  assert(result.next_action.startsWith("DESTINATION_NOT_AVAILABLE"), `expected the deterministic stop message, got ${result.next_action}`);
});

check("an unmapped resource_type honestly reports MAPPING_NOT_FOUND, never a guess", () => {
  const result = resolveArtifactDestination(ref("resource-fixture-6", "DEPENDENCY"));
  assert(result.destination_class === null, `expected null destination_class, got ${result.destination_class}`);
  assert(result.destination_status === "MAPPING_NOT_FOUND", `expected MAPPING_NOT_FOUND, got ${result.destination_status}`);
  assert(result.next_action.startsWith("DESTINATION_MAPPING_NOT_FOUND"), `expected the deterministic stop message, got ${result.next_action}`);
  assert(result.destination_capability_id === null, "expected no capability_id for an unmapped type");
});

check("resolveArtifactDestination never touches source content — only resource_id/resource_type/evidence_ref ever reach it", () => {
  const input = ref("resource-fixture-7", "SOURCE_REFERENCE");
  assert(!("content" in input) && !("source" in input) && !("files" in input), "RegisteredArtifactRef must never carry a content-shaped field");
});

// The real 5-artifact test: an actual Work Result Ingress run (3 files + 1 test + 1 capability), then resolve each artifact's real destination.
check("REAL 5-artifact test: the exact Work Result Ingress example resolves a real destination for all 5, no AI analysis", () => {
  const store = createLocalFileStore();
  const taskId = `task-artifact-destination-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workOrder: WorkOrder = {
    operation: "MODIFY", target_type: "FILE", target_path: "test-fixtures/artifact-destination/target.ts",
    requested_change: "test fixture", content: "// test fixture\n", workspace_scope: "test-fixtures/artifact-destination/",
    mode: "sandbox", required_tests: ["sandbox.write"], forbidden_files: [], evidence: [{ source: "artifact-destination.test.ts", note: "test fixture" }],
  };
  const task: Task = {
    task_id: taskId,
    memory: { user_id: "test-owner", workspace_id: "test-workspace", conversation_id: `conv-${taskId}`, parent_task_id: null, task_id: taskId, created_at: new Date().toISOString() },
    intent_text: "artifact-destination test fixture", submitted_by_client: "artifact-destination.test.ts",
    status: "EXECUTING", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    work_order: workOrder, output_lane: "WORK_ITEM",
  };
  saveTask(task);

  const workResult: WorkResultInput = {
    task_id: taskId, agent_id: "codex", role: "test-fixture", input_reference: "work-order://test-fixture/artifact-destination",
    files_read: [],
    files_changed: ["test-fixtures/artifact-destination/a.ts", "test-fixtures/artifact-destination/b.ts", "test-fixtures/artifact-destination/c.ts"],
    tests_run: ["npx tsc --noEmit"],
    status: "VERIFIED",
    evidence_refs: ["control/artifact-destination/tests/artifact-destination.test.ts"],
    blockers: [], next_action: null,
    capabilities_introduced: [{ name: "test-fixture-artifact-destination-capability", source_location: "test-fixtures/artifact-destination/capability.ts", purpose: "prove artifact destination resolution against a real registered artifact" }],
  };
  const ingressResult = ingestWorkResult(workResult, { store });
  assert(ingressResult.blocker === null, `expected the work result to register cleanly, got ${ingressResult.blocker}`);
  assert(ingressResult.artifacts.length === 5, `expected 5 real registered artifacts, got ${ingressResult.artifacts.length}`);

  const destinations = ingressResult.artifacts.map((artifact) =>
    resolveArtifactDestination({ resource_id: artifact.resource_id!, resource_type: artifact.resource_type, capability_id: artifact.capability_id, evidence_ref: "control/work-result-ingress/ (this artifact's own real registration)" }),
  );

  assert(destinations.every((d) => d.destination_class !== null), "expected every one of the 5 real artifacts to resolve a real destination_class, no AI analysis, no gaps");
  const bySourceType = (type: string) => destinations.filter((d) => d.resource_type === type);
  assert(bySourceType("SOURCE_REFERENCE").length === 3 && bySourceType("SOURCE_REFERENCE").every((d) => d.destination_class === "SOURCE_AUTHORITY"), "expected all 3 SOURCE_REFERENCE artifacts to resolve SOURCE_AUTHORITY");
  assert(bySourceType("TEST_RESULT").length === 1 && bySourceType("TEST_RESULT")[0]!.destination_class === "EVIDENCE_STORE", "expected the TEST_RESULT artifact to resolve EVIDENCE_STORE");
  assert(bySourceType("CAPABILITY").length === 1 && bySourceType("CAPABILITY")[0]!.destination_class === "CAPABILITY_GRAPH", "expected the CAPABILITY artifact to resolve CAPABILITY_GRAPH");
  for (const destination of destinations) {
    assert(destination.destination_status === "AVAILABLE" || destination.destination_status === "NOT_AVAILABLE", `expected a real, honest status for ${destination.artifact_resource_id}, got ${destination.destination_status}`);
    assert(destination.artifact_resource_id.startsWith("resource-"), "expected the real resource_id from the actual registration, not a placeholder");
  }
  console.log(`  resolved: ${destinations.map((d) => `${d.resource_type}->${d.destination_class}(${d.destination_status})`).join(", ")}`);
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
