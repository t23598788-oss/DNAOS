/**
 * หน้าที่: the single source of truth mapping a `command_id` to a real,
 * fixed executable + argv — ported from the old repo's real, proven
 * `app/api/admin/ide/_lib/executionRegistry.ts` (see
 * `../../reports/EXECUTION_MIGRATION_PLAN.md`). A caller NEVER sends a
 * shell string, an executable path, or free-form argv; only a
 * `command_id` + typed `requested_args`.
 *
 * PORTED, NOT REWRITTEN: the allowlist shape (`CommandDescriptor`), the
 * dynamic-argument validator, the working-directory resolution, the
 * environment allowlist, and the defense-in-depth denylist re-check below
 * are the exact same design as the old repo's — field names and structure
 * unchanged except where this repo's own conventions require a rename
 * (`CommandDefinition` → `CommandDescriptor`, `getCommandDefinition` →
 * `getCommandDescriptor`).
 *
 * REGISTERED COMMANDS: only four, all real, generic POSIX utilities that
 * exist on any host regardless of which repository this runs in —
 * `workspace.pwd` (`/bin/pwd`), `workspace.list` (`/bin/ls -la`),
 * `diagnostics.sleep` (`/bin/sleep 2`, real, harmless — exists ONLY so
 * `../tests/executor.test.ts` can deterministically exercise a real
 * timeout without depending on a slow real build), and
 * `diagnostics.missing_path` (`/bin/ls -la <a path guaranteed not to
 * exist>`, real, read-only, deterministically nonzero-exit — exists so
 * the same test suite can exercise real stderr capture + real nonzero
 * exit capture without depending on this checkout's own file layout).
 * The old repo's other nine commands (`typecheck`, `ide.test`, `build`,
 * `governance`, `architecture.check`, `lint`, and four more) are real
 * `npm run <script>` invocations tied to THAT repository's own
 * `package.json` — this repo has no `package.json` and no npm scripts of
 * its own yet, so porting those entries verbatim would fabricate commands
 * that do not exist here. NOT_PORTED, not invented — see
 * `../../reports/EXECUTION_CORE_PORT_REPORT.md` §SECURITY_PROPERTIES /
 * §OLD_NEW_DIFFERENCES.
 *
 * Input: none (module-level constant + pure functions).
 * Output: `COMMAND_REGISTRY`, `listCommandDescriptors`,
 * `getCommandDescriptor`, `validateDynamicArgs`, `resolveWorkingDirectory`,
 * `buildChildEnv`, `isCommandDenied`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts,
 * `../../control/conversation-read-model/contract.ts` (producer-side
 * projection publish only — see Owner UNLOCK 2026-09-06 physical
 * separation of the Owner Conversation Layer from this package).
 * สิ่งที่ห้ามแตะ: never add a command whose `fixedArgs` were not read from
 * a real, verified source (see each entry's `evidenceSource`). Never add
 * an `npm run <script>` entry until this repo has a real `package.json`
 * with that real script. Never widen `CHILD_ENV_ALLOWLIST` to include a
 * name matching `_KEY`/`_SECRET`/`_TOKEN`/`_PASSWORD`/`DATABASE_URL`.
 *
 * NOT_YET_BUILT: nothing calls any export here from outside this
 * capability folder or its own tests yet.
 */

import { currentWorkingDirectory, readEnvVar } from "./host-runtime";
import { type CommandDescriptor, ExecutionError } from "./types";
import { publishCommandIdentities } from "../../control/conversation-read-model/contract";

const SEC_10S = 10_000;

