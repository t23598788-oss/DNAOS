/**
 * หน้าที่: type contracts for `control/agent-host/` — the one capability
 * Phase 8's audit proved MISSING (an "Agent Process Host/Launcher" that
 * makes DNA OS the parent of an Agent process, instead of the Agent
 * holding DNA OS as a callable library). This folder does not re-decide
 * identity, discovery, routing, permission, or write authorization — it
 * only launches a child process under a real OS-level confinement and
 * returns its observed behavior.
 *
 * Input: none (pure type definitions).
 * Output: `AgentLaunchRequest`, `AgentLaunchResult`, `ActiveLaunch`
 * (added 2026-08-22 for `control/circuit-breaker/`'s live registry read
 * — see ./host.ts's `listActiveLaunches`).
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a field letting a caller widen the sandbox
 * (e.g. an extra allowed path list beyond `allowedWorkspaceDir`) without
 * that widening being an explicit, separate request field — never an
 * implicit default.
 */

export interface AgentLaunchRequest {
  /** Real absolute path the Agent process's cwd is set to — the only directory it is allowed to read/write via the OS-level confinement. */
  allowedWorkspaceDir: string;
  /** Real absolute path to the executable to launch as "the Agent" (this proof round: a plain Node script). */
  agentExecutable: string;
  /** Argv passed to the Agent process — the "one controlled instruction". */
  agentArgv: readonly string[];
  timeoutMs: number;
}

/** One currently-running launch, as tracked live by ./host.ts's in-memory registry — the only source of PIDs `control/circuit-breaker/` may ever kill (see ./host.ts's `listActiveLaunches`/`killLaunch` header). */
export interface ActiveLaunch {
  launchId: string;
  pid: number;
  allowedWorkspaceDir: string;
  startedAt: string;
}

export interface AgentLaunchResult {
  launchId: string;
  pid: number | null;
  parentPid: number;
  cwd: string;
  envPassed: Readonly<Record<string, string>>;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}
