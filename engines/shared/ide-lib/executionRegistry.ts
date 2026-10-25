/**
 * Execution Command Registry for /admin/ide's Execution Runtime (owner,
 * 2026-08-05, Phase 4). The single server-side source of truth mapping a
 * client-supplied commandId to a real, fixed executable + argv — the client
 * NEVER sends a shell string, an executable path, or free-form argv. Every
 * command here was checked against this repository's real package.json
 * scripts / real binaries before being registered — none are guessed.
 *
 * - workspace.pwd / workspace.list — real /bin/pwd, /bin/ls (no npm script
 *   exists for these; they're plain, safe, real system binaries).
 * - git.status / git.diff — real `git` subcommands (read-only), the same
 *   convention engines/shared/ide-lib/gitReadOnly.ts already uses via
 *   execFile with a fixed argv, just exposed here as governed runtime
 *   commands instead of a direct server function call.
 * - typecheck — `npx tsc --noEmit`, the exact command behind package.json's
 *   "type-check" script.
 * - ide.test — `npm run ide:test`, package.json's real script (the Phase
 *   1-3 regression suite).
 * - build — `npm run build` → `next build`, package.json's real script.
 * - governance — `npm run guard` → `bash scripts/governance.sh`,
 *   package.json's real script.
 * - architecture.check — `npm run architecture:check` →
 *   `npx tsx scripts/check-system-control-graph.ts`, package.json's real
 *   script.
 *
 * No `npm install` / package-installation command is registered, and none
 * ever will be added to this file without that being a deliberate, explicit
 * change — installing packages is out of scope for command execution.
 */
import { WORKSPACE_ROOT } from "./fsSecurity";

export type ExecutionErrorCode =
  | "INVALID_COMMAND"
  | "INVALID_ARGUMENT"
  | "COMMAND_NOT_ALLOWED"
  | "WORKSPACE_NOT_AVAILABLE"
  | "RUN_NOT_FOUND"
  | "RUN_NOT_OWNED"
  | "CONCURRENCY_LIMIT"
  | "COMMAND_BUSY"
  | "OUTPUT_LIMIT_REACHED"
  | "COMMAND_TIMEOUT"
  | "COMMAND_CANCELLED"
  | "EXECUTION_FAILED"
  // ---- Real Terminal Execution (owner, 2026-08-06, Software Factory
  // Step 2) — new, distinct codes for cases the Phase 4 codes above don't
  // already cover. Existing codes are NOT renamed (regression tests and
  // callers already depend on them); the mapping to this task's spec
  // terminology is: COMMAND_NOT_REGISTERED≈INVALID_COMMAND,
  // ARGUMENT_NOT_ALLOWED≈INVALID_ARGUMENT, EXECUTION_LOCKED≈COMMAND_BUSY,
  // TIMEOUT≈COMMAND_TIMEOUT, CANCELLED≈COMMAND_CANCELLED,
  // OUTPUT_LIMIT_EXCEEDED≈OUTPUT_LIMIT_REACHED — documented here so the
  // mapping is traceable, not silently different names for the same thing. ----
  | "COMMAND_DENIED"
  | "OWNER_CONFIRMATION_REQUIRED"
  | "WORKSPACE_POLICY_VIOLATION"
  | "PROCESS_START_FAILED"
  | "INTERNAL_ERROR";

export class ExecutionError extends Error {
  code: ExecutionErrorCode;
  constructor(code: ExecutionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ExecutionError";
  }
}

export type CommandCategory = "workspace" | "git" | "quality" | "test" | "build" | "governance";

/** Minimal per-field validator — every current command has an empty schema
 * (no dynamic arguments accepted at all), but the shape exists so a future
 * command can add one WITHOUT ever accepting a raw string. */
export interface DynamicArgSpec {
  type: "string" | "number" | "boolean";
  required?: boolean;
  enum?: string[];
  maxLength?: number;
}

