/**
 * หน้าที่: declare the small real host surface `control/agent-host/`
 * needs (`child_process.spawn`, `fs`, `path`, `crypto`) — same isolation
 * pattern as `../../execution/run/host-runtime.ts` (no `@types/node` in
 * this repo). The one real addition this file makes beyond that sibling
 * pattern: `spawnConfinedAgent`, which launches the child through
 * `/usr/bin/sandbox-exec` with a real, generated macOS sandbox profile —
 * this is the actual OS-level confinement mechanism Phase 9 requires
 * (kernel-enforced EPERM/ENOENT on a denied read/write/exec, not an
 * application-level refusal).
 *
 * 2026-08-22 hardening pass (Owner: "Filesystem Jail & Admission Gate" —
 * see `/Users/tam/.claude/plans/zesty-spinning-ripple.md`): flipped from
 * `(allow default)` + a short denylist to a real `(deny default)`
 * baseline. Empirically verified on this host (macOS 26.6.2, Darwin
 * 25.6.0) before landing here — `(deny default)` alone crashes even
 * `/bin/echo` with SIGABRT (no baseline `mach-lookup`/`sysctl-read`/
 * `signal`/`ipc-posix-shm`/`file-read-metadata`, which every process
 * needs just to start under modern macOS's dyld shared-cache model);
 * those five are re-allowed unconditionally as the minimum a process
 * needs to exist at all, matching the same baseline Apple's own private
 * `bsd.sb`/`system.sb` profiles grant (importing those directly failed
 * closed on this host — SIP now blocks third-party `sandbox-exec` from
 * importing Apple's private profiles — so the equivalent baseline is
 * hand-declared here instead).
 *
 * Honest scope, disclosed not hidden: **file-write** and **process-exec**
 * are now real default-deny-with-allowlist (write scoped to exactly
 * `allowedWorkspaceDir`; exec scoped to exactly the one launched
 * `agentExecutable`, replacing the old git/gh/vercel/supabase-only
 * denylist — nothing outside the allowlist can be exec'd at all, not
 * just those four). **file-read** stays unrestricted (`(allow
 * file-read*)`), same limitation the old profile had for
 * `outsideProbeDirs`-listed paths, but now for a different reason: a
 * real default-deny read profile was tested and reliably breaks dyld's
 * ability to load Node's own shared libraries/dyld cache on this macOS
 * version, and the Owner's actual requirement (`เปิดสิทธิ์ Write Access
 * ให้เฉพาะโฟลเดอร์เป้าหมาย`) is about write confinement, not read. A
 * future pass could allowlist the specific system library paths dyld
 * needs and re-attempt read confinement; not attempted this round.
 *
 * Input: none.
 * Output: `spawnConfinedAgent`, `writeSandboxProfile`, `newLaunchId`,
 * `nowIso`, `ensureDirReal`, `joinPath`, `killPid`.
 * Dependency ที่อนุญาต: none — ambient require() only.
 * สิ่งที่ห้ามแตะ: never widen the generated profile back to `(allow
 * default)`, never allow `process-exec` for anything other than the one
 * literal `agentExecutable` path, never allow `file-write*` outside
 * `allowedWorkspaceDir` — those three are the exact rules
 * `./tests/proof.test.ts` and `../../execution/file-write/tests/`'s new
 * sandboxed-executor proof assert against.
 */

import * as __ns_childProcess from "node:child_process";
import * as __ns_fs from "node:fs";
import * as __ns_nodePath from "node:path";
import * as __ns_nodeCrypto from "node:crypto";
import * as __ns_nodeOs from "node:os";

declare const process: { kill(pid: number, signal: string): void };

