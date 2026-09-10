/**
 * Cursor/IDE admission: map Cursor hook events onto existing physical-scope
 * guards. Does not launch a second sandbox.
 */

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { AGENT_EXECUTION_ID_ENV, AGENT_TASK_ID_ENV } from "./types";
import type { CanonicalAgentScope, PhysicalScopeRegistry, ScopeDecision } from "./types";
import { resolveCanonicalTaskScope } from "./task-scope";
import { guardWritePath, pathInsideRoot } from "./path-guard";
import { looksLikePortEscape, looksLikeProcessEscape } from "./process-port";
import { mcpMutationRequiresTaskScope } from "./mcp-scope";
import { recordDeniedMutation } from "./audit";
import { readWorkspaceMetadata } from "./workspace-metadata";

export const NON_CANONICAL_UNTRUSTED_EXECUTION = "NON_CANONICAL_UNTRUSTED_EXECUTION" as const;
export type ExecutionCanonicality = "CANONICAL_AGENT_HOST" | typeof NON_CANONICAL_UNTRUSTED_EXECUTION;

export type CursorHookPermission = "allow" | "deny";

export interface CursorHookEvent {
  readonly event?: string;
  readonly command?: string;
  readonly tool_name?: string;
  readonly toolName?: string;
  readonly file_path?: string;
  readonly path?: string;
  readonly cwd?: string;
  readonly tool_input?: { readonly path?: string; readonly command?: string };
}

export interface CursorHookDecision {
  readonly permission: CursorHookPermission;
  readonly reason: string;
  readonly canonicality: ExecutionCanonicality;
  readonly host_unscoped_shell: boolean;
  readonly agent_message?: string;
}

function gitToplevel(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.length > 0 ? realpathSync(out) : null;
  } catch {
    return null;
  }
}

function gitHead(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", timeout: 3000 }).trim();
  } catch {
    return "UNRESOLVED";
  }
}

export function classifyExecutionCanonicality(env: Readonly<Record<string, string | undefined>> = process.env): ExecutionCanonicality {
  const execId = env[AGENT_EXECUTION_ID_ENV];
  if (typeof execId === "string" && execId.trim() !== "") return "CANONICAL_AGENT_HOST";
  return NON_CANONICAL_UNTRUSTED_EXECUTION;
}

