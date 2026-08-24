/**
 * หน้าที่: the Executable Registry for the DNA OS Process Gate (Owner,
 * "Single Process Creation Gate — Consolidation"). Every executable any
 * internal DNA-OS component may ever spawn (outside Agent Host's own
 * AI-runtime worker registry, `control/agent-host/worker-registry.ts`,
 * which serves a separate, already-real purpose) must have a real entry
 * here, resolved to its canonical absolute path and its real filesystem
 * `realpath` at check time — never a bare name, never PATH-resolved as
 * an authority decision.
 *
 * Input: none (module-level constant + pure functions).
 * Output: `PROCESS_REGISTRY`, `getProcessDescriptor`.
 * Dependency ที่อนุญาต: node:fs (existsSync/realpathSync — read only).
 * สิ่งที่ห้ามแตะ: never add an entry whose `canonical_path` is a bare
 * name (e.g. "node", "git") — every entry must be an absolute path this
 * file (or the caller, for machine-specific installs) has verified
 * exists. Never widen `environment_profile` beyond PATH/TMPDIR/LANG/
 * LC_ALL without an explicit, separately-reviewed grant.
 */

import { existsSync, realpathSync } from "node:fs";
import type { ConfinementSpec } from "../../control/runtime-adapter/contract";

export type NetworkProfile = "none" | "loopback_only";
export type CredentialProfile = "none" | "keychain_read" | "keychain_write";

export interface ProcessDescriptor {
  executable_id: string;
  /** The literal, absolute path this registry names — never a bare command name. */
  canonical_path: string;
  /** Real, allowed_callers-scoped identifiers (module paths) permitted to request this executable — a real technical check, never a comment. */
  allowed_callers: readonly string[];
  allowed_operations: readonly string[];
  /** Validates a real argv array against this entry's shape — returns true only for a recognized, safe shape. */
  allowed_argv_shape: (argv: readonly string[]) => boolean;
  /** Absolute path prefix the requested cwd must fall under. */
  allowed_cwd_scope: string;
  environment_profile: readonly string[];
  network_profile: NetworkProfile;
  credential_profile: CredentialProfile;
  timeout_ms: number;
  /**
   * "sandboxed" (default intent): executed via control/agent-host's real
   * sandbox-exec confinement — for anything touching untrusted/external
   * input (file-intelligence's external repo scan, dna-os-circuit's
   * resolver). "direct": executed in-process via execFile, still ONLY
   * from within ./process-gate.ts (the one file this whole registry
   * governs) — required for macOS Keychain operations specifically:
   * empirically confirmed this round that wrapping `/usr/bin/security`
   * in sandbox-exec changes its responsible-process identity enough that
   * the OS's own Keychain ACL (scoped to the real, unwrapped binary)
   * returns NOT_FOUND for an item that resolves correctly unsandboxed —
   * a real, surprising macOS behavior, not a Process Gate bug. Keychain
   * calls originate from DNA OS's own trusted code (not an untrusted AI
   * runtime), so the real security requirement is authorization
   * (allowed_callers, already enforced), not filesystem/network
   * confinement — sandboxing it would only break the OS's own ACL
   * without adding a real protection this registry doesn't already give.
   */
  /**
   * "policy" (Owner, Phase 4 — "Runtime Primitive Boundary"): executed
   * via `control/runtime-adapter/contract.ts#launchViaRuntimeAdapter`
   * instead of `control/agent-host`'s single-workspace/single-executable
   * `launchAgent` — for callers whose real, necessary process tree needs
   * MORE than one exec literal (today: `candidate.node.npm.*`, whose
   * `npm run-script` genuinely spawns a real shell — see
   * `control/runtime-adapter/README.md`'s disclosed finding). Still
   * kernel-enforced sandbox-exec confinement, still reached only through
   * this registry + `./process-gate.ts`; `build_confinement_spec` is
   * required for this confinement and ignored otherwise.
   */
  confinement: "sandboxed" | "direct" | "policy";
  /** Required iff confinement === "policy" — builds this call's real, canonical `ConfinementSpec` (`control/runtime-adapter/types.ts`) from its real cwd. A function (not a static object) because `allowWritePaths` depends on the specific candidate workspace a given request targets — the exec allowlist and network/fork stance stay fixed per registry entry, only the path varies. `buildSeatbeltProfile` resolves symlinks internally, so this function never needs to pre-compute a realpath itself. */
  build_confinement_spec?: (cwd: string) => ConfinementSpec;
}

