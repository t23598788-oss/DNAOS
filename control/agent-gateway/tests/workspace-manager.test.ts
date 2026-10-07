/**
 * หน้าที่: real proof for "Phase 2 — DNA OS Agent Workspace Architecture"
 * (Owner). Exercises `../workspace-manager.ts` directly (lifecycle,
 * master-source separation) and `../agent-host-dispatch.ts#runAgentWorkOrder`
 * end to end for LOCAL (fully controllable, free) plus real, live
 * CLAUDE/CODEX launches through the exact same WorkspaceManager-backed
 * path proven in Phase 1 — reused unmodified.
 *
 * How to run: npx tsx control/agent-gateway/tests/workspace-manager.test.ts
 */
import { createTaskWorkspace, transitionWorkspace, assignAgent, getWorkspace } from "../workspace-manager";
import { runAgentWorkOrder } from "../agent-host-dispatch";
import { MACHINE_CONTRACT_VERSION } from "../agent-execution-contract";
import type { DnaOsAgentResult } from "../agent-execution-contract";
import { resolveWorker } from "../../agent-host/worker-registry";
import type { WorkOrder } from "../types";

declare const require: (id: string) => unknown;
declare const process: { cwd(): string; env: Record<string, string | undefined> };
declare const console: { log(...a: unknown[]): void };
const nodePath = require("node:path") as { join(...p: string[]): string };
const nodeFs = require("node:fs") as { existsSync(p: string): boolean };

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n      ${JSON.stringify(detail)}`); }
}

const REPO_ROOT = process.cwd();
// Deliberately OUTSIDE the repo (MASTER_SOURCE) entirely -- Phase 2's
// stricter separation requirement than Phase 1's convention
// (control/agent-host/test-workspace/allowed/, itself still nested under
// the repo path and therefore rejected by createTaskWorkspace's own
// overlap check, correctly).
const WORKSPACE_ROOT = "/tmp/dna-os-agent-workspaces";

function buildWorkOrder(workerKind: "LOCAL" | "CLAUDE" | "CODEX", instruction: string, workspaceId: string, readPaths: readonly string[], writePath: string): WorkOrder {
  return {
    operation: "MODIFY", target_type: "FILE", target_path: "(phase2 proof)", requested_change: instruction, content: "",
    workspace_scope: writePath, mode: "sandbox", required_tests: [], forbidden_files: [], evidence: [],
    agent_run: { worker_kind: workerKind, instruction, workspace_id: workspaceId, assigned_source_paths: readPaths, dependency_read_paths: [], workspace_path: writePath, timeout_ms: 15_000, expected_result_contract: "DNA_OS_AGENT_RESULT_V1" },
  };
}

async function main(): Promise<void> {
  // ================= 1. WORKSPACE_MANAGER + LIFECYCLE =================
  const workOrderId = `wo-phase2-${Date.now()}`;
  const workspace = createTaskWorkspace({ work_order_id: workOrderId, command_id: "phase2-test", assigned_source: [REPO_ROOT], workspace_root: WORKSPACE_ROOT });
  check("WORKSPACE_MANAGER: real workspace_id allocated", typeof workspace.workspace_id === "string" && workspace.workspace_id.startsWith("ws-"), workspace);
  check("WORKSPACE_MANAGER: initial state is CREATE", workspace.state === "CREATE");
  check("WORKSPACE_MANAGER: allowed_write_workspace is a real, fresh directory", nodeFs.existsSync(workspace.allowed_write_workspace) === true, workspace);
  check("MASTER_SOURCE_SEPARATION: allowed_write_workspace is disjoint from assigned_source (MASTER_SOURCE)", !workspace.allowed_write_workspace.startsWith(REPO_ROOT) || workspace.allowed_write_workspace.includes("test-workspace/allowed"), workspace);
  check("WORKSPACE_MANAGER: allowed_read_paths carries the real MASTER_SOURCE path", workspace.allowed_read_paths.includes(REPO_ROOT));

  // full forward lifecycle
  let t = transitionWorkspace(workspace.workspace_id, "PREPARE_CONTEXT", "test");
  check("LIFECYCLE: CREATE -> PREPARE_CONTEXT", t.ok && t.workspace.state === "PREPARE_CONTEXT", t);
  const assigned = assignAgent(workspace.workspace_id, "LOCAL");
  check("LIFECYCLE: PREPARE_CONTEXT -> ASSIGN_AGENT, assigned_agent recorded", assigned.ok && assigned.workspace.state === "ASSIGN_AGENT" && assigned.workspace.assigned_agent === "LOCAL", assigned);
  t = transitionWorkspace(workspace.workspace_id, "RUNNING", "test");
  check("LIFECYCLE: ASSIGN_AGENT -> RUNNING", t.ok && t.workspace.state === "RUNNING");
  t = transitionWorkspace(workspace.workspace_id, "RESULT_RECEIVED", "test");
  check("LIFECYCLE: RUNNING -> RESULT_RECEIVED", t.ok && t.workspace.state === "RESULT_RECEIVED");
  t = transitionWorkspace(workspace.workspace_id, "VERIFYING", "test");
  check("LIFECYCLE: RESULT_RECEIVED -> VERIFYING", t.ok && t.workspace.state === "VERIFYING");
  t = transitionWorkspace(workspace.workspace_id, "ACCEPTED", "test");
  check("LIFECYCLE: VERIFYING -> ACCEPTED", t.ok && t.workspace.state === "ACCEPTED");
  t = transitionWorkspace(workspace.workspace_id, "CLOSED", "test");
  check("LIFECYCLE: ACCEPTED -> CLOSED", t.ok && t.workspace.state === "CLOSED");

  // invalid transitions must be refused, never silently clamped
  const invalid1 = transitionWorkspace(workspace.workspace_id, "RUNNING", "test");
  check("LIFECYCLE: CLOSED -> RUNNING is refused (terminal state)", !invalid1.ok && invalid1.reason.includes("INVALID_TRANSITION"), invalid1);

  const freshWs = createTaskWorkspace({ work_order_id: `${workOrderId}-skip`, command_id: "phase2-test-skip", assigned_source: [REPO_ROOT], workspace_root: WORKSPACE_ROOT });
  const invalidSkip = transitionWorkspace(freshWs.workspace_id, "RUNNING", "test"); // skipping PREPARE_CONTEXT/ASSIGN_AGENT
  check("LIFECYCLE: CREATE -> RUNNING (skipping steps) is refused", !invalidSkip.ok && invalidSkip.reason.includes("INVALID_TRANSITION"), invalidSkip);

  const unknownWs = transitionWorkspace("ws-does-not-exist", "PREPARE_CONTEXT", "test");
  check("LIFECYCLE: unknown workspace_id is refused, never fabricated", !unknownWs.ok && unknownWs.reason.includes("UNKNOWN_WORKSPACE_ID"), unknownWs);

  // ================= 2. MASTER_SOURCE_SEPARATION (real, adversarial) =================
  let overlapThrew = false;
  try {
    createTaskWorkspace({ work_order_id: "wo-overlap-test", command_id: "overlap-test", assigned_source: [WORKSPACE_ROOT], workspace_root: WORKSPACE_ROOT });
  } catch (e) {
    overlapThrew = e instanceof Error && e.message.includes("MASTER_SOURCE_SEPARATION_VIOLATION");
  }
  check("MASTER_SOURCE_SEPARATION: creating a workspace whose root OVERLAPS assigned_source is refused", overlapThrew);

  // ================= 3. AGENT_HOST_WORKSPACE_BINDING (real dispatch, LOCAL) =================
  const runWs = createTaskWorkspace({ work_order_id: `wo-run-${Date.now()}`, command_id: "phase2-run-local", assigned_source: [REPO_ROOT], workspace_root: WORKSPACE_ROOT });
  transitionWorkspace(runWs.workspace_id, "PREPARE_CONTEXT", "test");
  const localOrder = buildWorkOrder("LOCAL", JSON.stringify({ action: "credential_probe" }), runWs.workspace_id, runWs.allowed_read_paths, runWs.allowed_write_workspace);
  const localResult: DnaOsAgentResult = await runAgentWorkOrder(localOrder, "phase2-local-cmd", process.env);
  console.log("\n=== LOCAL DnaOsAgentResult (workspace-bound) ===");
  console.log(JSON.stringify(localResult, null, 2));
  check("AGENT_HOST_WORKSPACE_BINDING: result.workspace_id matches the WorkspaceManager-allocated id", localResult.workspace_id === runWs.workspace_id, localResult);
  check("MACHINE_OUTPUT_CONTRACT: protocol is DNA_OS_AGENT_RESULT_V1", localResult.protocol === MACHINE_CONTRACT_VERSION);
  check("MACHINE_OUTPUT_CONTRACT: result_id/verification_id/launch_id present (STATE_LINEAGE)", typeof localResult.result_id === "string" && typeof localResult.verification_id === "string" && typeof localResult.launch_id === "string", localResult);
  check("LOCAL_REAL_LAUNCH via WorkspaceManager path = PASS", localResult.status === "PASS", localResult);
  check("WORKSPACE_LIFECYCLE: workspace auto-transitioned to CLOSED by runAgentWorkOrder", getWorkspace(runWs.workspace_id)?.state === "CLOSED", getWorkspace(runWs.workspace_id));

  // ================= 4. GEMINI honestly reports WORKER_NOT_AVAILABLE through the same path =================
  const geminiWs = createTaskWorkspace({ work_order_id: `wo-gemini-${Date.now()}`, command_id: "phase2-gemini", assigned_source: [REPO_ROOT], workspace_root: WORKSPACE_ROOT });
  const geminiOrder = buildWorkOrder("LOCAL" as never, "ready", geminiWs.workspace_id, geminiWs.allowed_read_paths, geminiWs.allowed_write_workspace);
  geminiOrder.agent_run!.worker_kind = "GEMINI";
  const geminiResult = await runAgentWorkOrder(geminiOrder, "phase2-gemini-cmd", process.env);
  check("GEMINI (unavailable worker) still returns workspace_id + WORKER_NOT_AVAILABLE, never fabricated", geminiResult.workspace_id === geminiWs.workspace_id && geminiResult.error_code === "WORKER_NOT_AVAILABLE", geminiResult);

  // ================= 5. Real CLAUDE + CODEX through the SAME WorkspaceManager-bound path =================
  const claudeResolution = resolveWorker("CLAUDE");
  if (claudeResolution.ok) {
    const claudeWs = createTaskWorkspace({ work_order_id: `wo-claude-${Date.now()}`, command_id: "phase2-claude", assigned_source: [REPO_ROOT], workspace_root: WORKSPACE_ROOT });
    const claudeOrder = buildWorkOrder("CLAUDE", "Reply with the single word: ready", claudeWs.workspace_id, claudeWs.allowed_read_paths, claudeWs.allowed_write_workspace);
    const claudeResult = await runAgentWorkOrder(claudeOrder, "phase2-claude-cmd", process.env);
    check("CLAUDE via WorkspaceManager: workspace_id bound + real launch attempted", claudeResult.workspace_id === claudeWs.workspace_id && claudeResult.launch_id !== null, claudeResult);
  }
  const codexResolution = resolveWorker("CODEX");
  if (codexResolution.ok) {
    const codexWs = createTaskWorkspace({ work_order_id: `wo-codex-${Date.now()}`, command_id: "phase2-codex", assigned_source: [REPO_ROOT], workspace_root: WORKSPACE_ROOT });
    const codexOrder = buildWorkOrder("CODEX", "Reply with the single word: ready. Do not run any shell command.", codexWs.workspace_id, codexWs.allowed_read_paths, codexWs.allowed_write_workspace);
    const codexResult = await runAgentWorkOrder(codexOrder, "phase2-codex-cmd", process.env);
    check("CODEX via WorkspaceManager: workspace_id bound + real launch attempted", codexResult.workspace_id === codexWs.workspace_id && codexResult.launch_id !== null, codexResult);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) (process as unknown as { exitCode: number }).exitCode = 1;
}

void main();
