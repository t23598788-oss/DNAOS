/**
 * HERMETIC: AGENT_PHYSICAL_SCOPE_ENFORCEMENT_V1
 * How to run: npx tsx control/agent-physical-scope/tests/agent-physical-scope.test.ts
 */

import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_SCOPE_STORE_ENV, AGENT_EXECUTION_ID_ENV, type PhysicalScopeRegistry } from "../types";
import { resolveCanonicalTaskScope } from "../task-scope";
import { guardReadPath, guardWritePath } from "../path-guard";
import { applyScopedPatch } from "../apply-patch";
import {
  guardKillByPid,
  guardPortMutation,
  guardRuntimeMutation,
  OWNER_SURFACE_PORT,
  OWNER_SURFACE_RUNTIME_ID,
} from "../process-port";
import { allocateRuntimePort, withAllocatedPort } from "../port-allocator";
import {
  agentGitCredentialAuthority,
  guardAgentEnvironmentCredentials,
  guardGitPushProxy,
  guardGitWrite,
  looksLikeGitWriteEscape,
} from "../git-guard";
import { classifyMcpTool, mcpMutationAllowed } from "../mcp-scope";
import { denyProtectedRuntimeIfAgent } from "../live-registry";
import { writeWorkspaceMetadata, verifyHookContext } from "../workspace-metadata";
import { recordDeniedMutation } from "../audit";
import type { CanonicalAgentScope } from "../types";

declare const process: { env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

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

const STAMP = Date.now();
const isolated = mkdtempSync(join(tmpdir(), `dna-os-agent-scope-${STAMP}-`));
process.env[AGENT_SCOPE_STORE_ENV] = isolated;

function makeTrees(): { a: string; b: string; desktop: string } {
  const a = join(isolated, "repo-a");
  const b = join(isolated, "repo-b");
  const desktop = join(isolated, "Desktop", "DNA-OS-INFRASTRUCTURE");
  mkdirSync(join(a, "src"), { recursive: true });
  mkdirSync(join(b, "src"), { recursive: true });
  mkdirSync(desktop, { recursive: true });
  writeFileSync(join(a, "src", "ok.ts"), "export const A = 1;\n");
  writeFileSync(join(b, "src", "secret.ts"), "export const B = 1;\n");
  writeFileSync(join(desktop, "owner.ts"), "export const OWNER = 1;\n");
  return { a, b, desktop };
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
      if (task_id === "task-b") {
        return {
          reservation_id: "ws-b",
          work_id: "task-b",
          repository_id: "repo://b",
          worktree_path: b,
          base_commit_sha: "sha-b",
          purpose: "ENGINEERING_ISOLATION",
        };
      }
      if (task_id === "task-snap") {
        return {
          reservation_id: "ws-snap",
          work_id: "task-snap",
          repository_id: "repo://a",
          worktree_path: a,
          base_commit_sha: "sha-snap",
          purpose: "RECOVERY_CHECKOUT",
        };
      }
      return null;
    },
    findReservationByWorktreePath(worktree_path) {
      if (worktree_path === a) return this.findReservationByWorkId("task-a");
      if (worktree_path === b) return this.findReservationByWorkId("task-b");
      return null;
    },
    getRepository(repository_id) {
      if (repository_id === "repo://a") {
        return { repository_id, source_authority: "https://github.com/example/a.git", repository_root: a, status: "ACTIVE" };
      }
      if (repository_id === "repo://b") {
        return { repository_id, source_authority: "https://github.com/example/b.git", repository_root: b, status: "ACTIVE" };
      }
      return null;
    },
    siblingWorktreePaths(except) {
      return [a, b].filter((p) => p !== except);
    },
    protectedRuntimes: () => [
      { runtime_id: OWNER_SURFACE_RUNTIME_ID, port: OWNER_SURFACE_PORT, protection_class: "OWNER_SURFACE" },
    ],
    now: () => new Date(),
  };
}

function mustScope(task_id: string, exec: string, trees: { a: string; b: string }): CanonicalAgentScope {
  const decision = resolveCanonicalTaskScope(
    { task_id, agent_execution_id: exec, claimed_repository_id: task_id === "task-b" ? "repo://b" : "repo://a" },
    registryFor(trees.a, trees.b),
  );
  if (!decision.ok) throw new Error(`${decision.reason}: ${decision.detail}`);
  return decision.scope;
}

