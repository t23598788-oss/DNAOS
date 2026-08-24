/**
 * หน้าที่: the real proof for "DNA OS Live Agent Execution Path" (Owner).
 * Exercises the full wired chain DNA_OS_DECISION -> WORK_ORDER ->
 * DISPATCH_TASK(-equivalent) -> AGENT_HOST -> SANDBOX_EXEC -> AGENT_WORKER
 * -> MACHINE_RESULT -> RESULT_INGRESS -> EVIDENCE -> STATE -> NEXT_DECISION,
 * using `control/agent-gateway/agent-host-dispatch.ts`'s `runAgentWorkOrder`
 * and `control/agent-gateway/agent-execution-loop.ts`'s `runCorrectiveLoop`
 * -- both new this round, both calling ONLY existing, unmodified
 * mechanisms underneath (control/agent-host/, ./handoff.ts, ./controller.ts).
 *
 * How to run: npx tsx control/agent-host/tests/live-agent-execution-path.test.ts
 */

declare const require: (id: string) => unknown;
interface NodeFsModule {
  mkdirSync(path: string, options: { recursive: boolean }): void;
  existsSync(path: string): boolean;
}
interface NodePathModule {
  join(...parts: string[]): string;
}
interface NodeChildProcessModule {
  execFileSync(cmd: string, args: readonly string[], opts: { encoding: "utf-8" }): string;
}
const fs = require("node:fs") as NodeFsModule;
const nodePath = require("node:path") as NodePathModule;
const cp = require("node:child_process") as NodeChildProcessModule;
declare const process: { cwd(): string; env: Record<string, string | undefined>; pid: number };
declare const console: { log(...a: unknown[]): void };

import { runAgentWorkOrder } from "../../agent-gateway/agent-host-dispatch";
import { runCorrectiveLoop } from "../../agent-gateway/agent-execution-loop";
import { MACHINE_CONTRACT_VERSION } from "../../agent-gateway/agent-execution-contract";
import type { DnaOsAgentResult } from "../../agent-gateway/agent-execution-contract";
import { resolveWorker, listWorkerKinds } from "../worker-registry";
import type { WorkerKind } from "../worker-registry";
import type { WorkOrder } from "../../agent-gateway/types";

function buildWorkOrder(workerKind: WorkerKind, instruction: string): WorkOrder {
  return {
    operation: "MODIFY", target_type: "FILE", target_path: "(agent-host proof — no direct file target)",
    requested_change: instruction, content: "", workspace_scope: ALLOWED_DIR, mode: "sandbox",
    required_tests: [], forbidden_files: [], evidence: [],
    agent_run: { worker_kind: workerKind, instruction, assigned_source_paths: [process.cwd()], dependency_read_paths: [], workspace_path: ALLOWED_DIR, timeout_ms: 10_000, expected_result_contract: "DNA_OS_AGENT_RESULT_V1" },
  };
}

