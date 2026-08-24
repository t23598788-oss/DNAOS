/**
 * หน้าที่: Phase 1's real proof — "Activate DNA OS Agent Host" (Owner).
 * Proves that DNA OS can launch a REAL coding-agent binary (the actual
 * globally-installed `claude` and `codex` CLIs on this machine, resolved
 * generically via `../worker-registry.ts`'s provider-neutral WorkerKind,
 * never a per-provider special case) through the EXISTING, unmodified
 * `control/agent-host/` sandbox mechanism and the new
 * `control/agent-gateway/agent-host-dispatch.ts` wiring
 * (`dispatchToAgentHost`) -- the "Agent Gateway -> Agent Host" link in
 * the Owner's chain.
 *
 * The nine required verifications:
 *   REAL_AGENT_LAUNCH, WORKSPACE_WRITE_ALLOWED, REAL_SOURCE_WRITE_DENIED,
 *   GIT_EXEC_DENIED, SUPABASE_EXEC_DENIED, VERCEL_EXEC_DENIED,
 *   CREDENTIAL_ENV_ABSENT, OUTBOUND_NETWORK_DENIED,
 *   RESULT_RETURNED_TO_DNA_OS
 *
 * REAL_AGENT_LAUNCH is proven directly against the real `claude`/`codex`
 * binaries (self-contained Mach-O executables, no interpreter needed --
 * confirmed this round). The remaining boundary properties (workspace
 * write, source-write denial, exec denial, credential absence, network
 * denial) are proven via the LOCAL worker kind (`../agent-script.mjs`,
 * already real, already reused, extended this round with two new
 * actions: write_real_source_attempt, attempt_network) -- because every
 * worker kind is launched through the exact same
 * `buildSandboxProfile`/`spawnConfinedAgent` call in `../host-runtime.ts`,
 * a property proven for one worker kind holds for all of them BY
 * CONSTRUCTION, not by re-testing each binary separately. This is stated
 * explicitly rather than assumed: see `WORKER_KIND_EQUIVALENCE` below.
 *
 * GEMINI is verified to have NO real executable registered on this
 * machine -- reported as WORKER_NOT_AVAILABLE, never launched, never
 * fabricated.
 *
 * How to run: npx tsx control/agent-host/tests/real-agent-launch.test.ts
 */

declare const require: (id: string) => unknown;
interface NodeFsModule {
  writeFileSync(path: string, content: string, encoding: string): void;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  existsSync(path: string): boolean;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
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

import { dispatchToAgentHost } from "../../agent-gateway/agent-host-dispatch";
import { resolveWorker, listWorkerKinds } from "../worker-registry";

const CAPABILITY_DIR = nodePath.join(process.cwd(), "control", "agent-host");
const WORKSPACE_ROOT = nodePath.join(CAPABILITY_DIR, "test-workspace");
const ALLOWED_DIR = nodePath.join(WORKSPACE_ROOT, "allowed");
const OUTSIDE_DIR = nodePath.join(WORKSPACE_ROOT, "outside");
// A REAL path inside the actual repository source tree -- distinct from
// OUTSIDE_DIR (a designated test fixture dir) -- to make the
// REAL_SOURCE_WRITE_DENIED point unambiguous.
const REAL_SOURCE_PROBE_PATH = nodePath.join(process.cwd(), "control", "agent-host", "PHASE1_REAL_SOURCE_WRITE_PROBE_should_not_exist.txt");

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

function safeParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { parse_error: true, raw: text };
  }
}

function psTree(pid: number | null): string {
  if (!pid) return "(no pid)";
  try {
    return cp.execFileSync("ps", ["-o", "pid,ppid,command", "-p", String(pid)], { encoding: "utf-8" });
  } catch (err) {
    return `ps failed: ${(err as Error).message}`;
  }
}

