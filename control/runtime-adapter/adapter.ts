/**
 * หน้าที่: PHASE 4 RECONCILIATION — the ONE process-launch orchestration
 * this capability exposes to `execution/run/process-gate.ts` (for
 * `ProcessDescriptor` entries declaring `confinement: "policy"`) —
 * never called directly by any candidate, Agent, or other capability
 * folder. Turns a `RuntimeLaunchRequest` + the CANONICAL
 * `./types.ts#ConfinementSpec` into a real `sandbox-exec`-confined child
 * process.
 *
 * Owner reconciliation (2026-08-24): this file previously built its own
 * SBPL profile (`./policy.ts#buildPolicyDrivenSandboxProfile`) and
 * called `child_process.spawn` directly — a second, parallel confinement
 * contract AND a second raw spawn site. Both are retired. This file now
 * ONLY orchestrates (allocate a session id, build the profile via
 * `./seatbelt.ts#buildSeatbeltProfile`, launch via
 * `./host-runtime.ts#spawnConfined`, collect output, enforce the
 * timeout, return a result) — the actual profile rendering and the
 * actual spawn both belong to the canonical primitives `./pty.ts`
 * already uses, so there is exactly ONE Seatbelt renderer and ONE spawn
 * call site in this whole capability, not two.
 *
 * Input: `RuntimeLaunchRequest` (already-resolved absolute executable,
 * already-constructed minimal env, already-built `ConfinementSpec`).
 * Output: `RuntimeLaunchResult`. Never a PASS/FAIL verdict — only raw
 * `exit_code`/`stdout`/`stderr`/`timed_out`, exactly like every other
 * Process Gate confinement branch; the caller (Candidate Verification
 * Runtime) does all interpretation.
 * Dependency ที่อนุญาต: ./types.ts, ./seatbelt.ts, ./host-runtime.ts,
 * node:crypto (evidence hashing only).
 * สิ่งที่ห้ามแตะ: never call this file from anywhere other than
 * `execution/run/process-gate.ts`. Never accept a caller-supplied raw
 * profile string — always derive it from `buildSeatbeltProfile`. Never
 * call `child_process` directly in this file — all real execution goes
 * through `./host-runtime.ts#spawnConfined`. Never pass through more of
 * `process.env` than `request.env` already contains — this file reads no
 * ambient environment itself.
 */

import { createHash } from "node:crypto";
import { buildSeatbeltProfile } from "./seatbelt";
import { ensureDir, joinPath, killPid, newSessionId, nowIso, spawnConfined, writeTextFile } from "./host-runtime";
import type { ConfinementSpec } from "./types";

export interface RuntimeLaunchRequest {
  /** Real, absolute, already-existsSync-verified executable path — the literal argv[0]. This file never resolves or substitutes it. */
  executable: string;
  argv: readonly string[];
  cwd: string;
  /** Already-allowlist-filtered by the caller (mirrors `control/agent-host/host.ts#buildAgentEnv`'s discipline) — this file never reads `process.env` itself. */
  env: Readonly<Record<string, string>>;
  confinement: ConfinementSpec;
  timeout_ms: number;
}

export interface RuntimeLaunchResult {
  launch_id: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  /** sha256 of the generated SBPL profile text — real evidence of exactly what confinement was applied, without persisting the profile file's contents inline. */
  profile_hash: string;
}

const PROFILE_DIR = "/tmp/dna-os-runtime-adapter-profiles";

/** Grace period between the timeout firing and a hard kill — matches `../agent-host/host.ts`'s own KILL_GRACE_PERIOD_MS discipline. */
const KILL_GRACE_PERIOD_MS = 5_000;

export async function launchViaRuntimeAdapter(request: RuntimeLaunchRequest): Promise<RuntimeLaunchResult> {
  const launch_id = newSessionId();
  ensureDir(PROFILE_DIR);
  const { sbpl } = buildSeatbeltProfile(request.confinement);
  const profilePath = joinPath(PROFILE_DIR, `${launch_id}.sb`);
  writeTextFile(profilePath, sbpl);
  const profile_hash = createHash("sha256").update(sbpl).digest("hex");

  const started_at = nowIso();
  const startMs = Date.now();

  const child = spawnConfined(profilePath, request.executable, request.argv, request.cwd, { ...request.env });

  return await new Promise<RuntimeLaunchResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timed_out = false;
    let settled = false;

    const timer = setTimeout(() => {
      timed_out = true;
      if (child.pid !== undefined) killPid(child.pid, "SIGKILL");
    }, request.timeout_ms);

    // Outer guard: a real kill if the wrapper itself is wedged past the grace period.
    const guard = setTimeout(() => {
      if (child.pid !== undefined) killPid(child.pid, "SIGKILL");
    }, request.timeout_ms + KILL_GRACE_PERIOD_MS);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });

    const finish = (exit_code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(guard);
      resolve({
        launch_id, exit_code, stdout, stderr, timed_out,
        started_at, finished_at: nowIso(), duration_ms: Date.now() - startMs, profile_hash,
      });
    };

    child.on("exit", (code) => finish(code));
    child.on("error", () => finish(null));
  });
}
