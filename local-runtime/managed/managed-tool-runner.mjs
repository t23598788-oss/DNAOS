#!/usr/bin/env node
/**
 * DNA OS Managed Tool Runner (owner steps3/4,2026-09-26) — runs ONE tool
 * process inside the scope DNA OS can actually enforce on this machine.
 *
 * Mode = MANAGED-TOOL (NOT whole-machine): this runner certifies only the
 * process it spawns and its descendants. Programs launched any other way are
 * UNMANAGED (see scripts/access-path-survey-test.ts).
 *
 * Enforced here (evidence in scripts/tool-scope-test.ts):
 *  1. Executable allowlist (closed set in CODE — job payload cannot widen it).
 *  2. Workspace = realpath'd directory; ABSOLUTE path args must resolve inside
 *     it (declared-path + symlink escape check before spawn).
 *  3. Env scrub: child gets ONLY ENV_ALLOW — no SUPABASE/ADMIN/secret-shaped
 *     variables ever reach the tool (owner rule: no master credentials to AI).
 *  4. CPU limit via `ulimit -t` inside a FIXED sh wrapper (args positional —
 *     no shell interpolation) + spawnSync timeout SIGKILL backstop.
 *  5. On macOS with sandbox-exec: deny network* for the process tree (child
 *     shells inherit the sandbox).
 * KNOWN SCOPE GAPS (honest — NOT enforced on this macOS/Darwin27 build):
 *  - File reads OUTSIDE the workspace are NOT blocked in v1: full
 *    confinement profiles (deny-default + subpath allow) made every target
 *    abort/hang here (evidence: tmp/sb_conf_test.py → all exit -6).
 *    Do NOT label managed tools "PROTECTED" for filesystem scope yet.
 *  - Grandchildren may spawn further processes within the same sandbox;
 *    there is no per-descendant policy beyond the sandbox inheritance above.
 *
 * Usage:
 *   node managed-tool-runner.mjs run --workspace /abs/ws [--cpu-sec 30] -- <exe> [args...]
 *   node managed-tool-runner.mjs selftest
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Closed policy sets (changing these IS a policy change, not config) ──────
const ALLOWED_EXECUTABLES = ["node"];
const ENV_ALLOW = ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR"];
// Proven-working minimal profile (Darwin27): exec+fs OK, network* denied.
// Full file-confinement variants abort — see header KNOWN SCOPE GAPS.
const MIN_PROFILE = [
  "(version 1)",
  "(deny default)",
  "(allow file-read* file-write*)",
  "(allow process-exec process-fork)",
  "(allow mach-lookup sysctl-read)",
  "(allow ipc-posix* (target same-sandbox))",
  "(allow signal (target same-sandbox))",
  "(deny network*)",
  "",
].join("\n");

function usage(msg) {
  if (msg) console.error(msg);
  console.error('ใช้: node managed-tool-runner.mjs run --workspace <dir> [--cpu-sec N] -- <exe> [args...]');
  console.error('     node managed-tool-runner.mjs selftest');
  process.exit(2);
}

function resolveExe(exe) {
  // basename must be in the allowlist — whether given as bare name or absolute.
  const base = path.basename(exe);
  if (!ALLOWED_EXECUTABLES.includes(base)) return null;
  if (exe.includes(path.sep) || exe.startsWith("/")) {
    return path.resolve(exe); // absolute/nested must be the allowed binary itself
  }
  // bare name → resolve through PATH, then re-verify basename (PATH hijack-safe)
  const which = spawnSync(process.platform === "win32" ? "where" : "which", [exe], { encoding: "utf8" });
  if (which.status !== 0) return null;
  const found = (which.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean)[0];
  if (!found) return null;
  const resolved = path.resolve(found);
  if (path.basename(resolved) !== base) return null; // symlink trick re-check
  return resolved;
}

function realpathOrNull(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

/** Absolute path args must resolve (or their parent must) INSIDE the workspace. */
function pathArgInsideWorkspace(arg, wsReal) {
  if (!arg.startsWith("/")) return true; // flags, inline scripts, urls…
  let rp = realpathOrNull(arg);
  if (!rp) {
    const parent = realpathOrNull(path.dirname(arg));
    if (!parent) return false;
    rp = path.join(parent, path.basename(arg));
  }
  return rp === wsReal || rp.startsWith(wsReal + path.sep);
}

function scrubEnv() {
  const out = {};
  for (const key of ENV_ALLOW) {
    if (process.env[key] !== undefined) out[key] = process.env[key];
  }
  return out;
}

function sandboxAvailable() {
  return process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec");
}
function ensureProfile() {
  const p = path.join(os.tmpdir(), "dnaos-runner-min.sb");
  if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== MIN_PROFILE) fs.writeFileSync(p, MIN_PROFILE, { mode: 0o600 });
  return p;
}

