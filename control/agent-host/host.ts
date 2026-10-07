/**
 * หน้าที่: `launchAgent()` — the one real function that makes DNA OS the
 * parent process of an Agent, per Phase 8's audit ("MINIMUM_MISSING_MECHANISM:
 * an Agent-process launcher/sandbox that DNA OS controls"). This is the
 * ONLY new capability this round creates — Discovery
 * (`DNA-LAB-FILE-INTELLIGENCE`), the Command Router, Capability Registry,
 * Identity/Workspace resolution, `permissions/execution-policy`,
 * `permissions/write-gate`, `execution/file-write/`, and Circuit are all
 * reused as-is by this round's proof harness (`./tests/proof.test.ts`),
 * never reimplemented here.
 *
 * What this function does NOT do: decide identity, discovery, routing,
 * or write authorization. It only (1) generates a real macOS sandbox
 * profile scoping the child's writes to one workspace directory and its
 * exec rights to exactly one executable (see ./host-runtime.ts's
 * 2026-08-22 hardening pass for the current profile), (2) spawns the
 * child through that profile with a minimal, credential-free
 * environment, (3) captures stdout/stderr/exit code, (4) enforces a
 * timeout with a real kill. A caller
 * that wants an authorized write performed on the Agent's behalf must
 * still go through the real, existing `permissions/write-gate/` +
 * `execution/file-write/` — see ./tests/proof.test.ts for exactly that
 * composition.
 *
 * 2026-08-22 addition (Owner: "Filesystem Jail & Admission Gate" +
 * "Deterministic Circuit Breaker" — see
 * `/Users/tam/.claude/plans/zesty-spinning-ripple.md`): `launchAgent`
 * used to only resolve on exit, with no way for an outside caller to
 * observe or stop a launch mid-flight. `listActiveLaunches`/`killLaunch`
 * add a live, in-memory registry of running launches — **the only
 * source of PIDs `control/circuit-breaker/` may ever act on**, per the
 * Owner's own scoping decision (agent-host-launched subprocesses only,
 * never an interactive coding session).
 *
 * Input: `AgentLaunchRequest`.
 * Output: `AgentLaunchResult`, `ActiveLaunch`, `listActiveLaunches`,
 * `killLaunch`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never pass the calling process's full `process.env` to
 * the child — only the fixed, minimal, credential-free env this file
 * itself constructs. Never skip writing a fresh sandbox profile per
 * launch (no shared/mutable profile file between launches). Never let
 * `killLaunch` act on a `launchId` this registry did not itself create —
 * no caller-supplied PID may ever be signaled directly.
 */

import { ensureDirReal, fileExistsReal, joinPath, killPid, newLaunchId, nowIso, spawnConfinedAgent, writeSandboxProfile, type HostChildProcess } from "./host-runtime";
import type { ActiveLaunch, AgentLaunchRequest, AgentLaunchResult } from "./types";

/** Grace period between SIGTERM and SIGKILL — same value as `../../execution/run/executor.ts`'s `GRACE_PERIOD_MS`, same reasoning (give a real process a chance to exit cleanly before a hard kill). */
const KILL_GRACE_PERIOD_MS = 5_000;

interface TrackedLaunch {
  launchId: string;
  pid: number;
  allowedWorkspaceDir: string;
  startedAt: string;
  child: HostChildProcess;
}

/** Live registry of currently-running launches — cleared entry-by-entry as each child exits (see `finish()` below). Module-level, matching `../../execution/run/executor.ts`'s own `executions` Map precedent for the same "one process, one live registry" pattern. */
const activeLaunches = new Map<string, TrackedLaunch>();

export function listActiveLaunches(): readonly ActiveLaunch[] {
  return Array.from(activeLaunches.values()).map(({ launchId, pid, allowedWorkspaceDir, startedAt }) => ({ launchId, pid, allowedWorkspaceDir, startedAt }));
}

/**
 * Kills a launch this registry itself is tracking — never any other PID.
 * Graceful `SIGTERM` first, `SIGKILL` after `KILL_GRACE_PERIOD_MS` if the
 * child hasn't exited by then, mirroring
 * `../../execution/run/executor.ts`'s `killGracefully` exactly (same
 * grace period, same "only escalate if it's still alive" check).
 */
export function killLaunch(launchId: string, _reason: string): { ok: boolean; reason?: string } {
  const tracked = activeLaunches.get(launchId);
  if (!tracked) return { ok: false, reason: "UNKNOWN_LAUNCH_ID — not an active, agent-host-tracked launch" };
  killPid(tracked.pid, "SIGTERM");
  const timer = setTimeout(() => {
    if (activeLaunches.has(launchId)) killPid(tracked.pid, "SIGKILL");
  }, KILL_GRACE_PERIOD_MS);
  (timer as { unref?: () => void }).unref?.();
  return { ok: true };
}