export interface CommandDefinition {
  id: string;
  label: string;
  description: string;
  category: CommandCategory;
  /** Real executable — bare name (resolved via PATH, same as every other
   * real invocation in this repo's own scripts) or an absolute path. NEVER
   * derived from client input. */
  executable: string;
  /** Fixed argv appended after any validated dynamic args. NEVER built by
   * string concatenation — always a literal array. */
  fixedArgs: string[];
  dynamicArgumentSchema: Record<string, DynamicArgSpec>;
  /** Order in which validated dynamic arg VALUES (never raw client text)
   * are appended, as separate literal argv elements, after fixedArgs.
   * Empty for every real command registered today (none accept dynamic
   * args yet) — exists so a future command can accept one safely, always
   * as a discrete argv element, never string-concatenated into a command
   * line. */
  dynamicArgOrder?: string[];
  workingDirectoryPolicy: "workspace_root";
  timeoutMs: number;
  maxOutputBytes: number;
  allowConcurrent: boolean;
  /** When set, only one run holding this key may be active at once —
   * concurrent attempts are rejected with COMMAND_BUSY (never queued
   * silently). Used for commands that write shared registry/build
   * artifacts (build, governance, architecture.check). */
  exclusiveLockKey: string | null;
  eventCategory: CommandCategory;
  /** Command Policy (owner, 2026-08-06, Real Terminal Execution) —
   * READ_ONLY: reads data, never changes workspace state.
   * WORKSPACE_WRITE: may create/modify cache, test output, or generated
   * registry files inside the workspace, but never edits source directly.
   * A command whose write behavior isn't verified from real evidence is
   * never marked READ_ONLY — see each command's evidenceSource below. */
  mode: "READ_ONLY" | "WORKSPACE_WRITE";
  /** Real, verified: does this command actually write anything inside the
   * workspace? Drives the before/after git-status fingerprint check —
   * mode="READ_ONLY" with changesWorkspace=true would be a contradiction
   * this registry never declares (checked by a regression test). */
  changesWorkspace: boolean;
  /** WORKSPACE_WRITE commands require the client to explicitly pass
   * ownerConfirmation:true — never assumed, never defaulted to allowed. */
  requiresOwnerConfirmation: boolean;
  /** Where the "this command does/doesn't write" claim was verified —
   * a real file, script, or doc reference, never "assumed". */
  evidenceSource: string;
  status: "active";
}

const SEC_10S = 10_000, SEC_20S = 20_000;
const MIN_4 = 4 * 60_000, MIN_5 = 5 * 60_000, MIN_10 = 10 * 60_000;