function exactArgv(...expected: readonly string[]): (argv: readonly string[]) => boolean {
  return (argv) => argv.length === expected.length && argv.every((a, i) => a === expected[i]);
}

function prefixArgv(...expectedPrefix: readonly string[]): (argv: readonly string[]) => boolean {
  return (argv) => argv.length >= expectedPrefix.length && expectedPrefix.every((a, i) => argv[i] === a);
}

/**
 * `npm run <script>` alone (no HOME in the env allowlist — see
 * `DEFAULT_ENV_PROFILE`) makes npm try to write its cache/log files
 * under `~/.npm`, which the sandbox correctly denies (outside
 * `allowedWorkspaceDir`), corrupting an otherwise-successful script's
 * exit code with an unrelated npm-internal log-write error (found
 * empirically this round). The fix is `--cache <dir>`, a real,
 * documented npm flag that relocates BOTH cache and logs — never an
 * env var, never a widened allowlist. Still a closed shape: only a
 * `--cache` value that is itself an absolute path under
 * `cwdScopePrefix` is accepted, so this can never redirect npm's cache
 * outside the candidate's own workspace.
 */
function npmScriptArgv(script: "build" | "test", cwdScopePrefix: string): (argv: readonly string[]) => boolean {
  return (argv) =>
    argv.length === 5 &&
    argv[0] === NPM_CLI_JS_PATH &&
    argv[1] === "run" &&
    argv[2] === script &&
    argv[3] === "--cache" &&
    typeof argv[4] === "string" &&
    argv[4].startsWith(`${cwdScopePrefix}/`) &&
    !argv[4].includes("..");
}

const DEFAULT_ENV_PROFILE = ["PATH", "TMPDIR", "LANG", "LC_ALL"] as const;

/**
 * Real, machine-specific, existsSync-verified at module load (Owner,
 * "Phase 3.5"). Read directly rather than resolved from PATH at request
 * time — the whole point of pinning `allowed_argv_shape` to this exact
 * literal is that it never changes per-request.
 */
export const NPM_CLI_JS_PATH = "/Users/tam/.nvm/versions/node/v16.20.2/lib/node_modules/npm/bin/npm-cli.js";

/**
 * Phase 4 real finding, reconciled onto the canonical `ConfinementSpec`
 * (Owner, "Phase 4 — Canonical Reconciliation"): `npm run-script` itself
 * spawns a real shell (`/bin/sh`, which macOS's own `/bin/sh` further
 * re-execs as `/bin/bash` internally) to run the candidate's declared
 * script command — a single-exec-literal profile denies that shell
 * outright. Unlike this function's earlier, retired `SandboxPolicy`
 * form, `allowWritePaths` needs only the given `cwd` once —
 * `control/runtime-adapter/seatbelt.ts#buildSeatbeltProfile` resolves
 * the kernel realpath itself for every path field, so the caller never
 * duplicates that logic. `/usr/local/bin/node`, `/bin/sh`, and
 * `/bin/bash` are all real, non-symlinked binaries on this host (checked
 * via `realpath`) — no `execAllowSubpaths` hop-chasing is needed for
 * this specific exec set, unlike the Python3-interpreter-stub case
 * `control/runtime-adapter/host-runtime.ts` documents for PTY sessions.
 */
export function buildNpmScriptConfinementSpec(cwd: string): ConfinementSpec {
  return {
    allowWritePaths: [cwd],
    denyWriteWithinAllowed: [],
    denyReadPaths: [],
    allowReadWithinDenied: [],
    execAllowPaths: ["/usr/local/bin/node", "/bin/sh", "/bin/bash"],
    network: { mode: "DENY_ALL" },
  };
}