function commandRun(argv) {
  const wsIdx = argv.indexOf("--workspace");
  const cpuIdx = argv.indexOf("--cpu-sec");
  const sepIdx = argv.indexOf("--");
  const cpuSec = cpuIdx >= 0 ? Math.max(1, Math.min(Number(argv[cpuIdx + 1]) || 30, 600)) : 30;
  const wsArg = wsIdx >= 0 ? argv[wsIdx + 1] : null;
  const toolArgv = sepIdx >= 0 ? argv.slice(sepIdx + 1) : [];
  if (!wsArg || toolArgv.length === 0) usage("ต้องระบุ --workspace และคำสั่งหลัง --");

  const wsReal = realpathOrNull(wsArg);
  if (!wsReal || !fs.statSync(wsReal).isDirectory()) {
    console.error(`workspace ไม่ถูกต้อง/ไม่ใช่ directory: ${wsArg}`);
    process.exit(3);
  }
  const exe = resolveExe(toolArgv[0]);
  if (!exe) {
    console.error(`executable ไม่อยู่ใน allowlist [${ALLOWED_EXECUTABLES.join(", ")}]: ${toolArgv[0]}`);
    process.exit(4);
  }
  for (const arg of toolArgv.slice(1)) {
    if (!pathArgInsideWorkspace(arg, wsReal)) {
      console.error(`path arg อยู่นอก workspace หรือ escape ผ่าน symlink: ${arg}`);
      process.exit(3);
    }
  }

  const env = scrubEnv();
  const inner = spawnSafe(exe, toolArgv.slice(1), wsReal, env, cpuSec);
  process.exit(inner);
}

function spawnSafe(exe, args, cwd, env, cpuSec) {
  // FIXED wrapper: ulimit is a shell BUILTIN, so sh is required — but the
  // script text is constant and every job arg arrives positionally ("$@"),
  // never interpolated (no injection surface).
  const wrapper = 'ulimit -t "$DNAOS_CPU_SEC" 2>/dev/null; exec "$@"';
  const shArgv = ["-c", wrapper, "dnaos-runner", exe, ...args];
  const timeoutMs = cpuSec * 1000 + 10_000;
  if (sandboxAvailable()) {
    const prof = ensureProfile();
    const r = spawnSync("/usr/bin/sandbox-exec", ["-f", prof, "/bin/sh", ...shArgv], {
      cwd,
      // DNAOS_CPU_SEC is a NUMERIC limit (not a credential) — added after the
      // scrub so the fixed wrapper's ulimit -t actually applies inside the
      // sandbox too (bugfix: previously missing → ulimit silently skipped).
      env: { ...env, DNAOS_CPU_SEC: String(cpuSec) },
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      stdio: "inherit",
    });
    return r.status ?? 1;
  }
  console.error("[runner] ไม่มี sandbox-exec บน OS นี้ — เครือข่ายไม่ถูกจำกัด (UNCONFINED-EGRESS) และไฟล์นอกระบบ scope ยังอ่านได้");
  const r = spawnSync("/bin/sh", shArgv, {
    cwd, env: { ...env, DNAOS_CPU_SEC: String(cpuSec) }, timeout: timeoutMs, killSignal: "SIGKILL", stdio: "inherit",
  });
  return r.status ?? 1;
}

function commandSelftest() {
  const ulimitProbe = spawnSync("/bin/sh", ["-c", 'ulimit -t 5 && echo ok'], { encoding: "utf8" });
  console.log(JSON.stringify({
    platform: process.platform,
    mode: "MANAGED-TOOL",
    whole_machine_control: "NOT_ENABLED",
    allowed_executables: ALLOWED_EXECUTABLES,
    env_allow: ENV_ALLOW,
    network_confined: sandboxAvailable() ? "sandbox-exec deny network* (proven: curl→000)" : "UNCONFINED (no sandbox-exec)",
    file_scope_confined: false,
    file_scope_gap: "v1 ยังอ่านไฟล์นอก workspace ได้บน macOS — confinement profile เต็ม abort/hang บน Darwin27 (หลักฐาน tmp/sb_conf_test.py) — ห้ามเรียกสถานะนี้ว่า PROTECTED",
    cpu_limit: ulimitProbe.status === 0 && (ulimitProbe.stdout || "").includes("ok") ? "ulimit -t available" : "ulimit -t UNAVAILABLE",
    workspace_arg_rule: "absolute path args must realpath inside --workspace",
  }, null, 2));
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "run") commandRun(rest);
else if (cmd === "selftest") commandSelftest();
else usage(cmd ? `คำสั่งไม่รู้จัก: ${cmd}` : undefined);