export const COMMAND_REGISTRY: Record<string, CommandDefinition> = {
  "workspace.pwd": {
    id: "workspace.pwd",
    label: "Print Working Directory",
    description: "Shows the real workspace root directory the runtime is bound to.",
    category: "workspace",
    executable: "/bin/pwd",
    fixedArgs: [],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: SEC_10S,
    maxOutputBytes: 65_536,
    allowConcurrent: true,
    exclusiveLockKey: null,
    eventCategory: "workspace",
    mode: "READ_ONLY", changesWorkspace: false, requiresOwnerConfirmation: false,
    evidenceSource: "/bin/pwd is a real, standard read-only POSIX utility — prints cwd, touches nothing.",
    status: "active",
  },
  "workspace.list": {
    id: "workspace.list",
    label: "List Workspace Root",
    description: "Lists the real top-level contents of the workspace root.",
    category: "workspace",
    executable: "/bin/ls",
    fixedArgs: ["-la"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: SEC_10S,
    maxOutputBytes: 262_144,
    allowConcurrent: true,
    exclusiveLockKey: null,
    eventCategory: "workspace",
    mode: "READ_ONLY", changesWorkspace: false, requiresOwnerConfirmation: false,
    evidenceSource: "/bin/ls -la is a real, standard read-only POSIX utility — lists a directory, touches nothing.",
    status: "active",
  },
  "git.status": {
    id: "git.status",
    label: "Git Status",
    description: "Real `git status --porcelain=v2 --branch` against the workspace repository.",
    category: "git",
    executable: "git",
    fixedArgs: ["status", "--porcelain=v2", "--branch"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: SEC_20S,
    maxOutputBytes: 1_048_576,
    allowConcurrent: true,
    exclusiveLockKey: null,
    eventCategory: "git",
    mode: "READ_ONLY", changesWorkspace: false, requiresOwnerConfirmation: false,
    evidenceSource: "git-scm.com/docs/git-status — `git status` is documented as read-only; the same real command engines/shared/ide-lib/gitReadOnly.ts already uses.",
    status: "active",
  },
  "git.diff": {
    id: "git.diff",
    label: "Git Diff",
    description: "Real `git diff` (unstaged working-tree changes) against the workspace repository.",
    category: "git",
    executable: "git",
    fixedArgs: ["diff"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: SEC_20S,
    maxOutputBytes: 2_097_152,
    allowConcurrent: true,
    exclusiveLockKey: null,
    eventCategory: "git",
    mode: "READ_ONLY", changesWorkspace: false, requiresOwnerConfirmation: false,
    evidenceSource: "git-scm.com/docs/git-diff — `git diff` (no args) is documented read-only; same command gitReadOnly.ts already uses.",
    status: "active",
  },
  "typecheck": {
    id: "typecheck",
    label: "TypeScript Type Check",
    description: "Real `npx tsc --noEmit` — the same command behind package.json's \"type-check\" script.",
    category: "quality",
    executable: "npx",
    fixedArgs: ["tsc", "--noEmit"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: MIN_4,
    maxOutputBytes: 5_242_880,
    allowConcurrent: false,
    exclusiveLockKey: null,
    eventCategory: "quality",
    mode: "READ_ONLY", changesWorkspace: false, requiresOwnerConfirmation: false,
    evidenceSource: "package.json's real \"type-check\" script is `tsc --noEmit` — --noEmit is documented (typescriptlang.org) to write no output files at all.",
    status: "active",
  },
  "ide.test": {
    id: "ide.test",
    label: "IDE Regression Suite",
    description: "Real `npm run ide:test` — the Phase 1-3 IDE core regression suite.",
    category: "test",
    executable: "npm",
    fixedArgs: ["run", "ide:test"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: MIN_5,
    maxOutputBytes: 5_242_880,
    allowConcurrent: false,
    exclusiveLockKey: null,
    eventCategory: "test",
    // WORKSPACE_WRITE, not READ_ONLY: scripts/ide-regression-test.ts creates
    // and deletes real fixture files under scripts/_ide_regression_fixtures/
    // during the run (self-cleaned, but real writes happen) — verified by
    // reading the script's own setupFixtures()/teardownFixtures(), not
    // assumed from the name "test".
    mode: "WORKSPACE_WRITE", changesWorkspace: true, requiresOwnerConfirmation: true,
    evidenceSource: "scripts/ide-regression-test.ts's setupFixtures()/teardownFixtures() — real fs.writeFile/fs.rm calls under scripts/_ide_regression_fixtures/.",
    status: "active",
  },
  "factory.test": {
    id: "factory.test",
    label: "Factory Registry Regression Suite",
    description: "Real `npm run factory:test` — verifies registry/factory-*.json (re-runs the real generator first).",
    category: "test",
    executable: "npm",
    fixedArgs: ["run", "factory:test"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: MIN_4,
    maxOutputBytes: 5_242_880,
    allowConcurrent: false,
    exclusiveLockKey: "registry-write",
    eventCategory: "test",
    // WORKSPACE_WRITE: scripts/factory-registry-test.ts's own main()
    // re-runs scripts/build-factory-registry.ts first, which writes
    // registry/factory-registry.json / factory-mapping.json /
    // factory-summary.json for real — verified by reading both scripts,
    // not assumed from the name "test".
    mode: "WORKSPACE_WRITE", changesWorkspace: true, requiresOwnerConfirmation: true,
    evidenceSource: "scripts/factory-registry-test.ts's main() calls execFileAsync(...\"build-factory-registry.ts\") before asserting anything; that script writeFileSync's registry/factory-*.json.",
    status: "active",
  },
  "build": {
    id: "build",
    label: "Production Build",
    description: "Real `npm run build` → `next build`.",
    category: "build",
    executable: "npm",
    fixedArgs: ["run", "build"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: MIN_10,
    maxOutputBytes: 5_242_880,
    allowConcurrent: false,
    exclusiveLockKey: "build-artifacts",
    eventCategory: "build",
    mode: "WORKSPACE_WRITE", changesWorkspace: true, requiresOwnerConfirmation: true,
    evidenceSource: "next build writes .next/ (documented at nextjs.org/docs/app/api-reference/cli/next#next-build-options) — a real workspace write, never source files.",
    status: "active",
  },
  "governance": {
    id: "governance",
    label: "Governance Check",
    description: "Real `npm run guard` → `bash scripts/governance.sh` — writes DNA_OS_HEALTH.json.",
    category: "governance",
    executable: "npm",
    fixedArgs: ["run", "guard"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: MIN_10,
    maxOutputBytes: 5_242_880,
    allowConcurrent: false,
    exclusiveLockKey: "registry-write",
    eventCategory: "governance",
    mode: "WORKSPACE_WRITE", changesWorkspace: true, requiresOwnerConfirmation: true,
    evidenceSource: "scripts/governance.sh writes DNA_OS_HEALTH.json every run (verified: `writeFileSync`-equivalent JSON write at the script's end) — a real generated-registry write.",
    status: "active",
  },
  "architecture.check": {
    id: "architecture.check",
    label: "Architecture Drift Check",
    description: "Real `npm run architecture:check` → `npx tsx scripts/check-system-control-graph.ts` — writes registry/system-control-graph.json.",
    category: "governance",
    executable: "npm",
    fixedArgs: ["run", "architecture:check"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: MIN_10,
    maxOutputBytes: 5_242_880,
    allowConcurrent: false,
    exclusiveLockKey: "registry-write",
    eventCategory: "governance",
    mode: "WORKSPACE_WRITE", changesWorkspace: true, requiresOwnerConfirmation: true,
    evidenceSource: "scripts/check-system-control-graph.ts calls scripts/build-system-control-graph.ts, which writeFileSync's registry/system-control-graph.json — a real generated-registry write.",
    status: "active",
  },
  // ---- Software Factory Step 8 (Test Pipeline) additions — real npm
  // scripts this repo already has, exposed as governed runtime commands
  // the same way Steps 2-7's commands above already are. No new
  // executable/binary is introduced; every one of these already exists as
  // a real package.json script verified in this repo before being added
  // here. ----
  "lint": {
    id: "lint",
    label: "ESLint Check",
    description: "Real `npm run lint` → `eslint` — the same command behind package.json's \"lint\" script.",
    category: "quality",
    executable: "npm",
    fixedArgs: ["run", "lint"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: MIN_4,
    maxOutputBytes: 5_242_880,
    allowConcurrent: false,
    exclusiveLockKey: null,
    eventCategory: "quality",
    mode: "READ_ONLY", changesWorkspace: false, requiresOwnerConfirmation: false,
    evidenceSource: "eslint's CLI (eslint.org/docs/latest/use/command-line-interface) writes no file to disk unless --fix or --output-file is passed — neither flag is in fixedArgs here.",
    status: "active",
  },
  "governance.test": {
    id: "governance.test",
    label: "Governance Regression Suite",
    description: "Real `npm run governance:test` — verifies registry/CONSTITUTION.json + registry/rule-coverage.json (re-runs the real governance summary generator first).",
    category: "test",
    executable: "npm",
    fixedArgs: ["run", "governance:test"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: MIN_4,
    maxOutputBytes: 5_242_880,
    allowConcurrent: false,
    exclusiveLockKey: "registry-write",
    eventCategory: "test",
    // WORKSPACE_WRITE: scripts/governance-test.ts's own main() calls
    // execFileAsync(...\"build-governance-summary.ts\") before asserting
    // anything, which writeFileSync's registry/governance-summary.json —
    // verified by reading the script, not assumed from the name "test".
    mode: "WORKSPACE_WRITE", changesWorkspace: true, requiresOwnerConfirmation: true,
    evidenceSource: "scripts/governance-test.ts's main() calls execFileAsync(...\"build-governance-summary.ts\") before asserting anything; that script writeFileSync's registry/governance-summary.json.",
    status: "active",
  },
  "artifact.test": {
    id: "artifact.test",
    label: "Artifact Pipeline Regression Suite",
    description: "Real `npm run artifact:test` — verifies the real Artifact Pipeline & Evidence Warehouse (Step 5).",
    category: "test",
    executable: "npm",
    fixedArgs: ["run", "artifact:test"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: MIN_4,
    maxOutputBytes: 5_242_880,
    allowConcurrent: false,
    exclusiveLockKey: null,
    eventCategory: "test",
    mode: "READ_ONLY", changesWorkspace: false, requiresOwnerConfirmation: false,
    evidenceSource: "scripts/artifact-test.ts creates artifacts only in artifactRuntime.ts's real in-memory Map (process-local, never written to disk) — verified by reading the script (no writeFileSync anywhere in it).",
    status: "active",
  },
  "ui-inspection.test": {
    id: "ui-inspection.test",
    label: "UI Inspection Regression Suite",
    description: "Real `npm run ui-inspection:test` — verifies the real Browser Inspection Runtime (Step 6) against real Chromium pages via Playwright.",
    category: "test",
    executable: "npm",
    fixedArgs: ["run", "ui-inspection:test"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: MIN_10,
    maxOutputBytes: 5_242_880,
    allowConcurrent: false,
    exclusiveLockKey: null,
    eventCategory: "test",
    mode: "READ_ONLY", changesWorkspace: false, requiresOwnerConfirmation: false,
    evidenceSource: "scripts/ui-inspection-test.ts's real browser sessions run against page.setContent() fixtures / a live localhost preview URL — no real source file write, verified by reading the script (no writeFileSync anywhere in it).",
    status: "active",
  },
  "review.test": {
    id: "review.test",
    label: "Code Review Pipeline Regression Suite",
    description: "Real `npm run review:test` — verifies the real Change Set Runtime & Code Review Pipeline (Step 7) against this repo's actual live working tree.",
    category: "test",
    executable: "npm",
    fixedArgs: ["run", "review:test"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: MIN_5,
    maxOutputBytes: 5_242_880,
    allowConcurrent: false,
    exclusiveLockKey: null,
    eventCategory: "test",
    mode: "READ_ONLY", changesWorkspace: false, requiresOwnerConfirmation: false,
    evidenceSource: "scripts/review-test.ts's own \"Read Only\" test asserts real git status/HEAD are byte-identical before and after the suite runs — verified live every time the suite itself runs.",
    status: "active",
  },
  // ---- Software Factory Step 9 (Build Pipeline) addition ----
  "registry.sync": {
    id: "registry.sync",
    label: "Registry Sync",
    description: "Real `npm run sync` → sync-registry.ts + build-arch-book.ts + build-system-control-graph.ts + build-governance-summary.ts — regenerates registry/module-registry.json, registry/architecture-book.json, registry/system-control-graph.json, registry/governance-summary.json from real, current source.",
    category: "governance",
    executable: "npm",
    fixedArgs: ["run", "sync"],
    dynamicArgumentSchema: {},
    workingDirectoryPolicy: "workspace_root",
    timeoutMs: MIN_5,
    maxOutputBytes: 5_242_880,
    allowConcurrent: false,
    exclusiveLockKey: "registry-write",
    eventCategory: "governance",
    mode: "WORKSPACE_WRITE", changesWorkspace: true, requiresOwnerConfirmation: true,
    evidenceSource: "scripts/sync-registry.ts/build-arch-book.ts/build-system-control-graph.ts/build-governance-summary.ts all real writeFileSync calls to registry/*.json — verified by reading each script; this is a declared GENERATED_REGISTRY write, never a source-file write.",
    status: "active",
  },
};

export function listCommandDefinitions(): CommandDefinition[] {
  return Object.values(COMMAND_REGISTRY);
}

export function getCommandDefinition(commandId: string): CommandDefinition {
  const def = COMMAND_REGISTRY[commandId];
  if (!def) throw new ExecutionError("INVALID_COMMAND", `unknown commandId: ${commandId}`);
  return def;
}

/**
 * Validates client-supplied dynamic args against a command's schema.
 * Every current command has an empty schema, so any key at all is rejected
 * — this is intentionally strict rather than permissive-by-default.
 */
export function validateDynamicArgs(def: CommandDefinition, args: Record<string, unknown> | undefined): void {
  const provided = args ?? {};
  const providedKeys = Object.keys(provided);
  const schemaKeys = Object.keys(def.dynamicArgumentSchema);

  for (const key of providedKeys) {
    if (!schemaKeys.includes(key)) {
      throw new ExecutionError("INVALID_ARGUMENT", `command "${def.id}" does not accept argument "${key}"`);
    }
  }
  for (const key of schemaKeys) {
    const spec = def.dynamicArgumentSchema[key];
    const value = provided[key];
    if (value === undefined) {
      if (spec.required) throw new ExecutionError("INVALID_ARGUMENT", `missing required argument "${key}"`);
      continue;
    }
    if (spec.type === "string" && typeof value !== "string") throw new ExecutionError("INVALID_ARGUMENT", `argument "${key}" must be a string`);
    // Reject shell operators/newlines at validation time — before the value
    // is ever appended to argv. spawn(shell:false) already makes these
    // inert as argv content (proven by a dedicated regression test), but
    // the Command Policy refuses to even ACCEPT one: receiving it is real
    // evidence of an attempted shell-command construction, not a typed value.
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

export function resolveWorkingDirectory(def: CommandDefinition): string {
  // Only one policy exists today — "workspace_root" — kept as an explicit
  // switch (not a silent default) so a future policy can't be added by
  // accident without a real branch here.
  switch (def.workingDirectoryPolicy) {
    case "workspace_root":
      return WORKSPACE_ROOT;
    default:
      throw new ExecutionError("INTERNAL_ERROR", `unknown workingDirectoryPolicy: ${def.workingDirectoryPolicy}`);
  }
}

/** Environment allowlist — only these names, only if actually set on the
 * server process, are ever passed to a child. The full process.env (which
 * may contain Supabase/Anthropic/DB secrets) is NEVER passed through. */
export const CHILD_ENV_ALLOWLIST = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SHELL", "NODE_ENV", "npm_config_cache"] as const;

export function buildChildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Command Policy denylist (owner, 2026-08-06, Real Terminal Execution) —
 * real defense-in-depth, not the primary gate. The primary gate is that
 * COMMAND_REGISTRY is allowlist-only: a commandId not in it is already
 * INVALID_COMMAND before any of this runs. This function exists so that
 * (a) it's independently unit-testable against the exact denylist the
 * spec names, and (b) executeDefinition() re-checks every resolved
 * executable+argv against it right before spawning, as a real second
 * layer — never trusting "it's in the registry" alone. Parses the REAL
 * executable basename and REAL argv array (never a joined/guessed string).
 */
const DENIED_EXECUTABLE_BASENAMES = new Set([
  "rm", "rmdir", "mv", "cp", "chmod", "chown", "sudo", "su",
  "curl", "wget", "ssh", "scp", "rsync",
  "brew", "apt", "apt-get", "yum", "docker", "kubectl", "vercel", "supabase",
  "npm-install", // never a real binary — defensive placeholder, see npm subcommand check below
  "kill", "pkill", "killall", "shutdown", "reboot", "launchctl", "open", "osascript",
]);
/** Git subcommands that mutate history/remote/working-tree state — never
 * runnable from this Terminal, regardless of what other args accompany them. */
const DENIED_GIT_SUBCOMMANDS = new Set(["commit", "push", "pull", "checkout", "reset", "clean", "rebase", "merge", "branch", "tag", "stash"]);
/** npm/pnpm/yarn subcommands that install or modify dependencies. */
const DENIED_PACKAGE_SUBCOMMANDS = new Set(["install", "i", "add", "remove", "uninstall", "update", "upgrade", "ci"]);
/** Literal shell metacharacters/operators — even though shell:false makes
 * these inert as argv content (proven by a real regression test), the
 * Command Policy explicitly refuses to even ACCEPT an argument containing
 * one, since receiving them is itself a sign of a client trying to build a
 * shell command rather than use a typed argument. */
const SHELL_INJECTION_PATTERN = /[;&|<>`]|\$\(|\r|\n/;

export interface DenyCheckResult { denied: boolean; reason: string | null }

export function isCommandDenied(executable: string, argv: string[]): DenyCheckResult {
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
  if (basename === "npx" && argv.length > 0) {
    // Only the exact allowlisted npx invocations already in COMMAND_REGISTRY
    // are ever reachable here — this is a defense-in-depth re-check, not
    // the primary gate (which is registry membership).
    const allowedNpxInvocations = Object.values(COMMAND_REGISTRY)
      .filter((d) => d.executable === "npx")
      .map((d) => d.fixedArgs.join(" "));
    if (!allowedNpxInvocations.includes(argv.join(" "))) {
      return { denied: true, reason: "npx invocation is not one of the registry's allowlisted commands" };
    }
  }
  for (const arg of argv) {
    if (SHELL_INJECTION_PATTERN.test(arg)) {
      return { denied: true, reason: "argument contains a shell operator or newline character — rejected outright, never passed to spawn" };
    }
  }
  return { denied: false, reason: null };
}
