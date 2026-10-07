/**
 * หน้าที่: enforce a persisted `ResolvedWorkContext` at the OS SANDBOX
 * boundary — the step that turns "the Agent should only write here" from a
 * library convention into a kernel fact.
 *
 *   work_id -> loadResolution -> digest check -> ConfinementSpec
 *           -> control/runtime-adapter/#launchViaRuntimeAdapter (sandbox-exec)
 *
 * NO NEW SANDBOX, NO NEW WRITE GATE. The confinement contract
 * (`ConfinementSpec`), the SBPL renderer (`buildSeatbeltProfile`) and the
 * single spawn site (`spawnConfined`) are all the EXISTING canonical
 * `control/runtime-adapter/` from Phase 4's reconciliation. This file only
 * TRANSLATES a resolution into that contract.
 *
 * WHY THIS CLOSES THE BYPASS THE LIBRARY GATE COULD NOT: `guardAgentWrite`
 * only constrains writes that choose to call it. A kernel-enforced Seatbelt
 * profile constrains every write the process makes — `fs.writeFileSync`, a
 * shell redirect, a symlink target, anything — because the denial happens
 * in the kernel, below the language runtime. An Agent cannot opt out of it
 * by not calling a function.
 *
 * FAIL-CLOSED RULES, all of them load-bearing:
 *  - a resolution that is not `dispatchable` never launches
 *  - a STALE resolution never launches (its scope may describe code that
 *    has since moved)
 *  - an EMPTY `allowed_write_scope` never launches — an empty allowlist
 *    would render as a profile granting write nowhere, which looks safe but
 *    means the caller lost the scope, and silently launching a process that
 *    can do nothing hides the real error
 *
 * Input: a `work_id` (+ the executable to run).
 * Output: `buildConfinementForWork`, `launchAgentForWork`.
 * Dependency ที่อนุญาต: ./types.ts, ./persistence.ts, ./host-runtime.ts,
 * ../runtime-adapter/contract.ts.
 * สิ่งที่ห้ามแตะ: never widen `allowWritePaths` beyond the resolution's own
 * `allowed_write_scope`, and never add a caller-supplied escape hatch to
 * this translation — the whole guarantee is that the profile is DERIVED
 * from persisted state, not chosen at launch time.
 */

import { resolve as resolvePath, isAbsolute } from "node:path";
import { loadResolution } from "./persistence";
import { REPO_ROOT, expandHome, pathExists } from "./host-runtime";
import type { ResolvedWorkContext } from "./types";
import { launchViaRuntimeAdapter, type ConfinementSpec, type RuntimeLaunchResult } from "../runtime-adapter/contract";

export type SandboxRefusalCode =
  | "NO_PERSISTED_RESOLUTION"
  | "RESOLUTION_STALE"
  | "NOT_DISPATCHABLE"
  | "EMPTY_WRITE_SCOPE"
  | "EXECUTABLE_NOT_FOUND";

export interface ConfinementBuildResult {
  readonly ok: boolean;
  readonly refusal_code: SandboxRefusalCode | null;
  readonly confinement: ConfinementSpec | null;
  readonly context: ResolvedWorkContext | null;
  readonly detail: string;
}

function toAbsolute(path: string): string {
  const expanded = expandHome(path);
  return isAbsolute(expanded) ? expanded : resolvePath(REPO_ROOT, expanded);
}

/**
 * Translates a persisted resolution into the existing confinement
 * contract. Everything not in `allowed_write_scope` is denied by the
 * profile's own default — including `forbidden_write_scope`, which needs
 * no explicit rule because it is never inside the allowlist. It is still
 * passed through `denyWriteWithinAllowed` so that a future overlapping
 * scope cannot silently re-open it.
 */
export function buildConfinementForWork(workId: string, executable: string, extraExecPaths: readonly string[] = []): ConfinementBuildResult {
  const loaded = loadResolution(workId);
  if (!loaded) {
    return { ok: false, refusal_code: "NO_PERSISTED_RESOLUTION", confinement: null, context: null, detail: `no persisted ResolvedWorkContext for work_id "${workId}" — resolution must happen and be persisted BEFORE launch` };
  }
  if (loaded.stale) {
    return { ok: false, refusal_code: "RESOLUTION_STALE", confinement: null, context: loaded.context, detail: loaded.staleness_reason };
  }
  const context = loaded.context;
  if (!context.dispatchable) {
    return { ok: false, refusal_code: "NOT_DISPATCHABLE", confinement: null, context, detail: context.blocking_reason || "resolution is not dispatchable" };
  }
  if (context.allowed_write_scope.length === 0) {
    return { ok: false, refusal_code: "EMPTY_WRITE_SCOPE", confinement: null, context, detail: "allowed_write_scope is empty — refusing to launch rather than granting write nowhere and hiding the lost scope" };
  }
  if (!pathExists(executable)) {
    return { ok: false, refusal_code: "EXECUTABLE_NOT_FOUND", confinement: null, context, detail: `executable "${executable}" does not exist` };
  }

  const confinement: ConfinementSpec = {
    // THE kernel-enforced write boundary. Nothing else on the machine is
    // writable by the spawned Agent.
    allowWritePaths: context.allowed_write_scope.map(toAbsolute),
    // Belt-and-braces: these are already outside the allowlist, but naming
    // them means an overlapping future scope cannot re-open them.
    denyWriteWithinAllowed: context.forbidden_write_scope.map(toAbsolute),
    denyReadPaths: [],
    allowReadWithinDenied: [],
    execAllowPaths: [toAbsolute(executable), ...extraExecPaths.map(toAbsolute)],
    network: { mode: "DENY_ALL" },
  };

  return { ok: true, refusal_code: null, confinement, context, detail: `write confined to ${confinement.allowWritePaths.join(", ")}; everything else kernel-denied` };
}

export interface SandboxLaunchOutcome {
  readonly launched: boolean;
  readonly refusal_code: SandboxRefusalCode | null;
  readonly detail: string;
  readonly result: RuntimeLaunchResult | null;
  readonly confinement: ConfinementSpec | null;
}

/**
 * Spawns the Agent inside the sandbox derived from persisted state. The
 * env is a fixed, credential-free allowlist — the same discipline
 * `control/agent-host/host.ts#buildAgentEnv` already applies.
 */
export async function launchAgentForWork(
  workId: string,
  executable: string,
  argv: readonly string[],
  options: { timeoutMs?: number; extraExecPaths?: readonly string[]; hostEnv?: Readonly<Record<string, string | undefined>> } = {},
): Promise<SandboxLaunchOutcome> {
  const built = buildConfinementForWork(workId, executable, options.extraExecPaths ?? []);
  if (!built.ok || !built.confinement || !built.context) {
    return { launched: false, refusal_code: built.refusal_code, detail: built.detail, result: null, confinement: null };
  }

  const hostEnv = options.hostEnv ?? (process.env as Record<string, string | undefined>);
  const env: Record<string, string> = {};
  for (const key of ["PATH", "TMPDIR", "LANG", "LC_ALL"]) {
    const value = hostEnv[key];
    if (value !== undefined) env[key] = value;
  }

  const result = await launchViaRuntimeAdapter({
    executable: toAbsolute(executable),
    argv,
    cwd: toAbsolute(built.context.allowed_write_scope[0]),
    env,
    confinement: built.confinement,
    timeout_ms: options.timeoutMs ?? 60_000,
  });

  return { launched: true, refusal_code: null, detail: built.detail, result, confinement: built.confinement };
}
