/**
 * หน้าที่: the private real-host surface for `control/runtime-adapter/` —
 * filesystem, spawn, clock, and identity. Same isolation discipline as
 * `../agent-host/host-runtime.ts` and `../../execution/run/host-runtime.ts`:
 * every real side effect this capability performs is declared here and
 * nowhere else, so `./seatbelt.ts` and `./pty.ts` stay pure enough to
 * test by inspection.
 *
 * Input: none.
 * Output: `homeDir`, `joinPath`, `ensureDir`, `writeTextFile`,
 * `newSessionId`, `nowIso`, `spawnConfined`, `killPid`, `PTY_HELPER_PATH`,
 * `SANDBOX_EXEC_PATH`, `PYTHON3_PATH`.
 * Dependency ที่อนุญาต: node:fs, node:path, node:os, node:crypto,
 * node:child_process, node:url.
 * สิ่งที่ห้ามแตะ: never add a spawn variant that takes a shell string or
 * sets `shell: true` — every exec in this capability is a literal argv
 * array. Never spawn anything except through `/usr/bin/sandbox-exec`:
 * an unconfined spawn here would silently defeat the entire boundary
 * this folder exists to provide.
 */

import { mkdirSync, writeFileSync, realpathSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

/** Apple's sandbox binary. Absolute and literal — never PATH-resolved. */
export const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

/**
 * The OS-provided Python 3. Present on macOS without any install
 * (verified: 3.9.6 at this path on this host). Used ONLY to run
 * `./pty-helper.py` — see ./pty.ts for why a helper executable is the
 * mechanism rather than a native addon.
 */
export const PYTHON3_PATH = "/usr/bin/python3";

/**
 * `/usr/bin/python3` is a STUB, not the interpreter: it re-execs the real
 * binary (on this host `/Library/Developer/CommandLineTools/usr/bin/python3`,
 * itself a symlink into Python3.framework). Seatbelt matches the resolved
 * path of whatever is actually exec'd, so allowing only the stub makes the
 * launch die with `can't exec ... (errno=Operation not permitted)` — found
 * empirically by ./tests/pty-stream.test.ts, which failed exactly that way
 * before this existed.
 *
 * These are candidate LOCATIONS, filtered by real existence at call time
 * and symlink-resolved later by ./seatbelt.ts. Nothing is assumed present.
 */
const PYTHON3_REEXEC_CANDIDATES = [
  "/Library/Developer/CommandLineTools/usr/bin/python3",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/python3",
] as const;

/** The stub plus every real interpreter it may re-exec into that actually exists on this host. */
export function python3ExecLiterals(): readonly string[] {
  return [PYTHON3_PATH, ...PYTHON3_REEXEC_CANDIDATES.filter((path) => existsSync(path))];
}

/**
 * The interpreter stub re-execs through MORE than one hop — the CLT
 * symlink then `Python3.framework/.../Python.app/Contents/MacOS/Python`.
 * Enumerating every hop as a literal is brittle across OS updates, so the
 * framework tree is granted as a single scoped subpath instead. Disclosed
 * widening: any binary inside these trees may be exec'd by a PTY session.
 */
const PYTHON3_FRAMEWORK_CANDIDATES = [
  "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework",
  "/Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework",
] as const;

export function python3ExecSubpaths(): readonly string[] {
  return PYTHON3_FRAMEWORK_CANDIDATES.filter((path) => existsSync(path));
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/** The registered PTY helper executable that ships with this capability. */
export const PTY_HELPER_PATH = join(__dirname, "pty-helper.py");

export function homeDir(): string {
  return homedir();
}

export function joinPath(...parts: string[]): string {
  return join(...parts);
}

/**
 * Resolve every symlink in `path` so the emitted rule matches what the
 * KERNEL sees. This is not cosmetic: on macOS `os.tmpdir()` returns
 * `/var/folders/...`, which is a symlink to `/private/var/folders/...`,
 * and Seatbelt matches the resolved path. A `(subpath "/var/...")` rule
 * therefore matches NOTHING — the confinement silently fails closed and
 * the workspace the caller asked to be writable is not. Proven by
 * ./tests/adversarial-seatbelt.test.ts case B2, which failed exactly
 * this way before this function existed.
 *
 * A path that does not exist yet still has to be expressible, so this
 * resolves the longest existing ancestor and re-appends the remainder
 * rather than throwing.
 */
export function realPath(path: string): string {
  const trailing: string[] = [];
  let head = path;
  for (;;) {
    try {
      const resolved = realpathSync(head);
      return trailing.length === 0 ? resolved : join(resolved, ...trailing.slice().reverse());
    } catch {
      const parent = dirname(head);
      // Reached the filesystem root without resolving anything — hand
      // back the original rather than inventing a path.
      if (parent === head) return path;
      trailing.push(basename(head));
      head = parent;
    }
  }
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function writeTextFile(path: string, content: string): void {
  writeFileSync(path, content, "utf-8");
}

export function newSessionId(): string {
  return `rt-session-${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The ONLY spawn in this capability, and always through sandbox-exec
 * with a profile file. `shell: false`, literal argv, and stdin closed —
 * matching `../agent-host/host-runtime.ts`'s `spawnConfinedAgent`
 * exactly, so the two launch paths cannot drift apart in confinement
 * semantics.
 */
export function spawnConfined(
  profilePath: string,
  executable: string,
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
): ChildProcessByStdio<null, Readable, Readable> {
  return spawn(SANDBOX_EXEC_PATH, ["-f", profilePath, executable, ...argv], {
    cwd,
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function killPid(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(pid, signal);
  } catch {
    /* already gone */
  }
}