declare const setTimeout: (fn: () => void, ms: number) => unknown;
declare const clearTimeout: (timer: unknown) => void;

/**
 * Only these names are ever passed to the Agent child — no GITHUB_*,
 * VERCEL_*, SUPABASE_*, or any `_TOKEN`/`_SECRET`/`_KEY` name, regardless
 * of what this host process's own environment contains. Matches
 * `../../execution/run/registry.ts`'s `CHILD_ENV_ALLOWLIST` discipline,
 * applied independently here (this capability does not import that
 * file — it is `execution/run/`'s own internal allowlist for a different
 * purpose, registered POSIX diagnostics — but the same "credential-free
 * child env" principle is enforced here for the Agent process).
 */
const AGENT_ENV_ALLOWLIST = ["PATH", "TMPDIR", "LANG", "LC_ALL", "DNA_OS_AGENT_EXECUTION_ID", "DNA_OS_AGENT_TASK_ID"] as const;

function buildAgentEnv(hostEnv: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of AGENT_ENV_ALLOWLIST) {
    const value = hostEnv[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export function launchAgent(request: AgentLaunchRequest, hostEnv: Readonly<Record<string, string | undefined>>, outsideProbeDirs: readonly string[]): Promise<AgentLaunchResult> {
  const launchId = newLaunchId();
  const profileDir = joinPath(request.allowedWorkspaceDir, "..", ".agent-host-profiles");
  ensureDirReal(profileDir);
  const profilePath = joinPath(profileDir, `${launchId}.sb`);
  // อาร์กิวเมนต์ที่เป็น path ของไฟล์จริง = โปรแกรมที่ worker ถูกสั่งให้รัน ต้องอ่านได้
  const argvPaths = request.agentArgv.filter((a) => a.startsWith("/") && fileExistsReal(a));
  writeSandboxProfile(profilePath, request.allowedWorkspaceDir, request.agentExecutable, outsideProbeDirs,
                      request.repositoryReadPaths ?? [], request.workerRuntimeReadPaths, argvPaths);

  const env = buildAgentEnv(hostEnv);
  env.DNA_OS_AGENT_EXECUTION_ID = launchId;
  if (typeof request.task_id === "string" && request.task_id.length > 0) {
    env.DNA_OS_AGENT_TASK_ID = request.task_id;
  }
  const startedAt = nowIso();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child: HostChildProcess = spawnConfinedAgent(profilePath, request.agentExecutable, request.agentArgv, request.allowedWorkspaceDir, env);
    if (child.pid) activeLaunches.set(launchId, { launchId, pid: child.pid, allowedWorkspaceDir: request.allowedWorkspaceDir, startedAt, child });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, request.timeoutMs);

    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      if (lineBuffer.trim() !== "") { emit(lineBuffer); lineBuffer = ""; }
      activeLaunches.delete(launchId);
      clearTimeout(timeoutTimer);
      const completedAt = nowIso();
      resolve({
        launchId,
        pid: child.pid ?? null,
        parentPid: typeof process !== "undefined" ? process.pid : -1,
        cwd: request.allowedWorkspaceDir,
        envPassed: env,
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
        startedAt,
        completedAt,
        durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      });
    };

    /**
     * อ่าน stream ทีละบรรทัดระหว่างที่โปรเซสยังมีชีวิต แล้วค่อยสะสมไว้เหมือนเดิม
     *
     * ลำดับสำคัญ: `stdout` ถูกต่อก่อนเสมอ ผู้ฟังจึงไม่มีทางทำให้ผลสุดท้ายเปลี่ยน
     * แม้มันจะโยน error — จับไว้ทั้งหมด เพราะการ "ได้ยิน" ต้องไม่ทำให้การรัน
     * ที่สำเร็จอยู่แล้วกลายเป็นล้มเหลว
     *
     * บรรทัดสุดท้ายที่ยังไม่ปิดด้วย \n ถูกกันไว้ใน buffer และปล่อยตอน finish()
     * ไม่ปล่อยครึ่งบรรทัดออกไปให้ใครแปล
     */
    let lineBuffer = "";
    const emit = (line: string): void => {
      if (!request.onEvent || line.trim() === "") return;
      try { request.onEvent(line); } catch { /* ผู้ฟังพังไม่ทำให้ Agent พัง */ }
    };
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString("utf-8");
      stdout += text;
      lineBuffer += text;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) emit(line);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      stderr += `\n[agent-host] spawn error: ${error.message}`;
      finish(null, null);
    });
    child.on("exit", (code, signal) => {
      finish(code, signal);
    });
  });
}

declare const process: { pid: number } | undefined;
