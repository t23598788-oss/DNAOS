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
 * `machine-observer` on 2026-08-26, and `recovery-supervisor` on the same
 * day (the instruction to make the recovery loop persistent through the
 * existing runtime mechanism). Those two plus the four Discovery confirmed
 * (deadboard, lab-ui, research-api, compute-api) are the whole scope, and a
 * seventh still needs the same explicit instruction.
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
  // OBSERVATION SPINE. Everything that reports a joint needs this listening,
  // so it has no DNA OS dependency of its own and starts first. It ran
  // unsupervised until 2026-08-27 and died silently, taking every live
  // observation with it while the data on disk stayed intact — the Workspace
  // simply had no way to read it.
  "joint-monitor": {
    service_id: "joint-monitor",
    launchd_label: "com.dnaos.joint-monitor",
    plist_path: join(HOME, "Library/LaunchAgents/com.dnaos.joint-monitor.plist"),
    port: 5178,
    health_path: "/joints",
    health_expect_status: 200,
    // tsx cold start — measured at ~6s on this machine, so 30s is headroom,
    // not a guess.
    readiness_timeout_ms: 30_000,
    depends_on: [],
  },

  // THE OWNER-FACING SURFACE. It proxies to compute-api and joint-monitor, so
  // starting it before them produces a UI that opens and instantly reports its
  // own dependencies as DOWN — which reads identically to those dependencies
  // being broken. Order is declared so that cannot happen.
  "control-workspace": {
    service_id: "control-workspace",
    launchd_label: "com.dnaos.control-workspace",
    plist_path: join(HOME, "Library/LaunchAgents/com.dnaos.control-workspace.plist"),
    port: 5181,
    health_path: "/api/health",
    health_expect_status: 200,
    // plain node, no compile step — observed answering in ~1s after launchd
    // reports a pid.
    readiness_timeout_ms: 15_000,
    depends_on: ["joint-monitor", "compute-api"],
  },

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
    // a tsx start that compiles the observation modules before it binds its
    // port. MEASURED 2026-08-26 across five real restarts: launchd reports a
    // PID within ~200ms, and the first 200 on /health lands 1.0-1.1s later.
    // The old single probe fired inside that gap, which is the whole reason
    // every successful restart was recorded FAILED. 30s is that ~1s
    // measurement with a wide margin for a genuinely cold module cache.
    readiness_timeout_ms: 30_000,
    depends_on: [],
  },
  // The autonomous recovery loop's own runtime (Owner, 2026-08-26 — the
  // explicit instruction this file's header requires for a sixth service:
  // "make the existing recovery supervisor persistent through the existing
  // sanctioned runtime mechanism"). launchd owns its liveness; it never
  // supervises itself.
  "recovery-supervisor": {
    service_id: "recovery-supervisor",
    launchd_label: "com.dnaos.recovery-supervisor",
    plist_path: join(HOME, "Library/LaunchAgents/com.dnaos.recovery-supervisor.plist"),
    port: 5180,
    health_path: "/health",
    health_expect_status: 200,
    // A tsx start that compiles the backbone modules before it binds. Same
    // shape and same measured cold-start class as machine-observer.
    readiness_timeout_ms: 30_000,
    depends_on: [],
  },
  deadboard: {
    service_id: "deadboard",
    launchd_label: "com.dnaos.deadboard-dev",
    plist_path: join(HOME, "Library/LaunchAgents/com.dnaos.deadboard-dev.plist"),
    port: 3000,
    health_path: "/login",
    health_expect_status: 200,
    // Next.js dev server — it compiles /login on the first request, so first-answer is the slowest of the five. Not yet measured here; 60s is the bound, and a real timeout is reported as a timeout rather than hidden.
    readiness_timeout_ms: 60_000,
    depends_on: [],
  },
  "lab-ui": {
    service_id: "lab-ui",
    launchd_label: "com.dnaos.research-monitor-ui",
    plist_path: join(HOME, "Library/LaunchAgents/com.dnaos.research-monitor-ui.plist"),
    port: 5177,
    health_path: "/",
    health_expect_status: 200,
    // Vite dev server cold start. Not yet measured here; reported as a timeout if it is ever exceeded.
    readiness_timeout_ms: 30_000,
    depends_on: [],
  },
  "research-api": {
    service_id: "research-api",
    launchd_label: "com.dnaos.research-api",
    plist_path: join(HOME, "Library/LaunchAgents/com.dnaos.research-api.plist"),
    port: 8787,
    health_path: "/api/research/latest",
    health_expect_status: 200,
    // tsx server process, same class of cold start as machine-observer.
    readiness_timeout_ms: 30_000,
    depends_on: [],
  },
  "compute-api": {
    service_id: "compute-api",
    launchd_label: "com.dnaos.dna-os-compute-api",
    plist_path: join(HOME, "Library/LaunchAgents/com.dnaos.dna-os-compute-api.plist"),
    port: 8788,
    health_path: "/api/gpu/offers",
    health_expect_status: 200,
    // tsx server process, same class of cold start as machine-observer.
    readiness_timeout_ms: 30_000,
    depends_on: [],
  },
  // MCP INGRESS. เพิ่ม 2026-08-29 ตามคำสั่ง Owner ที่ระบุชัด
  // (ESTABLISH_RUNTIME_OWNER_FOR_EXISTING_DNA_OS_MCP) — capability
  // `dna-os-mcp` (capability-05b9e2ba-ebc3-42fc-9e2b-92a456951ea2) มีอยู่ใน
  // registry ตั้งแต่ 2026-08-20 พร้อม 7 tool แต่ไม่เคยมีเจ้าของ runtime จึงไม่
  // เคยมีผู้เรียกได้จริง service นี้คือเจ้าของนั้น ไม่ได้สร้าง MCP ใหม่
  //
  // health_path "/health" เป็นของที่ server มีอยู่แล้ว
  // (connections/dna-os-mcp/server.ts#startHttp) ไม่ได้เพิ่มเพื่อการนี้ และ
  // พิสูจน์ได้แค่ว่า listener ตอบ — ไม่ได้พิสูจน์ protocol/tool inventory
  // การพิสูจน์สองอย่างหลังต้อง POST /mcp ซึ่งอยู่นอกสัญญา health ทั่วไปของ
  // capability นี้ จึงไม่ถูกอ้างว่าตรวจแล้วที่นี่
  //
  // depends_on: [] ตามคำนิยาม "ไม่มี DNA OS dependency" ในความหมายของ
  // ตารางนี้ — ที่ตอนสตาร์ทเป็นจริง เพราะ server bind และตอบ /health ได้
  // โดยไม่ต้องมี 8791 ส่วน DNA_OS_HTTP_BASE_URL=127.0.0.1:8791
  // (owner-command-http) จำเป็นตอน "เรียก tool" ไม่ใช่ตอนสตาร์ท และ
  // owner-command-http ยังไม่ใช่ ServiceId ในตารางนี้ จึงประกาศเป็น
  // dependency ที่นี่ไม่ได้ — บันทึกไว้ตรงนี้แทนการเงียบ
  "dna-os-mcp": {
    service_id: "dna-os-mcp",
    launchd_label: "com.dnaos.dna-os-mcp",
    plist_path: join(HOME, "Library/LaunchAgents/com.dnaos.dna-os-mcp.plist"),
    port: 8793,
    health_path: "/health",
    health_expect_status: 200,
    // tsx cold start บน node v24 — วัดจริงก่อนลงทะเบียน: bind ที่วินาทีที่ 2
    // 30s คือ headroom เดียวกับบริการ tsx ตัวอื่นในตารางนี้ ไม่ใช่ค่าเดา
    readiness_timeout_ms: 30_000,
    depends_on: [],
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

/**
 * ── ผูก path ตอนเรียก ไม่ใช่ตอนโหลดโมดูล (2026-08-29) ──
 * เดิมค่านี้ถูกคำนวณครั้งเดียวตอน import ซึ่งเป็นความผิดพลาดชนิดเดียวกับที่ทำให้
 * หลักฐาน machine-observation หายไป 187 แถว: เทสต์ที่ตั้ง env หลัง import จะไม่มีผล
 * และเขียนทับสโตร์จริงโดยไม่มีใครรู้ตัว การอ่าน env ตอนเรียกทำให้การแยกสโตร์ของ
 * เทสต์เป็นจริงได้โดยไม่ขึ้นกับลำดับ import
 */
function evidenceDataDir(): string {
  const override = process.env.RUNTIME_CONTROL_DATA_DIR;
  if (override !== undefined && override.length > 0) return override;
  return join(process.cwd(), "control/runtime-control/data");
}

/** path ที่จะถูกเขียนจริง ณ ขณะนี้ — ใช้ยืนยันการแยกสโตร์ก่อนเขียน */
export function evidenceStoreFile(): string {
  return join(evidenceDataDir(), "operations.jsonl");
}

export function appendEvidence(evidence: OperationEvidence): void {
  const dir = evidenceDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "operations.jsonl"), JSON.stringify(evidence) + "\n", { encoding: "utf8" });
}

/** ค่าเริ่มต้นเท่านั้น — ไม่ใช่ path ที่ใช้จริงเมื่อมี override ให้ใช้ evidenceStoreFile() */
const EVIDENCE_PATH = join(process.cwd(), "control/runtime-control/data", "operations.jsonl");
export { EVIDENCE_PATH };
