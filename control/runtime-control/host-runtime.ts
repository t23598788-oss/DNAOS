/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (child processes, network, filesystem, clock). Every
 * function here reports exactly what `launchctl`/`lsof`/an HTTP request
 * actually returned — never a guess, never a cached/assumed value. This is
 * what makes `../../governance/architecture-rules/` fabrication ban
 * enforceable for this capability: `resolver.ts` may only build evidence
 * out of what these functions genuinely observed.
 *
 * Input: none.
 * Output: `SERVICES` (the static 4-service registry), `getLaunchdState`,
 * `launchctlBootstrap`, `launchctlBootout`, `launchctlKickstart`,
 * `getListeningPids`, `httpHealthCheck`, `nowIso`, `newOperationId`,
 * `appendEvidence`, `sleep`.
 * Dependency ที่อนุญาต: node:child_process, node:http, node:fs, node:os,
 * node:crypto — stdlib only, matching this repo's existing local-service
 * pattern (e.g. `research/dashboard/api/server.py`'s "stdlib http.server +
 * sqlite3 only" convention).
 * สิ่งที่ห้ามแตะ: never add a retry/poll loop with no bound here — every
 * caller in `resolver.ts` controls its own bounded wait. Never widen
 * `SERVICES` without the Owner adding it explicitly. The Owner added
 * `machine-observer` on 2026-08-26; the four Discovery confirmed
 * (deadboard, lab-ui, research-api, compute-api) plus that one are the whole
 * scope, and a sixth still needs the same explicit instruction.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import type { ServiceDefinition, ServiceId, LaunchdState, HealthCheckResult, OperationEvidence } from "./types";

const HOME = userInfo().homedir;

export const SERVICES: Record<ServiceId, ServiceDefinition> = {
  // The observation runtime (Owner, 2026-08-26). It gets an HTTP health
  // surface for one reason: that is the shape this supervisor already knows
  // how to probe. See control/machine-observation/start.ts.
  "machine-observer": {
    service_id: "machine-observer",
    launchd_label: "com.dnaos.machine-observer",
    plist_path: join(HOME, "Library/LaunchAgents/com.dnaos.machine-observer.plist"),
    port: 5179,
    health_path: "/health",
    health_expect_status: 200,
  },
  deadboard: {
    service_id: "deadboard",
    launchd_label: "com.dnaos.deadboard-dev",
    plist_path: join(HOME, "Library/LaunchAgents/com.dnaos.deadboard-dev.plist"),
    port: 3000,
    health_path: "/login",
    health_expect_status: 200,
  },
  "lab-ui": {
    service_id: "lab-ui",
    launchd_label: "com.dnaos.research-monitor-ui",
    plist_path: join(HOME, "Library/LaunchAgents/com.dnaos.research-monitor-ui.plist"),
    port: 5177,
    health_path: "/",
    health_expect_status: 200,
  },
  "research-api": {
    service_id: "research-api",
    launchd_label: "com.dnaos.research-api",
    plist_path: join(HOME, "Library/LaunchAgents/com.dnaos.research-api.plist"),
    port: 8787,
    health_path: "/api/research/latest",
    health_expect_status: 200,
  },
  "compute-api": {
    service_id: "compute-api",
    launchd_label: "com.dnaos.dna-os-compute-api",
    plist_path: join(HOME, "Library/LaunchAgents/com.dnaos.dna-os-compute-api.plist"),
    port: 8788,
    health_path: "/api/gpu/offers",
    health_expect_status: 200,
  },
};

function launchdDomain(): string {
  return `gui/${process.getuid?.() ?? 0}`;
}

export function getLaunchdState(label: string): LaunchdState {
  let out: string;
  try {
    out = execFileSync("launchctl", ["list"], { encoding: "utf8" });
  } catch (error) {
    return { label, pid: null, loaded: false };
  }
  const line = out.split("\n").find((l) => l.trim().endsWith(`\t${label}`) || l.trim() === label || l.includes(`\t${label}`));
  if (!line) return { label, pid: null, loaded: false };
  const cols = line.trim().split(/\s+/);
  const pidCol = cols[0];
  const pid = pidCol === "-" ? null : Number.parseInt(pidCol, 10);
  return { label, pid: Number.isFinite(pid as number) ? (pid as number) : null, loaded: true };
}

export function launchctlBootstrap(plistPath: string): { ok: boolean; error: string | null } {
  try {
    execFileSync("launchctl", ["bootstrap", launchdDomain(), plistPath], { encoding: "utf8", stdio: "pipe" });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: (error as { stderr?: Buffer }).stderr?.toString().trim() || String(error) };
  }
}

export function launchctlBootout(label: string): { ok: boolean; error: string | null } {
  try {
    execFileSync("launchctl", ["bootout", `${launchdDomain()}/${label}`], { encoding: "utf8", stdio: "pipe" });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: (error as { stderr?: Buffer }).stderr?.toString().trim() || String(error) };
  }
}

export function launchctlKickstart(label: string, force = true): { ok: boolean; error: string | null } {
  try {
    const args = force ? ["kickstart", "-k", `${launchdDomain()}/${label}`] : ["kickstart", `${launchdDomain()}/${label}`];
    execFileSync("launchctl", args, { encoding: "utf8", stdio: "pipe" });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: (error as { stderr?: Buffer }).stderr?.toString().trim() || String(error) };
  }
}

/** Real listening-socket owners for a port, via `lsof` — independent of whatever launchd believes; this is what makes health/duplicate detection a separate fact from launchd state, per the Owner's explicit rule. */
export function getListeningPids(port: number): number[] {
  try {
    const out = execFileSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { encoding: "utf8" });
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

export function httpHealthCheck(port: number, path: string, timeoutMs = 4000): Promise<HealthCheckResult> {
  return new Promise((resolve) => {
    const req = httpGet({ host: "127.0.0.1", port, path, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ checked_at: nowIso(), http_status: res.statusCode ?? null, healthy: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400, error: null });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ checked_at: nowIso(), http_status: null, healthy: false, error: `timeout after ${timeoutMs}ms` });
    });
    req.on("error", (err) => {
      resolve({ checked_at: nowIso(), http_status: null, healthy: false, error: err.message });
    });
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newOperationId(): string {
  return randomUUID();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DATA_DIR = join(process.cwd(), "control/runtime-control/data");
const EVIDENCE_PATH = join(DATA_DIR, "operations.jsonl");

export function appendEvidence(evidence: OperationEvidence): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(EVIDENCE_PATH, JSON.stringify(evidence) + "\n", { encoding: "utf8" });
}

export { EVIDENCE_PATH };