function main(): void {
  const trees = makeTrees();
  const scopeA = mustScope("task-a", "exec-a", trees);
  const scopeB = mustScope("task-b", "exec-b", trees);

  const unresolved = resolveCanonicalTaskScope({ task_id: "missing", agent_execution_id: "x" }, registryFor(trees.a, trees.b));
  ok("fail closed when task missing", !unresolved.ok && unresolved.reason === "TASK_SCOPE_UNRESOLVED");

  const spoofTask = resolveCanonicalTaskScope(
    { task_id: "task-a", agent_execution_id: "exec-a", claimed_repository_id: "repo://b" },
    registryFor(trees.a, trees.b),
  );
  ok("13. spoof repository_id denied", !spoofTask.ok && spoofTask.reason === "REPOSITORY_ID_SPOOFED");

  const writeB = applyScopedPatch(scopeA, { task_id: "task-a", relative_path: join("..", "repo-b", "src", "pwn.ts"), contents: "nope" });
  ok("1+3. ../ write Repo B denied", !writeB.ok);
  ok("Repo B untouched", readFileSync(join(trees.b, "src", "secret.ts"), "utf8").includes("B = 1"));

  const abs = applyScopedPatch(scopeA, { task_id: "task-a", relative_path: trees.b + "/x.ts", contents: "nope" });
  ok("5. absolute path denied", !abs.ok);

  const neighbor = guardWritePath(scopeA, join("..", "repo-b", "src", "secret.ts"));
  ok("2. neighboring worktree write denied", neighbor.ok === false);

  const link = join(trees.a, "escape-link");
  symlinkSync(trees.b, link);
  const viaLink = guardWritePath(scopeA, "escape-link/src/secret.ts");
  ok("4. symlink escape denied", viaLink.ok === false);

  const delOutside = guardWritePath(scopeA, join("..", "Desktop", "DNA-OS-INFRASTRUCTURE", "owner.ts"));
  ok("6. delete/write outside repo denied", delOutside.ok === false);

  ok("7. kill unrelated PID denied", guardKillByPid(scopeA, 1).reason === "RUNTIME_SCOPE_DENIED");
  ok("8. stop Owner runtime denied", guardRuntimeMutation(scopeA, OWNER_SURFACE_RUNTIME_ID).reason === "RUNTIME_SCOPE_DENIED");
  ok("9. bind Owner port denied", guardPortMutation(scopeA, OWNER_SURFACE_PORT).reason === "PORT_SCOPE_DENIED");

  const pushB = guardGitPushProxy(scopeA, {
    repository_id: "repo://b",
    remote_authority: "https://github.com/example/b.git",
    base_sha: "sha-a",
  });
  ok("10. push Repo B denied", pushB.reason === "GIT_SCOPE_DENIED");
  ok("11. git remote change treated as write escape", looksLikeGitWriteEscape(["git", "remote", "set-url", "origin", "https://evil.example/x.git"]));

  const snapDecision = resolveCanonicalTaskScope(
    { task_id: "task-snap", agent_execution_id: "exec-snap" },
    registryFor(trees.a, trees.b),
  );
  ok("12. snapshot not mutation target", snapDecision.ok && snapDecision.scope.write_allowed === false && snapDecision.scope.safe_for_current_execution === false);
  if (snapDecision.ok) {
    const snapWrite = applyScopedPatch(snapDecision.scope, { task_id: "task-snap", relative_path: "src/x.ts", contents: "no" });
    ok("12b. snapshot write denied", !snapWrite.ok);
  }

  const spoofPatch = applyScopedPatch(scopeA, { task_id: "task-b", relative_path: "src/ok.ts", contents: "no" });
  ok("13b. spoof task_id on patch denied", spoofPatch.reason === "TASK_ID_SPOOFED");

  const stale = applyScopedPatch(scopeA, { task_id: "task-a", relative_path: "src/ok.ts", contents: "x", expected_base_sha: "old" });
  ok("15. stale patch denied", stale.reason === "STALE_PATCH");

  ok("16. broad PAT env denied", guardAgentEnvironmentCredentials({ GITHUB_TOKEN: "gho_not_a_real_token" }).reason === "BROAD_GIT_CREDENTIAL");
  ok("16b. agent git authority is NONE", agentGitCredentialAuthority().expose_pat === false);

  const generated = applyScopedPatch(scopeA, { task_id: "task-a", relative_path: join("dist", "out.js"), contents: "ok" });
  ok("generated file inside scope allowed", generated.ok === true, generated.ok ? `class=${scopeA.safety_class} write=${scopeA.write_allowed}` : `${generated.reason} ${generated.detail} class=${scopeA.safety_class} write=${scopeA.write_allowed}`);

  const outsideGen = applyScopedPatch(scopeA, { task_id: "task-a", relative_path: join("..", "out.js"), contents: "no" });
  ok("generated file outside scope denied", outsideGen.ok === false);

  const nestedGit = guardWritePath(scopeA, join(".git", "config"));
  ok("nested git metadata write denied", nestedGit.ok === false);

  const positive = applyScopedPatch(scopeA, { task_id: "task-a", relative_path: "src/ok.ts", contents: "export const A = 2;\n" });
  ok("positive apply allowed patch", positive.ok === true, positive.ok ? "" : `${positive.reason} ${positive.detail}`);
  ok("positive file contents", readFileSync(join(trees.a, "src", "ok.ts"), "utf8").includes("A = 2"));

  const alloc = allocateRuntimePort(scopeA, "dev-server");
  ok("port allocated for task A", "port" in alloc);
  if ("port" in alloc) {
    const scoped = withAllocatedPort(scopeA, alloc.port);
    ok("A can use allocated port", guardPortMutation(scoped, alloc.port).ok === true);
    ok("B cannot use A's port", guardPortMutation(scopeB, alloc.port).ok === false);
    ok("A still cannot take Owner port", guardPortMutation(scoped, OWNER_SURFACE_PORT).ok === false);
  }

  ok("A cannot mutate B", applyScopedPatch(scopeA, { task_id: "task-a", relative_path: join("..", "repo-b", "hack.ts"), contents: "x" }).ok === false);
  ok("B cannot mutate A", applyScopedPatch(scopeB, { task_id: "task-b", relative_path: join("..", "repo-a", "hack.ts"), contents: "x" }).ok === false);
  ok("A cannot control B runtime", guardRuntimeMutation(scopeA, "task-b-runtime").reason === "RUNTIME_SCOPE_DENIED");
  ok("B cannot control A runtime", guardRuntimeMutation(scopeB, "task-a-runtime").reason === "RUNTIME_SCOPE_DENIED");

  ok("MCP read class is not mutation", classifyMcpTool("dna_os.get_current_work_context") === "SOURCE_READ" || classifyMcpTool("dna_os.get_current_work_context") === "SOURCE_DISCOVERY");
  ok("MCP mutation hidden without write scope", mcpMutationAllowed(snapDecision.ok ? snapDecision.scope : null, "dna_os.modify_source") === false);
  ok("MCP mutation allowed for assigned task", mcpMutationAllowed(scopeA, "dna_os.modify_source") === true);

  const agentStop = denyProtectedRuntimeIfAgent({
    service_id: OWNER_SURFACE_RUNTIME_ID,
    action: "stop",
    env: { [AGENT_EXECUTION_ID_ENV]: "exec-a" },
  });
  ok("agent stop Owner Surface denied before mutation", agentStop.ok === false);
  const ownerHealth = denyProtectedRuntimeIfAgent({ service_id: OWNER_SURFACE_RUNTIME_ID, action: "health", env: { [AGENT_EXECUTION_ID_ENV]: "exec-a" } });
  ok("agent may read health", ownerHealth.ok === true);
  const unscopedStop = denyProtectedRuntimeIfAgent({ service_id: OWNER_SURFACE_RUNTIME_ID, action: "stop", env: {} });
  ok("unscoped host process not auto-classified as agent", unscopedStop.ok === true);

  writeWorkspaceMetadata(scopeA);
  ok("hook metadata matches assignment", verifyHookContext(scopeA, trees.a, "https://github.com/example/a.git").ok === true);
  ok("hook remote mismatch denied", verifyHookContext(scopeA, trees.a, "https://github.com/example/b.git").ok === false);

  recordDeniedMutation({
    task_id: "task-a",
    agent_execution_id: "exec-a",
    requested_action: "SOURCE_MUTATION",
    resolved_repository: "repo://a",
    requested_resource: "probe",
    denial_reason: "PATH_SCOPE_DENIED",
    timestamp: new Date().toISOString(),
  });
  ok("audit file written", existsSync(join(isolated, "denials.jsonl")));
  const audit = readFileSync(join(isolated, "denials.jsonl"), "utf8");
  ok("audit has no secret-shaped tokens", !/gho_|github_pat_|ya29\./.test(audit));

  const gitCommitOk = guardGitWrite(scopeA, { repository_id: "repo://a", operation: "commit", base_sha: "sha-a" });
  ok("local commit path may proceed past repo match (push still closed)", gitCommitOk.ok === true);
  const gitPushClosed = guardGitWrite(scopeA, { repository_id: "repo://a", operation: "push" });
  ok("direct push closed", gitPushClosed.ok === false);

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
