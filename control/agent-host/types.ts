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
  /**
   * SANDBOX PROFILE V1 (Owner, APPROVE_SANDBOX_PROFILE_V1). Real absolute
   * repository paths this launch may READ — the Agent's assigned source plus
   * its declared dependency reads, nothing else. Optional so every existing
   * caller keeps working: when absent, the profile grants read only to
   * `allowedWorkspaceDir` and the worker's own runtime, which is strictly
   * narrower than the pre-V1 behaviour (repository-wide read), never wider.
   */
  repositoryReadPaths?: readonly string[];
  /**
   * Real absolute paths the WORKER ITSELF needs to read to start (its own
   * install tree — e.g. the node prefix, `~/.codex`). Classified as
   * SYSTEM_RUNTIME_READ, never as repository data. Absent = derived from the
   * executable's own ancestors, bounded to three levels and never `/Users`
   * or a bare home directory.
   */
  workerRuntimeReadPaths?: readonly string[];
  /**
   * ผู้ฟัง stdout ทีละบรรทัด (Owner, USE_EXISTING_CONTINUATION_MODEL ข้อ 1).
   *
   * Worker ถูกปล่อยด้วย `--output-format stream-json` / `--json` อยู่แล้ว ซึ่ง
   * ปล่อย event ทีละบรรทัดระหว่างทำงาน แต่ก่อนหน้านี้ไม่มีใครอ่านมันเลย —
   * ทุกบรรทัดถูกต่อกันเป็นสตริงเดียวและโผล่ตอนโปรเซสตายเท่านั้น สิ่งที่ Agent
   * พูดระหว่างทาง (ข้อความ สถานะ คำถาม) จึงหายไปทั้งหมด
   *
   * ออปชัน — ผู้เรียกเดิมทุกตัวไม่ต้องแก้ และ `stdout` ที่คืนตอนจบยังเป็นก้อน
   * เดิมครบทุกไบต์เหมือนเดิม ตัวนี้ "เพิ่มการได้ยิน" ไม่ได้เปลี่ยนผลลัพธ์
   */
  onEvent?: (line: string) => void;
  /** Optional assigned task id stamped into the child env. Never copied from ambient host env. */
  task_id?: string;
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