export function agentProducedChangeEligibleForAutoPromotion(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { readonly ok: true } | { readonly ok: false; readonly reason: typeof NON_CANONICAL_UNTRUSTED_EXECUTION } {
  if (classifyExecutionCanonicality(env) !== "CANONICAL_AGENT_HOST") {
    return { ok: false, reason: NON_CANONICAL_UNTRUSTED_EXECUTION };
  }
  return { ok: true };
}

export function resolveCursorSessionScope(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  registry: PhysicalScopeRegistry,
): ScopeDecision {
  const taskFromEnv = env[AGENT_TASK_ID_ENV]?.trim();
  const execId = env[AGENT_EXECUTION_ID_ENV]?.trim() || `cursor-${Date.now()}`;
  if (taskFromEnv) {
    return resolveCanonicalTaskScope({ task_id: taskFromEnv, agent_execution_id: execId }, registry);
  }

  const root = gitToplevel(cwd);
  if (!root) {
    return { ok: false, reason: "TASK_SCOPE_UNRESOLVED", detail: "no git root and no DNA_OS_AGENT_TASK_ID" };
  }

  const meta = readWorkspaceMetadata(root);
  if (meta) {
    const byId = resolveCanonicalTaskScope({ task_id: meta.task_id, agent_execution_id: execId }, registry);
    if (byId.ok) return byId;
  }

  const byPath = registry.findReservationByWorktreePath?.(root) ?? null;
  if (byPath) {
    return resolveCanonicalTaskScope({ task_id: byPath.work_id, agent_execution_id: execId }, registry);
  }

  return resolveCanonicalTaskScope({
    task_id: `cursor-implicit:${root}`,
    agent_execution_id: execId,
  }, {
    findReservationByWorkId(task_id) {
      if (task_id === `cursor-implicit:${root}`) {
        return {
          reservation_id: `implicit:${root}`,
          work_id: task_id,
          repository_id: "repo://cwd",
          worktree_path: root,
          base_commit_sha: gitHead(root),
          purpose: "ENGINEERING_ISOLATION",
        };
      }
      return registry.findReservationByWorkId(task_id);
    },
    findReservationByWorktreePath: registry.findReservationByWorktreePath?.bind(registry),
    getRepository(repository_id) {
      if (repository_id === "repo://cwd") {
        return {
          repository_id,
          source_authority: "local://worktree",
          repository_root: root,
          status: "ACTIVE",
        };
      }
      return registry.getRepository(repository_id);
    },
    siblingWorktreePaths: (except) => registry.siblingWorktreePaths(except),
    protectedRuntimes: () => registry.protectedRuntimes(),
    now: () => registry.now(),
  });
}

function argvOf(command: string): readonly string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function looksLikeGitMutationCommand(command: string): boolean {
  const tokens = argvOf(command);
  const gitIdx = tokens.findIndex((t) => t === "git" || t.endsWith("/git"));
  if (gitIdx < 0) return false;
  const rest = tokens.slice(gitIdx + 1);
  if (rest[0] === "remote" && (rest[1] === "set-url" || rest[1] === "add")) return true;
  if (rest.includes("push")) {
    return rest.some((token) => token.includes("://") || token.startsWith("git@"));
  }
  return false;
}

export function looksLikeUnscopedHostShell(command: string): boolean {
  const argv = argvOf(command);
  if (looksLikeGitMutationCommand(command)) return true;
  if (looksLikeProcessEscape(argv) || looksLikePortEscape(argv)) return true;
  if (/\blaunchctl\b/.test(command) && /\b(bootout|kickstart|kill)\b/.test(command)) return true;
  return false;
}

function toolNameOf(event: CursorHookEvent): string {
  return event.tool_name || event.toolName || "";
}

function filePathOf(event: CursorHookEvent): string | null {
  return event.file_path || event.path || event.tool_input?.path || null;
}

function writeRequestRel(scope: CanonicalAgentScope, path: string): string {
  let root = scope.worktree_path;
  try {
    if (existsSync(scope.worktree_path)) root = realpathSync(scope.worktree_path);
  } catch {
    /* keep */
  }
  let candidate = path.startsWith("/") ? path : resolve(root, path);
  try {
    if (existsSync(candidate)) candidate = realpathSync(candidate);
  } catch {
    candidate = resolve(candidate);
  }
  if (pathInsideRoot(root, candidate) || pathInsideRoot(scope.worktree_path, candidate)) {
    const rel = relative(root, candidate);
    if (rel && !rel.startsWith("..") && !rel.startsWith("/")) return rel;
  }
  return path;
}

function deny(
  reason: string,
  extra: Partial<CursorHookDecision> = {},
): CursorHookDecision {
  return {
    permission: "deny",
    reason,
    canonicality: extra.canonicality ?? NON_CANONICAL_UNTRUSTED_EXECUTION,
    host_unscoped_shell: extra.host_unscoped_shell ?? true,
    agent_message: extra.agent_message ?? reason,
  };
}

export function evaluateCursorHook(
  event: CursorHookEvent,
  registry: PhysicalScopeRegistry,
  env: Readonly<Record<string, string | undefined>> = process.env,
): CursorHookDecision {
  const cwd = event.cwd && existsSync(event.cwd) ? event.cwd : process.cwd();
  const scope = resolveCursorSessionScope(cwd, env, registry);
  const name = toolNameOf(event);
  const command = event.command || event.tool_input?.command || "";
  const kind = (event.event || "").toLowerCase();
  const canonicality = classifyExecutionCanonicality(env);

  if (!scope.ok) {
    const mutating = Boolean(command) || Boolean(filePathOf(event)) || mcpMutationRequiresTaskScope(name);
    if (mutating) {
      recordDeniedMutation({
        task_id: env[AGENT_TASK_ID_ENV] ?? null,
        agent_execution_id: env[AGENT_EXECUTION_ID_ENV] ?? null,
        requested_action: event.event || name || "cursor_hook",
        resolved_repository: null,
        requested_resource: command || filePathOf(event) || name,
        denial_reason: "TASK_SCOPE_UNRESOLVED",
        timestamp: new Date().toISOString(),
      });
      return deny("TASK_SCOPE_UNRESOLVED", { host_unscoped_shell: true });
    }
    return {
      permission: "allow",
      reason: "TASK_SCOPE_UNRESOLVED",
      canonicality,
      host_unscoped_shell: false,
    };
  }

  if (command && looksLikeUnscopedHostShell(command)) {
    const reason = looksLikeGitMutationCommand(command)
      ? "GIT_SCOPE_DENIED"
      : looksLikeProcessEscape(argvOf(command))
        ? "RUNTIME_SCOPE_DENIED"
        : "PORT_SCOPE_DENIED";
    recordDeniedMutation({
      task_id: scope.scope.task_id,
      agent_execution_id: scope.scope.agent_execution_id,
      requested_action: "HOST_SHELL",
      resolved_repository: scope.scope.repository_id,
      requested_resource: command,
      denial_reason: reason === "GIT_SCOPE_DENIED" ? "GIT_SCOPE_DENIED" : reason === "RUNTIME_SCOPE_DENIED" ? "RUNTIME_SCOPE_DENIED" : "PORT_SCOPE_DENIED",
      timestamp: new Date().toISOString(),
    });
    return deny(reason, {
      host_unscoped_shell: true,
      agent_message: "Use DNA OS scoped tools / agent-host. Direct host shell is NON_CANONICAL_UNTRUSTED_EXECUTION.",
    });
  }

  const path = filePathOf(event);
  const writeLike = Boolean(path) && (
    kind.includes("write")
    || kind.includes("edit")
    || name === "Write"
    || name === "Delete"
    || name === "StrReplace"
  );
  if (path && writeLike) {
    const guarded = guardWritePath(scope.scope, writeRequestRel(scope.scope, path));
    if (!guarded.ok) {
      recordDeniedMutation({
        task_id: scope.scope.task_id,
        agent_execution_id: scope.scope.agent_execution_id,
        requested_action: "SOURCE_MUTATION",
        resolved_repository: scope.scope.repository_id,
        requested_resource: path,
        denial_reason: guarded.reason ?? "PATH_SCOPE_DENIED",
        timestamp: new Date().toISOString(),
      });
      return deny(guarded.reason ?? "PATH_SCOPE_DENIED", { host_unscoped_shell: false, canonicality });
    }
  }

  return {
    permission: "allow",
    reason: command ? NON_CANONICAL_UNTRUSTED_EXECUTION : "IN_SCOPE",
    canonicality,
    host_unscoped_shell: false,
    agent_message: command && canonicality === NON_CANONICAL_UNTRUSTED_EXECUTION
      ? "Allowed in assigned worktree only. This Cursor shell is NON_CANONICAL_UNTRUSTED_EXECUTION and is not eligible for automatic promotion."
      : undefined,
  };
}

export function cursorHookResponseJson(decision: CursorHookDecision): string {
  return JSON.stringify({
    permission: decision.permission,
    agent_message: decision.agent_message ?? decision.reason,
    user_message: decision.permission === "deny" ? decision.reason : undefined,
  });
}