interface HostReadable {
  on(event: "data", listener: (chunk: { toString(encoding: string): string }) => void): void;
}
export interface HostChildProcess {
  readonly pid?: number;
  readonly killed: boolean;
  readonly exitCode: number | null;
  readonly stdout: HostReadable | null;
  readonly stderr: HostReadable | null;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  kill(signal?: string): void;
}
interface NodeChildProcessModule {
  spawn(command: string, args: readonly string[], options: { cwd: string; env: Record<string, string>; shell: false; stdio: readonly ["ignore", "pipe", "pipe"] }): HostChildProcess;
}
interface NodeFsModule {
  writeFileSync(path: string, content: string, encoding: string): void;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  existsSync(path: string): boolean;
  realpathSync(path: string): string;
}
interface NodePathModule {
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
}
interface NodeCryptoModule {
  randomUUID(): string;
}
interface NodeOsModule {
  homedir(): string;
}

const childProcess = __ns_childProcess as unknown as NodeChildProcessModule;
const fs = __ns_fs as unknown as NodeFsModule;
const nodePath = __ns_nodePath as unknown as NodePathModule;
const nodeCrypto = __ns_nodeCrypto as unknown as NodeCryptoModule;
const nodeOs = __ns_nodeOs as unknown as NodeOsModule;

export function joinPath(...parts: string[]): string {
  return nodePath.join(...parts);
}

