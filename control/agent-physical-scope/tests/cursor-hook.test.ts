/**
 * Cursor hook / admission tests (policy layer). Kernel proofs live in
 * cursor-class-boundary.test.ts via launchAgent.
 * How to run: npx tsx control/agent-physical-scope/tests/cursor-hook.test.ts
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PhysicalScopeRegistry } from "../types";
import { AGENT_EXECUTION_ID_ENV, AGENT_TASK_ID_ENV } from "../types";
import {
  agentProducedChangeEligibleForAutoPromotion,
  classifyExecutionCanonicality,
  evaluateCursorHook,
  NON_CANONICAL_UNTRUSTED_EXECUTION,
} from "../cursor-admission";
import { classifyMcpTool, mcpMutationRequiresTaskScope } from "../mcp-scope";

declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const process: { cwd(): string; exitCode?: number };

let passed = 0;
let failed = 0;
function ok(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function registryFor(a: string, b: string): PhysicalScopeRegistry {
  return {
    findReservationByWorkId(task_id) {
      if (task_id === "task-a") {
        return {
          reservation_id: "ws-a",
          work_id: "task-a",
          repository_id: "repo://a",
          worktree_path: a,
          base_commit_sha: "sha-a",
          purpose: "ENGINEERING_ISOLATION",
        };
      }
      return null;
    },
    findReservationByWorktreePath(worktree_path) {
      if (worktree_path === a) {
        return {
          reservation_id: "ws-a",
          work_id: "task-a",
          repository_id: "repo://a",
          worktree_path: a,
          base_commit_sha: "sha-a",
          purpose: "ENGINEERING_ISOLATION",
        };
      }
      return null;
    },
    getRepository(repository_id) {
      if (repository_id === "repo://a") {
        return { repository_id, source_authority: "https://github.com/example/a.git", repository_root: a, status: "ACTIVE" };
      }
      return null;
    },
    siblingWorktreePaths() {
      return [b];
    },
    protectedRuntimes: () => [{ runtime_id: "control-workspace", port: 5181, protection_class: "OWNER_SURFACE" }],
    now: () => new Date(),
  };
}

function gitInit(dir: string): void {
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "add", "."]);
  execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "-c", "user.email=scope@test", "-c", "user.name=scope", "commit", "-qm", "init"]);
}

function main(): void {
  const root = mkdtempSync(join(tmpdir(), "dna-os-cursor-hook-"));
  const a = join(root, "repo-a");
  const b = join(root, "repo-b");
  mkdirSync(join(a, "src"), { recursive: true });
  mkdirSync(b, { recursive: true });
  writeFileSync(join(a, "src", "ok.ts"), "export const A = 1;\n");
  writeFileSync(join(b, "secret.ts"), "secret\n");
  gitInit(a);
  const registry = registryFor(a, b);
  const env = { [AGENT_TASK_ID_ENV]: "task-a", [AGENT_EXECUTION_ID_ENV]: "exec-a" };

  mkdirSync(join(root, "no-git"), { recursive: true });
  const unresolved = evaluateCursorHook(
    { event: "preToolUse", tool_name: "Write", path: "src/ok.ts", cwd: join(root, "no-git") },
    registry,
    {},
  );
  ok("mutation without git root or task is SCOPE_UNRESOLVED", unresolved.permission === "deny" && unresolved.reason === "TASK_SCOPE_UNRESOLVED");

  const assignedPush = evaluateCursorHook({ event: "beforeShellExecution", command: "git push origin HEAD", cwd: a }, registry, env);
  ok("assigned-remote name push is not treated as foreign URL push", assignedPush.permission === "allow");
  const push = evaluateCursorHook({ event: "beforeShellExecution", command: "git push https://github.com/example/foreign.git HEAD", cwd: a }, registry, env);
  ok("foreign git push denied", push.permission === "deny" && push.reason === "GIT_SCOPE_DENIED");

  const remote = evaluateCursorHook({ event: "beforeShellExecution", command: "git remote set-url origin https://evil.example/x.git", cwd: a }, registry, env);
  ok("git remote set-url denied", remote.permission === "deny" && remote.reason === "GIT_SCOPE_DENIED");

  const kill = evaluateCursorHook({ event: "beforeShellExecution", command: "kill 51812", cwd: a }, registry, env);
  ok("kill pid denied", kill.permission === "deny" && kill.reason === "RUNTIME_SCOPE_DENIED");

  const bind = evaluateCursorHook({ event: "beforeShellExecution", command: "python3 -m http.server 5181", cwd: a }, registry, env);
  ok("bind 5181 denied", bind.permission === "deny" && bind.reason === "PORT_SCOPE_DENIED");

  const http = evaluateCursorHook({ event: "beforeShellExecution", command: "curl http://127.0.0.1:8791/health", cwd: a }, registry, env);
  ok("inspect/bind 8791 denied", http.permission === "deny" && http.reason === "PORT_SCOPE_DENIED");

  const testCmd = evaluateCursorHook({ event: "beforeShellExecution", command: "npx tsx control/agent-physical-scope/tests/agent-physical-scope.test.ts", cwd: a }, registry, env);
  ok("in-scope test command allowed by hook", testCmd.permission === "allow");
  ok("in-scope Cursor shell still non-canonical without confusing allow with kernel jail", testCmd.canonicality === "CANONICAL_AGENT_HOST");

  const ideShell = evaluateCursorHook({ event: "beforeShellExecution", command: "npx tsx ./x.ts", cwd: a }, registry, {});
  ok("IDE shell without agent-host env is NON_CANONICAL", ideShell.canonicality === NON_CANONICAL_UNTRUSTED_EXECUTION && ideShell.permission === "allow");

  const outsideWrite = evaluateCursorHook({ event: "preToolUse", tool_name: "Write", path: join(b, "secret.ts"), cwd: a }, registry, env);
  ok("Write to sibling worktree denied", outsideWrite.permission === "deny");

  const insideWrite = evaluateCursorHook({ event: "preToolUse", tool_name: "Write", path: join(a, "src", "ok.ts"), cwd: a }, registry, env);
  ok("Write inside assigned worktree allowed", insideWrite.permission === "allow", `${insideWrite.reason} ${insideWrite.agent_message ?? ""}`);

  ok("apply_scoped_patch is mutation", classifyMcpTool("apply_scoped_patch") === "SOURCE_MUTATION" && mcpMutationRequiresTaskScope("apply_scoped_patch"));
  ok("publish_scoped_change is git write", classifyMcpTool("publish_scoped_change") === "GIT_WRITE");
  ok("restart_task_runtime is runtime mutation", classifyMcpTool("restart_task_runtime") === "RUNTIME_MUTATION");
  ok("run_scoped_test is not a write grant", classifyMcpTool("run_scoped_test") === "SOURCE_DISCOVERY" && mcpMutationRequiresTaskScope("run_scoped_test") === false);

  ok("auto-promotion requires agent-host execution id", agentProducedChangeEligibleForAutoPromotion({}).ok === false);
  ok("agent-host execution is promotion-eligible at canonicality gate", agentProducedChangeEligibleForAutoPromotion({ [AGENT_EXECUTION_ID_ENV]: "exec-a" }).ok === true);
  ok("classify host vs confined", classifyExecutionCanonicality({}) === NON_CANONICAL_UNTRUSTED_EXECUTION);

  const hookPath = join(process.cwd(), ".cursor", "hooks", "dna-os-physical-scope.sh");
  const runHook = (payload: object): { permission: string } => {
    const out = execFileSync("bash", [hookPath], { input: JSON.stringify(payload), encoding: "utf8" });
    return JSON.parse(out) as { permission: string };
  };
  ok("bash hook denies foreign git push", runHook({ command: "git push https://github.com/example/foreign.git HEAD" }).permission === "deny");
  ok("bash hook allows origin push name", runHook({ command: "git push origin HEAD" }).permission === "allow");
  ok("bash hook denies 5181 bind", runHook({ command: "python3 -m http.server 5181" }).permission === "deny");
  ok("bash hook denies /Users write path", runHook({ tool_name: "Write", path: "/Users/tam/Desktop/secret.ts" }).permission === "deny");
  ok("bash hook allows in-repo relative write", runHook({ tool_name: "Write", path: "control/agent-physical-scope/README.md" }).permission === "allow");

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
