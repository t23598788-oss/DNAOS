/**
 * หน้าที่: `runClaudeCodeLocally()` — ทางเดียวที่ DNA OS เรียก Claude Code ที่
 * ติดตั้งและล็อกอินอยู่บนเครื่องนี้ โดยใช้การยืนยันตัวตนของเครื่องเอง ไม่ใช่
 * API key (Owner, IMPLEMENT_LOCAL_CLAUDE_CODE_TRUSTED_EXECUTION_BOUNDARY).
 *
 * สามอย่างที่ทำให้เส้นนี้ทำงาน — พิสูจน์ทีละตัวแปรด้วยการรันจริงก่อนเขียนไฟล์นี้:
 *   1. `USER` ต้องอยู่ใน environment  (ไล่ทีละตัว มีตัวนี้ตัวเดียวที่พลิกผล)
 *   2. ห้ามมี `--bare`               (env เดียวกัน ต่างแค่ธงนี้ ผล 0 กับ 1)
 *   3. sandbox ต้องเปิด exec `security` และอ่าน Keychains "พร้อมกัน"
 *      (เปิดข้างเดียวได้ crash กับ "Not logged in" ตามลำดับ)
 * `--no-session-persistence` ไม่ใช่สาเหตุ วัดแล้วยังผ่าน จึงคงไว้
 *
 * ทำไมต้องเป็นไฟล์แยก ไม่ใช่เติมสิทธิ์ให้ agent-host: สิทธิ์ที่เพิ่มขึ้น
 * (exec security + อ่าน Keychain) ต้องผูกกับ "โปรแกรมตัวเดียวที่รู้จัก" ไม่ใช่
 * กับ "Agent ตัวไหนก็ได้" ถ้าเติมลงกรงทั่วไป Agent ทุกตัวจะได้สิทธิ์นั้นไปด้วย
 * ซึ่งเป็นสิ่งเดียวที่ห้ามเกิด — Agent ทั่วไปยังต้องอ่าน Keychain ไม่ได้
 *
 * ทำไมมันไม่ใช่ "ตัวรันคำสั่งที่มีสิทธิ์พิเศษแบบทั่วไป": executable มาจาก
 * `resolveWorker("CLAUDE")` ของ agent-host, argv ประกอบขึ้นที่นี่ทั้งชุด,
 * environment เป็นรายชื่อคงที่ 4 ตัว, โปรไฟล์ประกอบจาก ./profile.ts
 * ผู้เรียกส่งเข้ามาได้อย่างเดียวคือ "ข้อความงาน" กับ "โฟลเดอร์ที่อนุมัติแล้ว"
 * และ `/usr/bin/security` ที่โปรไฟล์เปิดไว้ เปิดให้ "Claude" เรียก ไม่ได้เปิด
 * ให้ผู้เรียกสั่ง — ไม่มีทางใดในไฟล์นี้ที่ argv ของผู้เรียกจะกลายเป็นคำสั่งของมัน
 *
 * Input: `ClaudeBoundaryRequest`.
 * Output: `runClaudeCodeLocally` -> `ClaudeBoundaryResult`.
 * Dependency ที่อนุญาต: ./profile.ts, ./types.ts, ../agent-host/contract.ts,
 * node:child_process, node:crypto, node:fs, node:os, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามรับ executable/argv/env/profile/credential จากผู้เรียก,
 * ห้ามใส่ `--bare` กลับเข้ามา, ห้าม fallback ไปโหมด API key เมื่อ auth ล้มเหลว,
 * ห้ามบันทึกหรือคืนค่าใด ๆ ที่มาจาก Keychain.
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorker } from "../agent-host/contract";
import { buildClaudeProfile } from "./profile";
import type { ClaudeBoundaryRequest, ClaudeBoundaryResult, ClaudeBoundaryStatus } from "./types";

/**
 * โมดูลที่เรียกขอบเขตนี้ได้จริง — เป็นการตรวจทางเทคนิค ไม่ใช่คอมเมนต์
 * เพิ่มชื่อลงที่นี่ = การตัดสินใจเรื่องความไว้วางใจ ต้องเห็นใน diff เสมอ
 */