export const PROCESS_REGISTRY: Readonly<Record<string, ProcessDescriptor>> = {
  "git.rev-parse-toplevel": {
    executable_id: "git.rev-parse-toplevel",
    canonical_path: "/usr/bin/git",
    allowed_callers: ["connections/agent-registry/codex-session-bridge.ts"],
    allowed_operations: ["read"],
    allowed_argv_shape: exactArgv("rev-parse", "--show-toplevel"),
    allowed_cwd_scope: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE",
    environment_profile: DEFAULT_ENV_PROFILE,
    network_profile: "none",
    credential_profile: "none",
    timeout_ms: 10_000,
    confinement: "sandboxed",
  },
  "git.branch-show-current": {
    executable_id: "git.branch-show-current",
    canonical_path: "/usr/bin/git",
    allowed_callers: ["connections/agent-registry/codex-session-bridge.ts"],
    allowed_operations: ["read"],
    allowed_argv_shape: exactArgv("branch", "--show-current"),
    allowed_cwd_scope: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE",
    environment_profile: DEFAULT_ENV_PROFILE,
    network_profile: "none",
    credential_profile: "none",
    timeout_ms: 10_000,
    confinement: "sandboxed",
  },
  "file-intelligence.scan": {
    executable_id: "file-intelligence.scan",
    canonical_path: "ts-node", // resolved to an absolute path per-call by the caller (external repo location varies by machine, read from bootstrap.mjs's own config.json) — see process-gate.ts's resolution step, which requires the caller-supplied path to already be absolute and existsSync-verified before this descriptor is even consulted.
    allowed_callers: ["control/agent-gateway/adapters/file-intelligence-adapter.ts"],
    allowed_operations: ["scan"],
    allowed_argv_shape: prefixArgv(),
    allowed_cwd_scope: "/",
    environment_profile: DEFAULT_ENV_PROFILE,
    network_profile: "none",
    credential_profile: "none",
    timeout_ms: 45_000,
    confinement: "sandboxed",
  },
  "dna-os-circuit.resolve": {
    executable_id: "dna-os-circuit.resolve",
    canonical_path: "/usr/local/bin/node",
    allowed_callers: ["dna-os-circuit/runtime/server.ts"],
    allowed_operations: ["resolve"],
    allowed_argv_shape: (argv) => argv.length >= 1,
    allowed_cwd_scope: "/",
    environment_profile: DEFAULT_ENV_PROFILE,
    network_profile: "none",
    credential_profile: "none",
    timeout_ms: 30_000,
    confinement: "sandboxed",
  },
  "keychain.find-generic-password": {
    executable_id: "keychain.find-generic-password",
    canonical_path: "/usr/bin/security",
    allowed_callers: ["credentials/macos-keychain/provider.ts"],
    allowed_operations: ["read"],
    allowed_argv_shape: prefixArgv("find-generic-password"),
    allowed_cwd_scope: "/tmp/dna-os-process-gate",
    environment_profile: DEFAULT_ENV_PROFILE,
    network_profile: "none",
    credential_profile: "keychain_read",
    timeout_ms: 10_000,
    confinement: "direct",
  },
  "keychain.add-generic-password": {
    executable_id: "keychain.add-generic-password",
    canonical_path: "/usr/bin/security",
    allowed_callers: ["credentials/macos-keychain/registration.ts", "credentials/macos-keychain/api-registration.ts"],
    allowed_operations: ["write"],
    allowed_argv_shape: prefixArgv("add-generic-password"),
    allowed_cwd_scope: "/tmp/dna-os-process-gate",
    environment_profile: DEFAULT_ENV_PROFILE,
    network_profile: "none",
    credential_profile: "keychain_write",
    timeout_ms: 10_000,
    confinement: "direct",
  },
  /**
   * Owner, "Phase 3.5 — Candidate Verification Runtime". Runs a
   * CANDIDATE's own declared `npm run build`, never an Agent-chosen
   * shell command. `canonical_path` names the real node binary directly
   * (never a bare "npm" — npm's own executable is a shebang script,
   * which would force the kernel to resolve a SECOND process identity
   * via `/usr/bin/env`, the exact real gap already found and left
   * unresolved for `ts-node` in `file-intelligence.scan`). npm's own
   * `bin/npm-cli.js` is passed as a plain script argv element instead —
   * read, never executed as its own identity — and `argv` is pinned to
   * the literal `["<npm-cli.js>", "run", "build"]` shape, so no other
   * npm subcommand (install, publish, etc.) can ever be requested
   * through this entry.
   */
  "candidate.node.npm.build": {
    executable_id: "candidate.node.npm.build",
    canonical_path: "/usr/local/bin/node",
    allowed_callers: ["control/agent-gateway/candidate-verification-runtime.ts"],
    allowed_operations: ["build"],
    allowed_argv_shape: npmScriptArgv("build", "/tmp/dna-os-agent-workspaces"),
    allowed_cwd_scope: "/tmp/dna-os-agent-workspaces",
    environment_profile: DEFAULT_ENV_PROFILE,
    network_profile: "none",
    credential_profile: "none",
    timeout_ms: 60_000,
    confinement: "policy",
    build_confinement_spec: buildNpmScriptConfinementSpec,
  },
  /** Same reasoning as candidate.node.npm.build — pinned to exactly `["<npm-cli.js>", "run", "test"]`. */
  "candidate.node.npm.test": {
    executable_id: "candidate.node.npm.test",
    canonical_path: "/usr/local/bin/node",
    allowed_callers: ["control/agent-gateway/candidate-verification-runtime.ts"],
    allowed_operations: ["test"],
    allowed_argv_shape: npmScriptArgv("test", "/tmp/dna-os-agent-workspaces"),
    allowed_cwd_scope: "/tmp/dna-os-agent-workspaces",
    environment_profile: DEFAULT_ENV_PROFILE,
    network_profile: "none",
    credential_profile: "none",
    timeout_ms: 60_000,
    confinement: "policy",
    build_confinement_spec: buildNpmScriptConfinementSpec,
  },
};

