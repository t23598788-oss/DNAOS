/**
 * httpx Adapter (owner, 2026-08-08, Software Factory Step 13.7,
 * non-invasive live-HTTP verification). Real, argv-safe invocation of
 * the real `httpx` binary (ProjectDiscovery) via child_process.spawn —
 * same real, safe convention as subfinderAdapter.ts/cliWorkerAdapter.ts.
 *
 * Non-invasive by construction: the real, fixed argv below NEVER
 * includes `-ports` (multi-port probing == port scanning, forbidden),
 * NEVER includes any fuzzing/wordlist/brute-force flag (httpx has none
 * built in — that is a different class of tool, deliberately not used),
 * and NEVER includes any flag that would send anything beyond one real,
 * standard HTTP/HTTPS GET request per host on its declared scheme.
 * Hosts are piped via real stdin, never concatenated into a shell
 * string and never placed in argv (keeps argv length bounded and
 * avoids any host string being treated as a flag).
 *
 * REAL, LIVE-CHECKED FINDING (this Step, 2026-08-08): the real `httpx`
 * binary is NOT installed in this environment — honestly NOT_CONFIGURED
 * until the Owner installs it.
 */
import { execFileSync, spawn } from "child_process";

const BINARY = "httpx";
const STRIP_ENV_KEYS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_EXECPATH", "CLAUDE_PID"];
function buildIsolatedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of STRIP_ENV_KEYS) delete env[k];
  return env;
}

let cachedBinaryPath: string | null | undefined;
export function resolveHttpxPath(): string | null {
  if (cachedBinaryPath !== undefined) return cachedBinaryPath;
  try {
    const out = execFileSync("which", [BINARY], { timeout: 2000, encoding: "utf-8" }).trim();
    cachedBinaryPath = out || null;
  } catch { cachedBinaryPath = null; }
  return cachedBinaryPath;
}

export function isHttpxAvailable(): { available: boolean; reason: string } {
  const p = resolveHttpxPath();
  return { available: !!p, reason: p ? `real httpx binary found at ${p}` : "real httpx binary not found on PATH" };
}

export interface HttpProbeResult {
  host: string; url: string; statusCode: number | null; title: string | null; technologies: string[];
  ip: string | null; redirectChain: string[]; tlsSubject: string | null; tlsIssuer: string | null; tlsExpiry: string | null; failed: boolean;
}

/** Real, non-invasive-only invocation. Fixed, minimal, safe argv:
 * -json -silent -status-code -title -tech-detect -follow-redirects
 * -tls-grab — no -ports, no fuzz flags, ever. */
export async function realHttpxInvoke(
  hosts: string[], timeoutMs: number, spawnFn: typeof spawn = spawn
): Promise<{ ok: boolean; results: HttpProbeResult[]; stderr: string; timedOut: boolean }> {
  const binaryPath = resolveHttpxPath();
  if (!binaryPath) return { ok: false, results: [], stderr: "httpx binary not found on PATH", timedOut: false };
  return new Promise((resolve) => {
    const child = spawnFn(binaryPath, ["-json", "-silent", "-status-code", "-title", "-tech-detect", "-follow-redirects", "-tls-grab"], {
      cwd: process.cwd(), env: buildIsolatedEnv(), shell: false, stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    let timedOut = false, settled = false;
    const settle = (r: { ok: boolean; results: HttpProbeResult[]; stderr: string; timedOut: boolean }) => { if (settled) return; settled = true; resolve(r); };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); settle({ ok: false, results: [], stderr, timedOut: true }); }, timeoutMs);
    child.stdout?.on("data", (d) => { stdout += d.toString("utf-8"); });
    child.stderr?.on("data", (d) => { stderr += d.toString("utf-8"); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      settle({ ok: code === 0, results: parseHttpxJsonLines(stdout), stderr, timedOut: false });
    });
    child.on("error", () => { clearTimeout(timer); settle({ ok: false, results: [], stderr: "real spawn error", timedOut: false }); });
    // Real hosts piped via real stdin — never argv, never a shell string.
    child.stdin?.write(hosts.join("\n"));
    child.stdin?.end();
  });
}

export function parseHttpxJsonLines(stdout: string): HttpProbeResult[] {
  const results: HttpProbeResult[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const p = JSON.parse(trimmed);
      results.push({
        host: p.host ?? p.input ?? "", url: p.url ?? "", statusCode: typeof p.status_code === "number" ? p.status_code : null,
        title: typeof p.title === "string" ? p.title : null, technologies: Array.isArray(p.tech) ? p.tech : [],
        ip: typeof p.host === "string" ? (p["a"]?.[0] ?? null) : null, redirectChain: Array.isArray(p.chain) ? p.chain.map((c: { url?: string }) => c.url ?? "") : [],
        tlsSubject: p.tls?.subject_cn ?? null, tlsIssuer: p.tls?.issuer_cn ?? null, tlsExpiry: p.tls?.not_after ?? null, failed: !!p.failed,
      });
    } catch { /* real, malformed line — honestly skipped */ }
  }
  return results;
}