export const COMMAND_REGISTRY: Readonly<Record<string, CommandDescriptor>> = {
  "workspace.pwd": {
    command_id: "workspace.pwd",
    label: "Print Working Directory",
    description: "Shows the real workspace root directory the executor is bound to.",
    executable: "/bin/pwd",
    fixedArgs: [],
    dynamicArgumentSchema: {},
    dynamicArgOrder: [],
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: SEC_10S,
    maxOutputBytes: 65_536,
    allowConcurrent: true,
    exclusiveLockKey: null,
    requiredCapability: "execution.run",
    requiredAction: "run",
    mode: "READ_ONLY",
    changesWorkspace: false,
    requiresOwnerConfirmation: false,
    evidenceSource: "/bin/pwd is a real, standard read-only POSIX utility — prints cwd, touches nothing.",
  },
  "workspace.list": {
    command_id: "workspace.list",
    label: "List Workspace Root",
    description: "Lists the real top-level contents of the workspace root.",
    executable: "/bin/ls",
    fixedArgs: ["-la"],
    dynamicArgumentSchema: {},
    dynamicArgOrder: [],
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: SEC_10S,
    maxOutputBytes: 262_144,
    allowConcurrent: true,
    exclusiveLockKey: null,
    requiredCapability: "execution.run",
    requiredAction: "run",
    mode: "READ_ONLY",
    changesWorkspace: false,
    requiresOwnerConfirmation: false,
    evidenceSource: "/bin/ls -la is a real, standard read-only POSIX utility — lists a directory, touches nothing.",
  },
  "diagnostics.sleep": {
    command_id: "diagnostics.sleep",
    label: "Diagnostic Sleep (2s)",
    description: "Real `/bin/sleep 2` — used only to exercise real timeout handling in tests; harmless, no output, no workspace effect.",
    executable: "/bin/sleep",
    fixedArgs: ["2"],
    dynamicArgumentSchema: {},
    dynamicArgOrder: [],
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: 30_000,
    maxOutputBytes: 4_096,
    allowConcurrent: true,
    exclusiveLockKey: null,
    requiredCapability: "execution.run",
    requiredAction: "run",
    mode: "READ_ONLY",
    changesWorkspace: false,
    requiresOwnerConfirmation: false,
    evidenceSource: "/bin/sleep is a real, standard POSIX utility — sleeps for the given duration, touches nothing.",
  },
  // STEP "Build Post-Commit Build/Test Gate" (2026-08-21): this repo now
  // has a real package.json with real "typecheck"/"test:integration"
  // scripts — the exact condition this file's own header said would
  // justify adding npm-script entries ("Never add an npm run <script>
  // entry until this repo has a real package.json with that real
  // script"). Reused by control/post-commit-verification/, never a new
  // shell execution engine.
  "npm.typecheck": {
    command_id: "npm.typecheck",
    label: "TypeScript Typecheck",
    description: "Runs the repo's real `npm run typecheck` (tsc --noEmit) — read-only, emits no files.",
    executable: "npm",
    fixedArgs: ["run", "typecheck"],
    dynamicArgumentSchema: {},
    dynamicArgOrder: [],
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: 120_000,
    maxOutputBytes: 1_048_576,
    allowConcurrent: true,
    exclusiveLockKey: null,
    requiredCapability: "execution.run",
    requiredAction: "run",
    mode: "READ_ONLY",
    changesWorkspace: false,
    requiresOwnerConfirmation: false,
    evidenceSource: "package.json's own \"typecheck\": \"tsc --noEmit\" script — --noEmit means no output files are written.",
  },
  "npm.test_integration": {
    command_id: "npm.test_integration",
    label: "Integration Test Suite",
    description: "Runs the repo's real `npm run test:integration` (typecheck + the full control-plane/credential/connection-registry test suites).",
    executable: "npm",
    fixedArgs: ["run", "test:integration"],
    dynamicArgumentSchema: {},
    dynamicArgOrder: [],
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: 300_000,
    maxOutputBytes: 4_194_304,
    allowConcurrent: false,
    exclusiveLockKey: "npm.test_integration",
    requiredCapability: "execution.run",
    requiredAction: "run",
    mode: "WORKSPACE_WRITE",
    changesWorkspace: true,
    requiresOwnerConfirmation: false,
    evidenceSource: "package.json's own \"test:integration\" script — this suite writes real fixture rows into tracked data/*.jsonl stores (connection-registry, credentials/registry), so it is honestly WORKSPACE_WRITE, not READ_ONLY.",
  },
  "diagnostics.missing_path": {
    command_id: "diagnostics.missing_path",
    label: "Diagnostic Missing-Path Listing",
    description: "Real `/bin/ls -la` against a path that is guaranteed not to exist — used only to exercise real nonzero-exit + real stderr capture in tests.",
    executable: "/bin/ls",
    fixedArgs: ["-la", "/dnaos-execution-run-diagnostic-path-that-does-not-exist"],
    dynamicArgumentSchema: {},
    dynamicArgOrder: [],
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: SEC_10S,
    maxOutputBytes: 65_536,
    allowConcurrent: true,
    exclusiveLockKey: null,
    requiredCapability: "execution.run",
    requiredAction: "run",
    mode: "READ_ONLY",
    changesWorkspace: false,
    requiresOwnerConfirmation: false,
    evidenceSource: "/bin/ls -la against a nonexistent absolute path is a real, standard read-only POSIX invocation — deterministically exits nonzero with a real stderr message, touches nothing.",
  },
};

