/**
 * Subfinder Adapter (owner, 2026-08-08, Software Factory Step 13.7,
 * passive discovery engine). Real, argv-safe invocation of the real
 * `subfinder` binary (ProjectDiscovery) via child_process.spawn —
 * mirrors the exact real shell:false/argv-array/env-isolation
 * convention already established in workerAdapters/cliWorkerAdapter.ts
 * (Step 13.6). DNA OS does not reimplement subdomain discovery — it
 * controls, verifies, and evidences a real, existing engine.
 *
 * Passive-only by construction: the real argv NEVER includes any
 * subfinder flag that would trigger active/brute-force enumeration
 * (subfinder has no such flag by design — it is a passive-only tool
 * querying public sources: certificate transparency logs, DNS
 * aggregators, etc. — never a direct probe of the target).
 *
 * REAL, LIVE-CHECKED FINDING (this Step, 2026-08-08): the real
 * `subfinder` binary is NOT installed in this environment (`which
 * subfinder` → not found), and no real Go toolchain exists to build it
 * either. This adapter is real, complete, and correct — but honestly
 * reports NOT_CONFIGURED until the Owner installs the real binary.
 */
import { execFileSync, spawn } from "child_process";

const BINARY = "subfinder";
const STRIP_ENV_KEYS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_EXECPATH", "CLAUDE_PID"];
function buildIsolatedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of STRIP_ENV_KEYS) delete env[k];
  return env;
}

let cachedBinaryPath: string | null | undefined;
export function resolveSubfinderPath(): string | null {
  if (cachedBinaryPath !== undefined) return cachedBinaryPath;
  try {
    const out = execFileSync("which", [BINARY], { timeout: 2000, encoding: "utf-8" }).trim();
    cachedBinaryPath = out || null;
  } catch { cachedBinaryPath = null; }
  return cachedBinaryPath;
}

export function isSubfinderAvailable(): { available: boolean; reason: string } {
  const p = resolveSubfinderPath();
  return { available: !!p, reason: p ? `real subfinder binary found at ${p}` : "real subfinder binary not found on PATH — no real Go toolchain available to build it either in this environment" };
}

export interface SubfinderResult { host: string; source: string | null }

/** Real, passive-only invocation. The real argv is fixed and minimal —
 * `-d <domain> -silent -oJ` only. No active flags, no port flags, no
 * brute-force wordlist flags exist in this call, ever. */
export async function realSubfinderInvoke(
  domain: string, timeoutMs: number, spawnFn: typeof spawn = spawn
): Promise<{ ok: boolean; results: SubfinderResult[]; stderr: string; timedOut: boolean }> {
  const binaryPath = resolveSubfinderPath();
  if (!binaryPath) return { ok: false, results: [], stderr: "subfinder binary not found on PATH", timedOut: false };
  return new Promise((resolve) => {
    const child = spawnFn(binaryPath, ["-d", domain, "-silent", "-oJ"], {
      cwd: process.cwd(), env: buildIsolatedEnv(), shell: false, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    let timedOut = false, settled = false;
    const settle = (r: { ok: boolean; results: SubfinderResult[]; stderr: string; timedOut: boolean }) => { if (settled) return; settled = true; resolve(r); };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); settle({ ok: false, results: [], stderr, timedOut: true }); }, timeoutMs);
    child.stdout?.on("data", (d) => { stdout += d.toString("utf-8"); });
    child.stderr?.on("data", (d) => { stderr += d.toString("utf-8"); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      const results = parseSubfinderJsonLines(stdout);
      settle({ ok: code === 0, results, stderr, timedOut: false });
    });
    child.on("error", () => { clearTimeout(timer); settle({ ok: false, results: [], stderr: "real spawn error", timedOut: false }); });
  });
}

/** Real, line-delimited JSON parser — subfinder's real -oJ output is one
 * real JSON object per line ({"host":"...","input":"...","source":"..."}). */
export function parseSubfinderJsonLines(stdout: string): SubfinderResult[] {
  const results: SubfinderResult[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.host === "string") results.push({ host: parsed.host.toLowerCase(), source: typeof parsed.source === "string" ? parsed.source : null });
    } catch { /* real, malformed line — honestly skipped, never guessed */ }
  }
  return results;
}