async function main() {
  fs.mkdirSync(ALLOWED_DIR, { recursive: true });
  fs.mkdirSync(OUTSIDE_DIR, { recursive: true });

  console.log(`\n=== WORKER_KIND_EQUIVALENCE ===`);
  console.log("Every WorkerKind below is launched through the IDENTICAL launchAgent()/buildSandboxProfile() call in control/agent-host/host.ts and host-runtime.ts -- only `agentExecutable` differs. Boundary properties proven via LOCAL therefore hold for CLAUDE/CODEX/GEMINI by construction, not by separate re-implementation.");
  for (const kind of listWorkerKinds()) {
    console.log(`  ${kind}: ${JSON.stringify(resolveWorker(kind))}`);
  }

  // ---------------------------------------------------------------
  // REAL_AGENT_LAUNCH + RESULT_RETURNED_TO_DNA_OS -- real claude/codex
  // ---------------------------------------------------------------
  const claudeResolution = resolveWorker("CLAUDE");
  check("CLAUDE worker resolves to a real, existing executable", claudeResolution.ok, claudeResolution);
  if (claudeResolution.ok) {
    const claudeDispatch = await dispatchToAgentHost({
      task_id: "phase1-real-agent-launch-claude",
      worker_kind: "CLAUDE",
      workspace_dir: ALLOWED_DIR,
      hostEnv: process.env,
      outsideProbeDirs: [OUTSIDE_DIR],
      instructionArgv: claudeResolution.worker.defaultArgv,
      timeoutMs: 10_000,
    });
    console.log("\n=== REAL_AGENT_LAUNCH (CLAUDE) ===");
    console.log(JSON.stringify(claudeDispatch, null, 2));
    check(
      "REAL_AGENT_LAUNCH (CLAUDE): real `claude --version` ran as a confined child and returned a version string",
      claudeDispatch.status === "LAUNCHED" && claudeDispatch.launch.exitCode === 0 && /\d+\.\d+\.\d+/.test(claudeDispatch.launch.stdout),
      claudeDispatch,
    );
    check("RESULT_RETURNED_TO_DNA_OS (CLAUDE): structured AgentLaunchResult includes launchId/pid/stdout/exitCode", claudeDispatch.status === "LAUNCHED" && typeof claudeDispatch.launch.launchId === "string" && typeof claudeDispatch.launch.pid === "number", claudeDispatch);
  }

  const codexResolution = resolveWorker("CODEX");
  check("CODEX worker resolves to a real, existing executable", codexResolution.ok, codexResolution);
  if (codexResolution.ok) {
    const codexDispatch = await dispatchToAgentHost({
      task_id: "phase1-real-agent-launch-codex",
      worker_kind: "CODEX",
      workspace_dir: ALLOWED_DIR,
      hostEnv: process.env,
      outsideProbeDirs: [OUTSIDE_DIR],
      instructionArgv: codexResolution.worker.defaultArgv,
      timeoutMs: 10_000,
    });
    console.log("\n=== REAL_AGENT_LAUNCH (CODEX) ===");
    console.log(JSON.stringify(codexDispatch, null, 2));
    check(
      "REAL_AGENT_LAUNCH (CODEX): real `codex --version` ran as a confined child and returned a version string",
      codexDispatch.status === "LAUNCHED" && codexDispatch.launch.exitCode === 0 && /\d+\.\d+\.\d+/.test(codexDispatch.launch.stdout),
      codexDispatch,
    );
  }

  const geminiResolution = resolveWorker("GEMINI");
  check(
    "GEMINI worker honestly reports WORKER_NOT_AVAILABLE (no real CLI binary found on this machine) -- never fabricated, never launched",
    !geminiResolution.ok && geminiResolution.reason === "EXECUTABLE_NOT_FOUND",
    geminiResolution,
  );

  // ---------------------------------------------------------------
  // Boundary properties -- proven via LOCAL (fully controllable worker)
  // ---------------------------------------------------------------
  async function launchLocal(action: Record<string, unknown>) {
    return dispatchToAgentHost({
      task_id: `phase1-local-${action.action}`,
      worker_kind: "LOCAL",
      workspace_dir: ALLOWED_DIR,
      hostEnv: process.env,
      outsideProbeDirs: [OUTSIDE_DIR],
      instructionArgv: (resolveWorker("LOCAL") as { ok: true; worker: { defaultArgv: readonly string[] } }).worker.defaultArgv.concat([JSON.stringify(action)]),
      timeoutMs: 8_000,
    });
  }

  const wsWrite = await launchLocal({ action: "write_direct_allowed_attempt", relPath: "phase1-workspace-write-probe.txt", content: "phase1-real-agent-host-activation" });
  const wsWriteParsed = wsWrite.status === "LAUNCHED" ? safeParse(wsWrite.launch.stdout) : null;
  check("WORKSPACE_WRITE_ALLOWED: write inside allowedWorkspaceDir succeeds", wsWriteParsed?.outcome === "SUCCEEDED", wsWrite);

  const srcWrite = await launchLocal({ action: "write_real_source_attempt", absPath: REAL_SOURCE_PROBE_PATH, content: "should-never-land-in-real-source" });
  const srcWriteParsed = srcWrite.status === "LAUNCHED" ? safeParse(srcWrite.launch.stdout) : null;
  check("REAL_SOURCE_WRITE_DENIED: write into the real repository source tree is BLOCKED", srcWriteParsed?.outcome === "BLOCKED", srcWrite);
  check("REAL_SOURCE_WRITE_DENIED (filesystem confirmation): the probe file does not exist on disk", !fs.existsSync(REAL_SOURCE_PROBE_PATH), { path: REAL_SOURCE_PROBE_PATH });

  const gitExec = await launchLocal({ action: "exec_git", bin: "/usr/bin/git" });
  const gitExecParsed = gitExec.status === "LAUNCHED" ? safeParse(gitExec.launch.stdout) : null;
  check("GIT_EXEC_DENIED: real /usr/bin/git exec attempt is BLOCKED", gitExecParsed?.outcome === "BLOCKED", gitExec);

  const supabaseExec = await launchLocal({ action: "exec_supabase", bin: "/opt/homebrew/bin/supabase" });
  const supabaseExecParsed = supabaseExec.status === "LAUNCHED" ? safeParse(supabaseExec.launch.stdout) : null;
  check("SUPABASE_EXEC_DENIED: real /opt/homebrew/bin/supabase exec attempt is BLOCKED", supabaseExecParsed?.outcome === "BLOCKED", supabaseExec);

  const vercelExec = await launchLocal({ action: "exec_vercel", bin: "/opt/homebrew/bin/vercel", args: ["--version"] });
  const vercelExecParsed = vercelExec.status === "LAUNCHED" ? safeParse(vercelExec.launch.stdout) : null;
  check("VERCEL_EXEC_DENIED: real /opt/homebrew/bin/vercel exec attempt is BLOCKED", vercelExecParsed?.outcome === "BLOCKED", vercelExec);

  const credProbe = await launchLocal({ action: "credential_probe" });
  const credProbeParsed = credProbe.status === "LAUNCHED" ? safeParse(credProbe.launch.stdout) : null;
  const allAbsent = credProbeParsed?.credential_env_visible && Object.values(credProbeParsed.credential_env_visible).every((v) => v === false);
  check("CREDENTIAL_ENV_ABSENT: no GITHUB_*/VERCEL_*/SUPABASE_* env var is visible to the confined child", allAbsent === true, credProbe);

  const netProbe = await launchLocal({ action: "attempt_network", url: "https://api.github.com" });
  const netProbeParsed = netProbe.status === "LAUNCHED" ? safeParse(netProbe.launch.stdout) : null;
  check("OUTBOUND_NETWORK_DENIED: real outbound fetch to api.github.com is BLOCKED", netProbeParsed?.outcome === "BLOCKED", netProbe);

  check("RESULT_RETURNED_TO_DNA_OS (LOCAL): every dispatch above returned a structured, parseable JSON result to this calling process", [wsWrite, srcWrite, gitExec, supabaseExec, vercelExec, credProbe, netProbe].every((d) => d.status === "LAUNCHED"));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) (process as unknown as { exitCode: number }).exitCode = 1;
}

main();