export interface ProcessResolution {
  ok: boolean;
  descriptor: ProcessDescriptor | null;
  realpath: string | null;
  reason: "EXECUTABLE_NOT_REGISTERED" | "EXECUTABLE_IDENTITY_MISMATCH" | "OK" | null;
}

/**
 * Resolves an `executable_id` to its descriptor AND verifies the real,
 * current filesystem identity of `canonical_path`.
 *
 * SECURITY-CRITICAL (fixed 2026-08-24 after adversarial testing found
 * this real gap): a caller-supplied `resolvedAbsolutePath` is honored
 * ONLY for entries whose registry `canonical_path` is NOT itself already
 * an absolute path (today: exactly `file-intelligence.scan`'s `ts-node`,
 * resolved per-machine from a real, already-verified config file). For
 * every entry whose `canonical_path` IS already absolute (security, git,
 * node), a caller-supplied override is REJECTED outright — the registry
 * alone decides the executable identity. The earlier version of this
 * function accepted any existsSync-verified `resolvedAbsolutePath`
 * unconditionally, which let a caller substitute an arbitrary binary
 * (proven via a symlink pointing at `/bin/echo` executing successfully
 * in place of `/usr/bin/security`) — this is the fix for that finding.
 */
export function resolveProcessDescriptor(executableId: string, resolvedAbsolutePath?: string): ProcessResolution {
  const descriptor = PROCESS_REGISTRY[executableId];
  if (!descriptor) return { ok: false, descriptor: null, realpath: null, reason: "EXECUTABLE_NOT_REGISTERED" };

  const canonicalIsAbsolute = descriptor.canonical_path.startsWith("/");
  if (canonicalIsAbsolute && resolvedAbsolutePath !== undefined) {
    // A caller tried to substitute a path for an executable this registry
    // already names absolutely — never honored, regardless of whether the
    // substituted path exists.
    return { ok: false, descriptor, realpath: null, reason: "EXECUTABLE_IDENTITY_MISMATCH" };
  }
  if (!canonicalIsAbsolute && resolvedAbsolutePath === undefined) {
    return { ok: false, descriptor, realpath: null, reason: "EXECUTABLE_IDENTITY_MISMATCH" };
  }

  const absolutePath = canonicalIsAbsolute ? descriptor.canonical_path : resolvedAbsolutePath!;
  if (!absolutePath.startsWith("/") || !existsSync(absolutePath)) {
    return { ok: false, descriptor, realpath: null, reason: "EXECUTABLE_IDENTITY_MISMATCH" };
  }
  const real = realpathSync(absolutePath);
  return { ok: true, descriptor: { ...descriptor, canonical_path: absolutePath }, realpath: real, reason: "OK" };
}