export function listCommandDescriptors(): readonly CommandDescriptor[] {
  return Object.values(COMMAND_REGISTRY);
}

/**
 * Narrow, read-only projection for callers that only need to know which
 * `command_id`s exist — never the executable/argv/timeout shape a full
 * `CommandDescriptor` carries. Added (Owner UNLOCK, 2026-09-06) so
 * `control/owner-command-semantics/` can check id existence without
 * importing the allowlist entries `spawn()` actually uses.
 */
export function listCommandIds(): readonly string[] {
  return Object.keys(COMMAND_REGISTRY);
}

// Producer-side snapshot, once, at module load — never re-run per query.
// `COMMAND_REGISTRY` is a module-level constant, so "load time" IS "the
// moment this registry's real content is known", which is the only trigger
// this package uses to publish into control/conversation-read-model/.
publishCommandIdentities(listCommandIds());

export function getCommandDescriptor(commandId: string): CommandDescriptor | undefined {
  return COMMAND_REGISTRY[commandId];
}

/** Every current command has an empty schema, so any key at all is rejected — intentionally strict, never permissive-by-default. */
export function validateDynamicArgs(descriptor: CommandDescriptor, args: Readonly<Record<string, string | number | boolean>>): void {
  const providedKeys = Object.keys(args);
  const schemaKeys = Object.keys(descriptor.dynamicArgumentSchema);

  for (const key of providedKeys) {
    if (!schemaKeys.includes(key)) {
      throw new ExecutionError("INVALID_ARGUMENT", `command "${descriptor.command_id}" does not accept argument "${key}"`);
    }
  }
  for (const key of schemaKeys) {
    const spec = descriptor.dynamicArgumentSchema[key];
    const value = args[key];
    if (value === undefined) {
      if (spec.required) throw new ExecutionError("INVALID_ARGUMENT", `missing required argument "${key}"`);
      continue;
    }
    if (spec.type === "string" && typeof value !== "string") throw new ExecutionError("INVALID_ARGUMENT", `argument "${key}" must be a string`);
    if (spec.type === "string" && typeof value === "string" && /[;&|<>`]|\$\(|\r|\n/.test(value)) {
      throw new ExecutionError("INVALID_ARGUMENT", `argument "${key}" contains a shell operator or newline character — not allowed`);
    }
    if (spec.type === "number" && typeof value !== "number") throw new ExecutionError("INVALID_ARGUMENT", `argument "${key}" must be a number`);
    if (spec.type === "boolean" && typeof value !== "boolean") throw new ExecutionError("INVALID_ARGUMENT", `argument "${key}" must be a boolean`);
    if (spec.type === "string" && spec.maxLength && typeof value === "string" && value.length > spec.maxLength) {
      throw new ExecutionError("INVALID_ARGUMENT", `argument "${key}" exceeds max length ${spec.maxLength}`);
    }
    if (spec.enum && typeof value === "string" && !spec.enum.includes(value)) {
      throw new ExecutionError("INVALID_ARGUMENT", `argument "${key}" must be one of: ${spec.enum.join(", ")}`);
    }
  }
}

/**
 * The old repo resolved this to its own `fsSecurity.WORKSPACE_ROOT` (a
 * constant anchored to that repository's checkout). This repo has no
 * `fsSecurity.ts` — porting one is out of scope for this round — so the
 * one real equivalent available without inventing a path is the actual
 * process working directory, which for every real caller (the future
 * `control/command-router/`, and this folder's own tests) is this
 * repository's own checkout root.
 */
export function resolveWorkingDirectory(descriptor: CommandDescriptor): string {
  switch (descriptor.workingDirectoryPolicy) {
    case "workspace_root":
      return currentWorkingDirectory();
    default:
      throw new ExecutionError("INTERNAL_ERROR", `unknown workingDirectoryPolicy: ${descriptor.workingDirectoryPolicy}`);
  }
}

/**
 * The one real `cwd_scope` label every currently-registered command
 * corresponds to — there is only one `workingDirectoryPolicy`
 * ("workspace_root") today, so there is only one real scope value.
 * `./policy-descriptor.ts` projects this into every
 * `CommandPolicyDescriptor.allowed_cwd_scope_prefixes` it builds, so a
 * caller's `ExecutionPermissionRequest.cwd_scope` /
 * `ExecutionRequest.cwd_scope` must equal (or be prefixed by) this exact
 * string to ever be granted. If a second `workingDirectoryPolicy` is ever
 * added, it needs its own real scope constant here — never a guessed one.
 */
export const WORKSPACE_ROOT_CWD_SCOPE = "workspace_root/";

/** Only these names, only if actually set on the host process, are ever passed to a child. The full process environment (which may contain Supabase/Anthropic/DB secrets) is NEVER passed through. */
export const CHILD_ENV_ALLOWLIST = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SHELL", "NODE_ENV"] as const;

export function buildChildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = readEnvVar(key);
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Defense-in-depth re-check of the FINAL resolved executable+argv,
 * independent of registry membership — the primary gate is that
 * `COMMAND_REGISTRY` is allowlist-only (a `command_id` not in it is
 * already `UNKNOWN_COMMAND` before this ever runs). `./executor.ts`
 * re-checks every resolved executable+argv against this right before
 * spawning, never trusting "it's in the registry" alone.
 */
const DENIED_EXECUTABLE_BASENAMES = new Set([
  "rm", "rmdir", "mv", "cp", "chmod", "chown", "sudo", "su",
  "curl", "wget", "ssh", "scp", "rsync",
  "brew", "apt", "apt-get", "yum", "docker", "kubectl", "vercel", "supabase",
  "kill", "pkill", "killall", "shutdown", "reboot", "launchctl", "open", "osascript",
]);
const DENIED_GIT_SUBCOMMANDS = new Set(["commit", "push", "pull", "checkout", "reset", "clean", "rebase", "merge", "branch", "tag", "stash"]);
const DENIED_PACKAGE_SUBCOMMANDS = new Set(["install", "i", "add", "remove", "uninstall", "update", "upgrade", "ci"]);
/** Literal shell metacharacters/operators — `spawn(shell:false)` already makes these inert as argv content, but the policy explicitly refuses to even ACCEPT one, since receiving it is itself a sign of an attempted shell-command construction. */
const SHELL_INJECTION_PATTERN = /[;&|<>`]|\$\(|\r|\n/;

export interface DenyCheckResult {
  denied: boolean;
  reason: string | null;
}

export function isCommandDenied(executable: string, argv: readonly string[]): DenyCheckResult {
  const basename = executable.split("/").pop() ?? executable;
  if (DENIED_EXECUTABLE_BASENAMES.has(basename)) {
    return { denied: true, reason: `executable "${basename}" is on the Command Policy denylist` };
  }
  if (basename === "git" && argv.length > 0 && DENIED_GIT_SUBCOMMANDS.has(argv[0])) {
    return { denied: true, reason: `git subcommand "${argv[0]}" is on the Command Policy denylist (mutates history/remote/working-tree)` };
  }
  if ((basename === "npm" || basename === "pnpm" || basename === "yarn") && argv.length > 0 && DENIED_PACKAGE_SUBCOMMANDS.has(argv[0])) {
    return { denied: true, reason: `package-manager subcommand "${argv[0]}" is on the Command Policy denylist (installs/modifies dependencies)` };
  }
  for (const arg of argv) {
    if (SHELL_INJECTION_PATTERN.test(arg)) {
      return { denied: true, reason: "argument contains a shell operator or newline character — rejected outright, never passed to spawn" };
    }
  }
  return { denied: false, reason: null };
}
