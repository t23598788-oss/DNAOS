/**
 * Phase 1 — Build/Test execution for a remote compute server.
 *
 * Same process-spawning discipline as app/api/admin/ide/_lib/
 * executionRuntime.ts ("the ONLY real process spawner" + fixed argv,
 * allowlist, execFile — never a shell string) but reimplemented here so the
 * compute plane has zero imports from Business Runtime code. The script may
 * only be a member of the static per-kind allowlist in types.ts — the client
 * can never send an argv, only a script NAME. Env is a minimal whitelist
 * (never inherits the host environment) so Production credentials can never
 * leak into a child process by inheritance.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { BUILD_SCRIPTS, TEST_SCRIPTS } from "./types.js";

const execFileAsync = promisify(execFile);

export class ExecError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Envelope of which npm scripts each command kind may run. */
export function allowedScripts(kind: "build.run" | "test.run"): readonly string[] {
  return kind === "build.run" ? BUILD_SCRIPTS : TEST_SCRIPTS;
}

const ENV_WHITELIST = ["NODE_ENV", "CI", "PATH", "HOME", "TEMP", "TMPDIR", "LANG", "LC_ALL"];

export interface RunScriptResult {
  status: "SUCCEEDED" | "FAILED" | "SCOPE_DENIED";
  output: string | null;
  error: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Run `npm run <script>` in workspaceRoot with a fixed argv, a timeout and a
 * whitelisted child env. Any argument not on the allowlist is SCOPE_DENIED.
 * Exit code / stdout / stderr are reported honest and raw.
 */
export async function runBuildOrTestScript(
  kind: "build.run" | "test.run",
  workspaceRoot: string,
  payload: { script: string },
): Promise<RunScriptResult> {
  const allow = allowedScripts(kind);
  if (typeof payload?.script !== "string" || !(allow as readonly string[]).includes(payload.script)) {
    return { status: "SCOPE_DENIED", output: null, error: `script '${String(payload?.script ?? "")}' is not on the ${kind} allowlist: ${allow.join(", ")}` };
  }
  // Typed as NodeJS.ProcessEnv because Next.js's global augmentation makes
  // ProcessEnv.NNODE_ENV a required literal union — Record<string,string>
  // fails assignability under the root tsconfig. Default honestly to "test".
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "test" };
  for (const key of ENV_WHITELIST) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.npm_config_yes = "false"; // never let a script install interactively
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    const { stdout, stderr } = await execFileAsync(npm, ["run", payload.script], {
      cwd: workspaceRoot,
      env,
      timeout: 600_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: "SUCCEEDED", output: (stdout ?? "").slice(-100_000), error: stderr ? stderr.slice(-20_000) : null, meta: { exitCode: 0, script: payload.script, cwd: workspaceRoot } };
  } catch (error) {
    const e = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    const failed = "real process exit was non-zero (or timed out) — reported honestly, never coerced to success";
    return {
      status: "FAILED",
      output: e.stdout ? String(e.stdout).slice(-100_000) : null,
      error: `${failed}: exit=${String(e.code ?? "timeout")} ${e.stderr ? String(e.stderr).slice(-20_000) : ""}`.trim(),
      meta: { exitCode: e.killed ? 124 : Number(e.code ?? 1), script: payload.script, cwd: workspaceRoot },
    };
  }
}