const ALLOWED_CALLERS = [
  "control/agent-gateway/agent-host-dispatch.ts",
  "control/claude-execution-boundary/tests/boundary.test.ts",
] as const;

/**
 * argv ของ Claude ทั้งชุด ประกอบที่นี่ที่เดียว
 *
 * `--bare` ถูกถอดออกโดยเจตนา: คอมเมนต์เดิมของมันเองบอกว่า "OAuth and keychain
 * are never read" ซึ่งคือสาเหตุตรง ๆ ของ "Not logged in" เหตุผลที่เคยต้องใส่มัน
 * (Claude crash เพราะ exec `security` ไม่ได้) ถูกแก้ที่ต้นเหตุแล้วใน ./profile.ts
 */
const FIXED_ARGV = [
  "-p",
  "--output-format", "stream-json",
  "--verbose",
  "--permission-mode", "plan",
  "--no-session-persistence",
] as const;

/** ชื่อ env ที่ส่งเข้าไป — คงที่ ไม่ส่งต่อ environment ของ shell เจ้าของทั้งก้อน */
const ENV_NAMES = ["PATH", "TMPDIR", "HOME", "USER"] as const;

const nowIso = (): string => new Date().toISOString();

function fail(status: ClaudeBoundaryStatus, reason: string, launchId: string): ClaudeBoundaryResult {
  return {
    status, launch_id: launchId, text: null, messages: [], exit_code: null,
    authenticated: false, api_key_source: null, env_names: [...ENV_NAMES],
    sanitized_argv: [...FIXED_ARGV], executable: "(unresolved)",
    sandbox_profile_hash: null, reason,
    stdout: "", stderr: "", pid: null, started_at: nowIso(), ended_at: nowIso(),
  };
}

/**
 * ดึงสิ่งที่ Claude พูดออกจาก stream-json ที่มันปล่อยอยู่แล้ว
 * อ่านเฉพาะสองรูปที่มันปล่อยจริง ไม่เดา ไม่แต่งข้อความแทน
 */
function readStream(stdout: string): { messages: string[]; result: string | null; apiKeySource: string | null } {
  const messages: string[] = [];
  let result: string | null = null;
  let apiKeySource: string | null = null;
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    let node: unknown;
    try { node = JSON.parse(line); } catch { continue; }
    if (!node || typeof node !== "object") continue;
    const o = node as { type?: unknown; subtype?: unknown; result?: unknown; apiKeySource?: unknown; message?: { content?: unknown } };
    if (o.type === "system" && o.subtype === "init" && typeof o.apiKeySource === "string") apiKeySource = o.apiKeySource;
    const content = o.message?.content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string") {
          const t = (c as { text: string }).text.trim();
          if (t !== "") messages.push(t);
        }
      }
    }
    if (o.type === "result" && typeof o.result === "string") result = o.result;
  }
  return { messages, result, apiKeySource };
}

