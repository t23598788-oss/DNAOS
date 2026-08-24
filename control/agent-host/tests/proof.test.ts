/**
 * หน้าที่: Phase 9's real, executed proof — drives `../contract.ts`'s
 * `launchAgent` directly by hand (same convention as
 * `../../../execution/run/tests/executor.test.ts`), and composes it with
 * the REAL, EXISTING `permissions/write-gate/` +
 * `software/capability-registrar/` + `execution/file-write/` for the one
 * authorized-write test — none of those three are reimplemented here,
 * only imported and called.
 *
 * How to run: npx tsx control/agent-host/tests/proof.test.ts
 *
 * Real child processes are spawned under real `sandbox-exec` confinement.
 * No network, no credential read.
 */

declare const require: (id: string) => unknown;
interface NodeFsModule {
  writeFileSync(path: string, content: string, encoding: string): void;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  readFileSync(path: string, encoding: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}
interface NodePathModule {
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
}
interface NodeCryptoModule {
  randomUUID(): string;
}
interface NodeChildProcessModule {
  execFileSync(cmd: string, args: readonly string[], opts: { encoding: "utf-8" }): string;
}
const fs = require("node:fs") as NodeFsModule;
const nodePath = require("node:path") as NodePathModule;
const nodeCrypto = require("node:crypto") as NodeCryptoModule;
const cp = require("node:child_process") as NodeChildProcessModule;
declare const process: { cwd(): string; env: Record<string, string | undefined>; pid: number; execPath: string; argv: string[] };
declare const console: { log(...a: unknown[]): void };

import { launchAgent } from "../contract";
import { evaluateWriteIntent } from "../../../permissions/write-gate/contract";
import type { WriteGateContext } from "../../../permissions/write-gate/contract";
import { getCapabilityIndex } from "../../../software/capability-registrar/contract";
import { executeFileWrite } from "../../../execution/file-write/contract";
import type { FileWriteRequest } from "../../../execution/file-write/contract";
import type { WriteIntent } from "../../../contracts/write-intent/write-intent";

const CAPABILITY_DIR = nodePath.join(process.cwd(), "control", "agent-host");
const WORKSPACE_ROOT = nodePath.join(CAPABILITY_DIR, "test-workspace");
const ALLOWED_DIR = nodePath.join(WORKSPACE_ROOT, "allowed");
const OUTSIDE_DIR = nodePath.join(WORKSPACE_ROOT, "outside");
const AGENT_SCRIPT = nodePath.join(CAPABILITY_DIR, "agent-script.mjs");

function log(section: string, value: unknown) {
  console.log(`\n=== ${section} ===`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function psTree(pid: number): string {
  try {
    return cp.execFileSync("ps", ["-o", "pid,ppid,command", "-p", String(pid)], { encoding: "utf-8" });
  } catch (err) {
    return `ps failed: ${(err as Error).message}`;
  }
}

async function main() {
  const results: Record<string, unknown> = {};

  // --- setup ---
  fs.mkdirSync(ALLOWED_DIR, { recursive: true });
  fs.mkdirSync(OUTSIDE_DIR, { recursive: true });
  fs.writeFileSync(nodePath.join(ALLOWED_DIR, "hello.txt"), "hello-from-allowed", "utf-8");
  fs.writeFileSync(nodePath.join(OUTSIDE_DIR, "secret.txt"), "secret-outside-content", "utf-8");

  const parentPidBefore = process.pid;
  log("PROCESS_TREE_BEFORE (this proof-runner process)", psTree(parentPidBefore));

  const gitBin = "/usr/bin/git";
  const ghBin = "/opt/homebrew/Cellar/gh/2.97.0/bin/gh";
  const vercelNode = "/opt/homebrew/bin/node";
  const vercelScript = "/opt/homebrew/Cellar/vercel/54.20.1/libexec/lib/node_modules/vercel/dist/vc.js";
  const supabaseBin = "/opt/homebrew/Cellar/supabase/2.107.0/bin/supabase";

  async function launch(action: Record<string, unknown>, timeoutMs = 5000) {
    return launchAgent(
      { allowedWorkspaceDir: ALLOWED_DIR, agentExecutable: process.execPath, agentArgv: [AGENT_SCRIPT, JSON.stringify(action)], timeoutMs },
      process.env,
      [OUTSIDE_DIR],
    );
  }

  // TEST 1 — read allowed
  const t1 = await launch({ action: "read_allowed", relPath: "hello.txt" });
  results.TEST1_read_allowed = { outcome: safeParse(t1.stdout)?.outcome, raw: safeParse(t1.stdout) };

  // capture a real process-tree snapshot mid-flight using a slow action
  const treeCapturePromise = launch({ action: "read_allowed", relPath: "hello.txt", sleep_ms: 0 });
  // Fire a short-lived tree probe concurrently against a deliberately slower child.
  const slowChild = launchAgent(
    { allowedWorkspaceDir: ALLOWED_DIR, agentExecutable: "/bin/sleep", agentArgv: ["1"], timeoutMs: 5000 },
    process.env,
    [OUTSIDE_DIR],
  );
  await new Promise((r) => setTimeout(r, 300));
  const midFlightPsAll = (() => {
    try {
      return cp.execFileSync("ps", ["-eo", "pid,ppid,command"], { encoding: "utf-8" })
        .split("\n")
        .filter((l) => l.includes("sandbox-exec") || l.includes("/bin/sleep 1"))
        .join("\n");
    } catch (err) {
      return `ps failed: ${(err as Error).message}`;
    }
  })();
  const slowResult = await slowChild;
  await treeCapturePromise;

  // TEST 2 setup — authorized write via the REAL Write Gate + REAL File Executor (existing, reused, not reimplemented)
  const agentWriteReq = await launch({ action: "request_authorized_write", target_path: "control/agent-host/test-workspace/allowed/authorized-output.txt", content: "written-through-write-gate-and-executor" });
  const writeReqParsed = safeParse(agentWriteReq.stdout);
  let writeGateDecision: unknown = null;
  let fileWriteResult: unknown = null;
  if (writeReqParsed?.outcome === "WRITE_REQUEST_EMITTED") {
    const intentId = nodeCrypto.randomUUID();
    const correlationId = nodeCrypto.randomUUID();
    const intent: WriteIntent = {
      intent_id: intentId,
      operation: "CREATE",
      capability: "control.agent-host.proof",
      target_type: "FILE",
      target_path: writeReqParsed.write_request.target_path,
      requested_change: "Phase 9 proof: authorized write requested by a sandboxed Agent, routed through the real Write Gate + File Executor.",
      requesting_agent: { identity_id: "phase9-proof-agent", kind: "ai_agent", display_name: "Phase 9 Proof Agent" },
      evidence: [{ source: "control/agent-host/tests/proof.test.ts", note: "Phase 9 Agent Host proof round" }],
      correlation_id: correlationId,
      submitted_at: new Date().toISOString(),
    };
    const context: WriteGateContext = { registryIndex: getCapabilityIndex() };
    const decision = evaluateWriteIntent(intent, context);
    writeGateDecision = decision;
    const fwRequest: FileWriteRequest = {
      write_id: "",
      correlation_id: correlationId,
      intent_id: intentId,
      gate_decision_id: decision.decision_id,
      requesting_identity_id: "phase9-proof-agent",
      operation: "CREATE",
      target_type: "FILE",
      target_path: writeReqParsed.write_request.target_path,
      content: writeReqParsed.write_request.content,
    } as unknown as FileWriteRequest;
    fileWriteResult = executeFileWrite(fwRequest, decision as never);
  }
  results.TEST2_authorized_write = { agent_request: writeReqParsed, write_gate_decision: writeGateDecision, file_write_result: fileWriteResult };

  // TEST 2b — Agent attempts to write the SAME file directly itself (must NOT be how the file got created)
  const t2b = await launch({ action: "write_direct_allowed_attempt", relPath: "agent-direct-write-probe.txt", content: "direct-write-by-agent-itself" });
  results.TEST2b_agent_direct_write_inside_allowed = safeParse(t2b.stdout);

  // TEST 3 — write directly to outside/ (must BLOCK)
  const t3 = await launch({ action: "write_direct_outside", absPath: nodePath.join(OUTSIDE_DIR, "hacked.txt") });
  results.TEST3_direct_outside_write = safeParse(t3.stdout);

  // TEST 4 — read outside/ (must BLOCK)
  const t4 = await launch({ action: "read_outside", absPath: nodePath.join(OUTSIDE_DIR, "secret.txt") });
  results.TEST4_direct_outside_read = safeParse(t4.stdout);

  // TEST 5 — exec git (must BLOCK)
  const t5 = await launch({ action: "exec_git", bin: gitBin });
  results.TEST5_exec_git = safeParse(t5.stdout);

  // TEST 6 — exec gh (must BLOCK)
  const t6 = await launch({ action: "exec_gh", bin: ghBin });
  results.TEST6_exec_gh = safeParse(t6.stdout);

  // TEST 7 — exec vercel (must BLOCK)
  const t7 = await launch({ action: "exec_vercel", bin: vercelNode, args: [vercelScript, "--version"] });
  results.TEST7_exec_vercel = safeParse(t7.stdout);

  // TEST 8 — exec supabase (must BLOCK)
  const t8 = await launch({ action: "exec_supabase", bin: supabaseBin });
  results.TEST8_exec_supabase = safeParse(t8.stdout);

  // Credential visibility
  const tCred = await launch({ action: "credential_probe" });
  results.CREDENTIAL_PROBE = safeParse(tCred.stdout);
  results.CREDENTIAL_PROBE_env_passed_to_child = t1.envPassed;

  // Process-tree proof
  results.PROCESS_TREE_DURING_TEST = midFlightPsAll;
  results.SLOW_CHILD_LAUNCH_RESULT = { pid: slowChild instanceof Promise ? undefined : undefined, exitCode: slowResult.exitCode, parentPid: slowResult.parentPid, pidLaunched: slowResult.pid };

  log("ALL RESULTS", results);
  console.log("\n=== DONE ===");
}

function safeParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { parse_error: true, raw: text };
  }
}

main();