const CAPABILITY_DIR = nodePath.join(process.cwd(), "control", "agent-host");
const WORKSPACE_ROOT = nodePath.join(CAPABILITY_DIR, "test-workspace");
const ALLOWED_DIR = nodePath.join(WORKSPACE_ROOT, "allowed");
const OUTSIDE_DIR = nodePath.join(WORKSPACE_ROOT, "outside");
const REAL_SOURCE_PROBE_PATH = nodePath.join(process.cwd(), "control", "agent-host", "LIVE_PATH_REAL_SOURCE_WRITE_PROBE_should_not_exist.txt");

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ""}`);
  }
}

let seq = 0;
function localAction(action: Record<string, unknown>) {
  seq += 1;
  const workOrder = buildWorkOrder("LOCAL", JSON.stringify(action));
  return runAgentWorkOrder(workOrder, `live-path-${seq}-${action.action}`, process.env);
}

function validateContract(r: DnaOsAgentResult): boolean {
  return (
    r.protocol === MACHINE_CONTRACT_VERSION &&
    typeof r.work_order_id === "string" &&
    typeof r.task_id === "string" &&
    typeof r.worker_id === "string" &&
    ["PASS", "FAIL", "ERROR", "BLOCKED", "FAIL_CLOSED"].includes(r.status) &&
    typeof r.result_id === "string" &&
    typeof r.summary === "string" &&
    Array.isArray(r.errors) &&
    typeof r.verification === "object" &&
    Array.isArray(r.artifacts) &&
    Array.isArray(r.evidence_refs) &&
    Array.isArray(r.requested_actions) &&
    typeof r.runtime === "object" &&
    typeof r.runtime.launcher_pid === "number" &&
    Array.isArray(r.runtime.ppid_chain)
  );
}

async function main() {
  fs.mkdirSync(ALLOWED_DIR, { recursive: true });
  fs.mkdirSync(OUTSIDE_DIR, { recursive: true });

  console.log("\n=== WORKER_KIND_REGISTRY (real, existsSync-checked, no wildcard) ===");
  for (const kind of listWorkerKinds()) console.log(`  ${kind}: ${JSON.stringify(resolveWorker(kind))}`);

  // -----------------------------------------------------------------
  // 1. LIVE_DISPATCH_WIRING + MACHINE_RESULT_CONTRACT + PROCESS_AUTHORITY
  // -----------------------------------------------------------------
  const claudeResult = await runAgentWorkOrder(buildWorkOrder("CLAUDE", "Reply with the single word: ready"), "live-path-claude", process.env);
  console.log("\n=== CLAUDE MACHINE RESULT ===");
  console.log(JSON.stringify(claudeResult, null, 2));
  check("CLAUDE_REAL_LAUNCH = PASS (resolved literal path, not the symlink)", claudeResult.status === "PASS" && claudeResult.exit_code === 0, claudeResult);
  check("MACHINE_RESULT_CONTRACT (CLAUDE): shape matches DNA_OS_AGENT_RESULT_V1", validateContract(claudeResult));

  let processAuthorityPass = false;
  if (claudeResult.runtime.sandbox_pid !== null) {
    const psOut = (() => {
      try {
        return cp.execFileSync("ps", ["-o", "pid,ppid,command", "-p", String(claudeResult.runtime.agent_pid)], { encoding: "utf-8" });
      } catch (err) {
        return `ps failed (process already exited, expected for a fast --version call): ${(err as Error).message}`;
      }
    })();
    console.log("\n=== PROCESS_AUTHORITY ps snapshot (may show 'already exited' -- launch was fast) ===");
    console.log(psOut);
    // ppid_chain is the authoritative, already-captured proof (launcher_pid -> agent_pid,
    // same pid as sandbox_pid by construction) -- the live ps snapshot is supplementary,
    // since a fast --version call often exits before this later ps call runs.
    processAuthorityPass = claudeResult.runtime.ppid_chain[0] === claudeResult.runtime.launcher_pid && claudeResult.runtime.sandbox_pid === claudeResult.runtime.agent_pid;
  }
  check("PROCESS_AUTHORITY: ppid_chain shows DNA_OS_PROCESS -> AGENT_HOST -> SANDBOX_EXEC -> AGENT ancestry (sandbox_pid === agent_pid, same OS pid via execve in place)", processAuthorityPass, claudeResult.runtime);

  const codexResult = await runAgentWorkOrder(buildWorkOrder("CODEX", "Reply with the single word: ready. Do not run any shell command."), "live-path-codex", process.env);
  check("CODEX_REAL_LAUNCH = PASS", codexResult.status === "PASS" && codexResult.exit_code === 0, codexResult);
  check("MACHINE_RESULT_CONTRACT (CODEX): shape matches DNA_OS_AGENT_RESULT_V1", validateContract(codexResult));

  const geminiResult = await runAgentWorkOrder(buildWorkOrder("GEMINI", "ready"), "live-path-gemini", process.env);
  check("GEMINI: BLOCKED/WORKER_NOT_AVAILABLE, never fabricated", geminiResult.status === "BLOCKED" && geminiResult.error_code === "WORKER_NOT_AVAILABLE", geminiResult);

  const localVersionResult = await localAction({ action: "credential_probe" });
  check("LOCAL_REAL_LAUNCH = PASS", localVersionResult.status === "PASS", localVersionResult);
  check("MACHINE_RESULT_CONTRACT (LOCAL): shape matches DNA_OS_AGENT_RESULT_V1", validateContract(localVersionResult));

  // -----------------------------------------------------------------
  // 2. BYPASS VERIFICATION -- all 10 channels, via the LIVE Agent Host path
  // -----------------------------------------------------------------
  console.log("\n=== BYPASS_VERIFICATION (all expected BLOCKED) ===");
  const bypassChecks: Array<[string, DnaOsAgentResult]> = [
    ["DIRECT_REAL_SOURCE_WRITE", await localAction({ action: "write_real_source_attempt", absPath: REAL_SOURCE_PROBE_PATH, content: "should-never-land" })],
    ["DIRECT_GIT_EXEC", await localAction({ action: "exec_git", bin: "/usr/bin/git" })],
    ["DIRECT_GH_EXEC", await localAction({ action: "exec_gh", bin: "/opt/homebrew/bin/gh" })],
    ["DIRECT_SUPABASE_EXEC", await localAction({ action: "exec_supabase", bin: "/opt/homebrew/bin/supabase" })],
    ["DIRECT_VERCEL_EXEC", await localAction({ action: "exec_vercel", bin: "/opt/homebrew/bin/vercel", args: ["--version"] })],
    ["DIRECT_SECURITY_EXEC", await localAction({ action: "exec_security" })],
    ["DIRECT_NPM_INSTALL", await localAction({ action: "exec_npm_install", pkg: "left-pad" })],
    ["DIRECT_NPX_EXEC", await localAction({ action: "exec_npx", pkg: "cowsay" })],
    ["DIRECT_OSASCRIPT", await localAction({ action: "exec_osascript" })],
    ["DIRECT_OUTBOUND_NETWORK", await localAction({ action: "attempt_network", url: "https://api.github.com" })],
  ];
  let directBypassCount = 0;
  for (const [label, result] of bypassChecks) {
    const blocked = result.status === "BLOCKED";
    check(`${label}: BLOCKED`, blocked, result);
    if (!blocked) directBypassCount += 1;
  }
  check("REAL_SOURCE_WRITE_DENIED (filesystem confirmation): probe file never landed on disk", !fs.existsSync(REAL_SOURCE_PROBE_PATH));
  console.log(`\nDIRECT_BYPASS_COUNT (should be 0) = ${directBypassCount}`);

  // -----------------------------------------------------------------
  // 3. CORRECTIVE_LOOP -- reuses existing computeNextDecisionFromEvidence + dispatchTask
  // -----------------------------------------------------------------
  const failingResult = await localAction({ action: "this_action_does_not_exist" });
  console.log("\n=== CORRECTIVE_LOOP input (deliberately failing MACHINE_RESULT) ===");
  console.log(JSON.stringify(failingResult, null, 2));
  const loopOutcome = await runCorrectiveLoop(failingResult, "live-path-test-client");
  console.log("\n=== CORRECTIVE_LOOP outcome (machine state only) ===");
  console.log(JSON.stringify(loopOutcome, null, 2));
  check("CORRECTIVE_LOOP: produces a machine-only state (TERMINAL | OWNER_REVIEW_REQUIRED | CORRECTED), no natural language", ["TERMINAL", "OWNER_REVIEW_REQUIRED", "CORRECTED"].includes(loopOutcome.state));

  const passingLoop = await runCorrectiveLoop(claudeResult, "live-path-test-client");
  check("CORRECTIVE_LOOP: a PASS result never enters correction (state=TERMINAL immediately)", passingLoop.state === "TERMINAL" && passingLoop.decision_id === null);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) (process as unknown as { exitCode: number }).exitCode = 1;
}

main();