export async function runClaudeCodeLocally(request: ClaudeBoundaryRequest): Promise<ClaudeBoundaryResult> {
  const launchId = `claude-boundary-${randomUUID()}`;

  if (!ALLOWED_CALLERS.includes(request.caller as (typeof ALLOWED_CALLERS)[number])) {
    return fail("CALLER_NOT_ALLOWED", `caller "${request.caller}" is not an authorized caller of the Claude execution boundary`, launchId);
  }
  if (request.provider !== "CLAUDE_CODE") return fail("INVALID_REQUEST", `provider must be "CLAUDE_CODE", got "${String(request.provider)}"`, launchId);
  if (request.execution_mode !== "LOCAL_MACHINE_AUTH") return fail("INVALID_REQUEST", `execution_mode must be "LOCAL_MACHINE_AUTH"`, launchId);
  if (typeof request.objective !== "string" || request.objective.trim() === "") return fail("INVALID_REQUEST", "objective is required", launchId);
  if (!request.workspace.startsWith("/") || !existsSync(request.workspace)) {
    return fail("INVALID_REQUEST", `workspace must be a real absolute directory, got "${request.workspace}"`, launchId);
  }

  // executable มาจากทะเบียน worker ของ agent-host — ผู้เรียกไม่มีทางกำหนดเอง
  const worker = resolveWorker("CLAUDE");
  if (!worker.ok) return fail("EXECUTABLE_UNAVAILABLE", worker.detail, launchId);
  const executable = worker.worker.executable;

  const profileDir = join(tmpdir(), "dna-os-claude-boundary");
  mkdirSync(profileDir, { recursive: true });
  const profile = buildClaudeProfile({ workspace: request.workspace, executable });
  const profilePath = join(profileDir, `${launchId}.sb`);
  writeFileSync(profilePath, profile, { encoding: "utf8", mode: 0o600 });
  const profileHash = createHash("sha256").update(profile).digest("hex");

  const hostEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const env: Record<string, string> = {};
  for (const name of ENV_NAMES) {
    const value = hostEnv[name];
    if (value !== undefined) env[name] = value;
  }

  const argv = [...FIXED_ARGV, "--", request.objective];
  const timeoutMs = request.timeout_ms ?? 120_000;

  const startedAt = nowIso();
  let childPid: number | null = null;
  const run = await new Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }>((resolve) => {
    const child = spawn("/usr/bin/sandbox-exec", ["-f", profilePath, executable, ...argv],
      { cwd: request.workspace, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    childPid = child.pid ?? null;
    let stdout = "", stderr = "", timedOut = false, settled = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    const done = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    };
    child.stdout?.on("data", (c: Buffer) => { stdout += c.toString("utf8"); });
    child.stderr?.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
    child.on("error", (e: Error) => { stderr += `\n[claude-boundary] spawn error: ${e.message}`; done(null); });
    child.on("exit", (code: number | null) => { done(code); });
  });

  const { messages, result, apiKeySource } = readStream(run.stdout);
  const notLoggedIn = run.stdout.includes("Not logged in") || messages.some((m) => m.includes("Not logged in"));

  const base = {
    launch_id: launchId,
    messages,
    exit_code: run.code,
    api_key_source: apiKeySource,
    env_names: [...ENV_NAMES],
    // objective ไม่อยู่ใน argv ที่บันทึก — หลักฐานสิทธิ์ไม่ควรมีเนื้องานปน
    sanitized_argv: [...FIXED_ARGV, "--", "<objective>"],
    executable,
    sandbox_profile_hash: profileHash,
    stdout: run.stdout, stderr: run.stderr, pid: childPid,
    started_at: startedAt, ended_at: nowIso(),
  };

  /**
   * ปิดตายเมื่อยืนยันตัวตนไม่ได้ — ไม่มีเส้นทางใดในไฟล์นี้ที่พาไปโหมด API key
   * การสลับโหมดที่มีผลต่อค่าใช้จ่ายเป็นการตัดสินใจของเจ้าของ ไม่ใช่ของ fallback
   */
  if (notLoggedIn) {
    return { ...base, status: "AUTH_UNAVAILABLE", text: null, authenticated: false,
      reason: "Claude Code reported it is not logged in on this machine — machine authentication is unavailable; this boundary never falls back to an API key" };
  }
  if (run.timedOut) return { ...base, status: "TIMED_OUT", text: null, authenticated: false, reason: `no result within ${timeoutMs} ms` };
  if (run.code !== 0) {
    return { ...base, status: "FAILED", text: null, authenticated: false,
      reason: `claude exited ${String(run.code)}${run.stderr.trim() ? `: ${run.stderr.trim().split("\n")[0]!.slice(0, 200)}` : ""}` };
  }

  return { ...base, status: "COMPLETED", text: result ?? messages.at(-1) ?? null, authenticated: true, reason: null };
}