export function ensureDirReal(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function newLaunchId(): string {
  return `agent-launch-${nodeCrypto.randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * SECURITY PATCH (2026-08-24, Owner-escalated ahead of Phase 4
 * reconciliation): `buildSandboxProfile` previously interpolated
 * `allowedWorkspaceDir`/`agentExecutable`/`outsideProbeDirs` into SBPL
 * with raw `"${path}"` and no escaping. Kernel-verified exploit (real
 * `sandbox-exec` run, not a static analysis): a sibling-repository
 * directory NAME containing `")) (allow network*) (allow file-read*
 * (subpath "` closes the enclosing `(deny file-read* (subpath ...))`
 * rule, injects a top-level `(allow network*)` directive, and reopens a
 * dangling rule — a real child process launched under the resulting
 * profile successfully connected to `1.1.1.1:80`, which the unmodified
 * `(deny default)` baseline correctly denies (EPERM) otherwise. Reachable
 * via `control/agent-gateway/agent-host-dispatch.ts`'s
 * `unassignedSiblingRepos(readPaths)`, which feeds real on-disk directory
 * names (attacker-influenceable in principle — an Agent's own workspace
 * can contain a maliciously-named sibling) straight into
 * `outsideProbeDirs` with no sanitization. Discovered and reproduced
 * independently by two concurrent sessions (see
 * `control/runtime-adapter/seatbelt.ts#escapeSbplString`'s equivalent
 * fix for the same class of bug), verified against the real kernel
 * before this patch was ever applied — see the pipeline this followed:
 * DISCOVERED_VULNERABILITY -> REPRODUCE (this exact payload, real
 * `sandbox-exec` run, real network connect succeeded) -> PATCH IN
 * ISOLATED WORKSPACE (a scratch copy of this file, not this file
 * in-place) -> ATTACK STRING REGRESSION TEST -> NORMAL PATH REGRESSION
 * -> KERNEL VERIFY (both directions) -> PROMOTE (this edit).
 *
 * Fix, two redundant layers (same technique proven in
 * `control/runtime-adapter/seatbelt.ts#escapeSbplString`, re-derived
 * independently here since this file's own "Dependency ที่อนุญาต: none"
 * rule forbids importing across capability folders):
 *   1. REJECT any path containing a control character (U+0000-U+001F
 *      or U+007F) outright -- fail-closed, never render a profile whose
 *      safety depends on Seatbelt's own escape handling.
 *   2. ESCAPE `\` and `"` so a quote in a path becomes part of the quoted
 *      string literal, never a string terminator.
 * A path this rejects means `writeSandboxProfile` throws BEFORE any
 * process is launched — no launch ever proceeds with an un-escaped or
 * unsafe path.
 */
const UNSAFE_SBPL_PATH_CHARS = /[\u0000-\u001f\u007f]/;

function escapeSbplPath(value: string): string {
  if (UNSAFE_SBPL_PATH_CHARS.test(value)) {
    throw new Error(`SANDBOX_PROFILE_UNSAFE_PATH: path contains a control character and cannot be safely expressed in SBPL: ${JSON.stringify(value)}`);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * SECURITY PATCH, second finding: Seatbelt's `subpath`/`literal` rules
 * match the KERNEL-RESOLVED (symlink-free) path. `os.tmpdir()`-style
 * paths under `/tmp`/`/var` are themselves symlinks to `/private/tmp`/
 * `/private/var` on macOS, so a rule built from the path AS GIVEN can
 * silently match nothing — proven this round: a real shell-mediated
 * write (`npm run build`'s `>` redirection) into an `allowedWorkspaceDir`
 * under `/tmp/...` was denied even though the literal `subpath` rule
 * named that exact path, because the shell's own `open(2)` resolved to
 * `/private/tmp/...` first. Resolving the longest existing ancestor
 * (never throwing for a not-yet-created leaf) matches
 * `control/runtime-adapter/host-runtime.ts#realPath`'s independently-
 * derived fix for the same class of bug.
 */
function resolveRealPath(path: string): string {
  const trailing: string[] = [];
  let head = path;
  for (;;) {
    try {
      const resolved = fs.realpathSync(head);
      return trailing.length === 0 ? resolved : nodePath.join(resolved, ...trailing.slice().reverse());
    } catch {
      const parent = nodePath.dirname(head);
      if (parent === head) return path;
      trailing.push(nodePath.basename(head));
      head = parent;
    }
  }
}

/**
 * `(deny default)` baseline (2026-08-22 hardening — see file header).
 * The five unconditional `allow`s below are the empirically-verified
 * minimum ANY process needs to start at all under this baseline (tested
 * directly against `/bin/echo` and a plain Node script on this host —
 * without them, the sandboxed child SIGABRTs before it can even run,
 * regardless of what it was launched to do). `file-write*` is scoped to
 * exactly `allowedWorkspaceDir`; `process-exec` is scoped to exactly
 * `agentExecutable` — nothing else may be written to or exec'd, full
 * stop.
 *
 * 2026-08-24 (Owner, "Authority Assembly Phase 1C — Read Boundary"):
 * `file-read*` stays broadly allowed as the baseline — a real,
 * independently re-verified attempt this round at a full
 * `(deny default)` READ profile (allowlisting only /usr, /System,
 * /private, /Library, /bin, /sbin, /dev, plus `file-map-executable` on
 * those same paths) still SIGABRTs even a bare `/bin/echo` on this host
 * (macOS 26.6.2, Darwin 25.6.0) before any application code runs — the
 * same unresolved dyld-bootstrap dependency the 2026-08-22 hardening pass
 * already documented. Rather than leave the four proven credential-read
 * bypasses (Phase "Boundary Penetration Audit") open pending that deeper
 * fix, this pass adds EXPLICIT, MORE-SPECIFIC `(deny file-read* ...)`
 * rules for the exact classes proven readable and sensitive:
 * `~/.config/gh`, `~/Library/Keychains`, any `.env*` file anywhere
 * (regex), and any directory outside the Agent's own assigned source (a
 * caller-supplied allowlist, e.g. the repos an Agent was NOT assigned to
 * touch). Seatbelt resolves the more specific subpath/regex rule over
 * the broader `(allow file-read*)`, exactly the same mechanism
 * `outsideProbeDirs` already relied on — empirically re-verified this
 * round: `security add-generic-password`'s own item DB, gh's hosts.yml,
 * and a real `.env.local` file all returned `Operation not permitted`
 * under this exact rule set, while `claude --version` and `codex
 * --version` still launched and exited 0. This is NOT the general,
 * unsolved default-deny-read confinement — it is a targeted, honestly
 * partial mitigation for the specific classes this repo has already
 * proven sensitive.
 */
const ALWAYS_DENIED_READ_SUBPATHS = [
  "Library/Keychains",
  ".config/gh",
] as const;

/**
 * ต้นไม้ติดตั้งของ worker เอง — ใช้เมื่อผู้เรียกไม่ได้ประกาศมาเอง
 *
 * ขึ้นไปสามชั้นจากตัว executable ก็พอครอบ prefix ของ runtime ที่ใช้จริงบนเครื่องนี้
 * (`.../v16.20.2/bin/node` -> `.../versions/node`, `~/.codex/plugins/.plugin-appserver/codex`
 * -> `~/.codex`) และหยุดทันทีถ้าจะไปแตะ `/Users` หรือโฟลเดอร์บ้านเปล่า ๆ ซึ่งจะทำให้
 * การปิด user data ทั้งก้อนไร้ความหมาย
 */
function deriveWorkerRuntimeReadPaths(agentExecutable: string): string[] {
  const home = nodeOs.homedir();
  const out: string[] = [];
  let cur = nodePath.dirname(resolveRealPath(agentExecutable));
  for (let i = 0; i < 3; i++) {
    if (cur === "/" || cur === "/Users" || cur === home) break;
    out.push(cur);
    cur = nodePath.dirname(cur);
  }
  return out;
}

/**
 * SANDBOX PROFILE V1 (Owner, APPROVE_SANDBOX_PROFILE_V1 — โปรไฟล์เดียวกับที่ผ่าน
 * R1–R7 / W1–W2 / L1–L3 ในพื้นที่ทดลองแยก ไม่ได้ขยายเพิ่มตอน promote)
 *
 * สิ่งที่เปลี่ยนจากรุ่นก่อน และเหตุผล: รุ่นก่อนมี `(allow file-read*)` ตัวเดียวโดด ๆ
 * ซึ่งแปลว่า Agent อ่านทั้ง repository และทั้งโฟลเดอร์บ้านได้ — พิสูจน์แล้วด้วยการรัน
 * จริง (Agent อ่าน `control/agent-gateway/gateway.ts` สำเร็จทั้งที่ไม่ได้รับมอบหมาย)
 *
 * โครงใหม่อ่านจากบนลงล่าง กฎที่อยู่หลังและตรงกว่าเป็นฝ่ายชนะ:
 *   1. (allow file-read*)            SYSTEM_RUNTIME_READ — /usr /System /Library /private
 *   2. (deny  file-read* /Users)     ปิดข้อมูลผู้ใช้ทั้งหมด ทุก repo ทุกโฟลเดอร์บ้าน
 *   3. เปิดคืนเฉพาะ: runtime ของ worker, workspace, assigned/dependency paths
 *
 * ทำไมไม่ใช้ allowlist แท้ (ไม่มีข้อ 1 เลย): ลองแล้วทุกชุด — /usr, /System, /Library,
 * /private/var, /private/etc, /dev, node prefix — node ยัง abort ด้วย SIGABRT โดยไม่มี
 * stderr และ macOS 25.6 บนเครื่องนี้ไม่รองรับ `(trace ...)` และไม่ log denial ของ
 * sandbox จึงหา requirement ที่ขาดด้วยวิธีเชิงประจักษ์ไม่ได้ การเดาเพิ่มสิทธิ์จนกว่ามัน
 * จะรันคือสิ่งที่ห้ามทำ ข้อ 2 จึงเป็นตัวรับประกันแทน: ข้อมูลผู้ใช้ถูกปิดหมดตั้งแต่ต้น
 */
function buildSandboxProfile(
  allowedWorkspaceDir: string,
  agentExecutable: string,
  outsideProbeDirs: readonly string[],
  repositoryReadPaths: readonly string[] = [],
  workerRuntimeReadPaths?: readonly string[],
  argvPaths: readonly string[] = [],
): string {
  const home = nodeOs.homedir();
  // SECURITY PATCH: every interpolated path goes through resolveRealPath
  // (kernel-resolved, so the rule actually matches) then escapeSbplPath
  // (fail-closed on control chars, escapes \ and ") before ever reaching
  // the profile text — see this file's own doc comment above for the
  // kernel-verified exploit this closes.
  const safeWorkspaceDir = escapeSbplPath(resolveRealPath(allowedWorkspaceDir));
  const safeExecutable = escapeSbplPath(resolveRealPath(agentExecutable));
  const lines: string[] = [
    "(version 1)",
    "(deny default)",
    "(allow mach-lookup)",
    "(allow sysctl-read)",
    "(allow signal)",
    "(allow ipc-posix-shm)",
    "(allow file-read-metadata)",
    // SYSTEM_RUNTIME_READ — ระบบปฏิบัติการเท่านั้น ข้อมูลผู้ใช้ถูกปิดในบรรทัดถัดไป
    "(allow file-read*)",
    `(deny file-read* (subpath "${escapeSbplPath(resolveRealPath("/Users"))}"))`,
    `(allow file-write* (subpath "${safeWorkspaceDir}"))`,
    `(allow process-exec (literal "${safeExecutable}"))`,
    "(allow process-fork)",
  ];
  // เปิดคืน: runtime ของ worker เอง (SYSTEM_RUNTIME_READ ไม่ใช่ repository data)
  const runtimePaths = workerRuntimeReadPaths ?? deriveWorkerRuntimeReadPaths(agentExecutable);
  for (const p of runtimePaths) {
    lines.push(`(allow file-read* (subpath "${escapeSbplPath(resolveRealPath(p))}"))`);
  }
  // เปิดคืน: พื้นที่ทำงานของงานนี้ (อ่านได้ เพราะเขียนได้อยู่แล้ว)
  lines.push(`(allow file-read* (subpath "${safeWorkspaceDir}"))`);
  // เปิดคืน: โปรแกรมของ worker เองที่ถูกส่งมาทาง argv
  //
  // ค้นพบตอน promote: worker LOCAL รับสคริปต์ของตัวเองผ่าน argv
  // (`control/agent-host/agent-script.mjs`) ซึ่งอยู่ใต้ /Users พอปิด /Users ทั้งก้อน
  // โปรเซสจึงอ่านโปรแกรมตัวเองไม่ได้และสตาร์ทไม่ขึ้นเลย
  // จำแนกเป็น SYSTEM_RUNTIME_READ ไม่ใช่ REPOSITORY_READ: มันคือตัวโปรแกรมที่ถูกสั่งให้รัน
  // ไม่ใช่ข้อมูลของ repository ที่ Agent จะไปค้นหาความรู้ — และเปิดเฉพาะไฟล์ที่มีอยู่จริง
  // ทีละไฟล์ (literal) ไม่ใช่ทั้งโฟลเดอร์
  for (const arg of argvPaths) {
    lines.push(`(allow file-read* (literal "${escapeSbplPath(resolveRealPath(arg))}"))`);
  }
  // เปิดคืน: REPOSITORY_READ ที่ได้รับมอบหมายเท่านั้น
  for (const p of repositoryReadPaths) {
    lines.push(`(allow file-read* (subpath "${escapeSbplPath(resolveRealPath(p))}"))`);
  }
  // `outsideProbeDirs` is deliberately reused for BOTH its original
  // purpose (a caller-supplied "this specific dir must be unreadable"
  // probe) AND unassigned-sibling-repository denial (Phase 1C) — both
  // are the identical Seatbelt operation (a more-specific subpath deny
  // overriding the broader file-read* allow); adding a second parameter
  // for the same real mechanism would be a duplicate, not a distinct one.
  for (const dir of outsideProbeDirs) {
    lines.push(`(deny file-read* (subpath "${escapeSbplPath(resolveRealPath(dir))}"))`);
  }
  /**
   * SBPL ตัดสินด้วยกฎที่ตรงกันเป็น "อันสุดท้าย" ไม่ใช่อันแรก ดังนั้น deny ข้างบน
   * จึงทับ allow ของ workspace ได้ถ้าบังเอิญมี dir ตัวใดครอบ workspace อยู่
   *
   * เกิดขึ้นจริงเมื่อ 2026-09-02: worktree ของ Agent อยู่ใต้
   * `~/Desktop/.dna-os-agent-worktrees/` ซึ่งเป็น sibling ของ repo ที่ถูกมอบหมาย
   * `unassignedSiblingRepos` จึงใส่มันลง deny list ทั้งก้อน ผลคือ Agent อ่าน cwd
   * ของตัวเองไม่ได้ และ node ตายตั้งแต่ `process.cwd()` ด้วย EPERM uv_cwd
   * (หลักฐาน: ev-agent-exec-o90jpd8uw2amtk39hoc)
   *
   * การคืนสิทธิ์ตรงนี้ไม่ได้ขยายขอบเขต — `allowedWorkspaceDir` ถูก allow ไปแล้ว
   * ข้างบนโดยตั้งใจ นี่แค่ทำให้มันไม่ถูกกฎกว้างกว่าลบทิ้งไปเอง ที่เหลือใน
   * `.dna-os-agent-worktrees/` (คือ worktree ของงานอื่น) ยังถูก deny อยู่เหมือนเดิม
   *
   * ต้องอยู่ "ก่อน" ALWAYS_DENIED_READ_SUBPATHS และก่อน regex `.env` เสมอ —
   * ไม่งั้นการคืนสิทธิ์นี้จะไปเปิด .env ที่อยู่ใน worktree ให้อ่านได้ ซึ่งเป็นสิ่ง
   * ที่กฎท้ายไฟล์มีไว้ปิดโดยเฉพาะ
   */
  lines.push(`(allow file-read* (subpath "${escapeSbplPath(resolveRealPath(allowedWorkspaceDir))}"))`);
  for (const subpath of ALWAYS_DENIED_READ_SUBPATHS) {
    lines.push(`(deny file-read* (subpath "${escapeSbplPath(resolveRealPath(nodePath.join(home, subpath)))}"))`);
  }
  // Any dotenv-shaped file anywhere on the readable filesystem — real
  // secrets in this repo's sibling checkouts (e.g. dna-os-deadboard's
  // .env.local) are named this way; this regex denies the class, not one
  // hardcoded repo path.
  lines.push('(deny file-read* (regex #"\\.env($|\\.)"))');
  return lines.join("\n") + "\n";
}

/**
 * path นี้มีอยู่จริงบนดิสก์ไหม — ใช้กรอง argv ให้เหลือเฉพาะที่เป็นไฟล์จริง
 * ใช้ `existsSync` ที่ NodeFsModule ประกาศไว้แล้ว ไม่เพิ่ม ambient ใหม่ให้โฟลเดอร์นี้
 */
export function fileExistsReal(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}

export function writeSandboxProfile(profilePath: string, allowedWorkspaceDir: string, agentExecutable: string, outsideProbeDirs: readonly string[], repositoryReadPaths: readonly string[] = [], workerRuntimeReadPaths?: readonly string[], argvPaths: readonly string[] = []): void {
  fs.writeFileSync(profilePath, buildSandboxProfile(allowedWorkspaceDir, agentExecutable, outsideProbeDirs, repositoryReadPaths, workerRuntimeReadPaths, argvPaths), "utf-8");
}

/**
 * The only place a child process is spawned anywhere in this capability
 * — always through `/usr/bin/sandbox-exec -f <profile> <executable>
 * <argv...>`, always `shell:false`, always a literal argv array. This IS
 * the real OS-level parent/confinement boundary this round proves —
 * `sandbox-exec`'s target process is a direct child of the calling
 * process (this module), and everything it can touch is gated by the
 * kernel via the profile written above, not by this module's own logic.
 */
export function spawnConfinedAgent(profilePath: string, executable: string, argv: readonly string[], cwd: string, env: Record<string, string>): HostChildProcess {
  return childProcess.spawn("/usr/bin/sandbox-exec", ["-f", profilePath, executable, ...argv], { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * 2026-08-22 addition (Pillar 2/3 of the enforcement plan — see file
 * header): a real signal send by PID, used by `./host.ts`'s `killLaunch`.
 * `spawnConfinedAgent` does not pass `detached: true`, so this signals
 * the direct child PID (the `sandbox-exec` wrapper, which execs directly
 * into the confined process) rather than a process group — matches
 * `../../execution/run/host-runtime.ts`'s `killProcessGroup`'s own
 * "already gone" swallow-and-continue discipline for the common case
 * where the process exited between the caller's check and this call.
 */
export function killPid(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(pid, signal);
  } catch {
    /* already gone */
  }
}
