/**
 * หน้าที่: declare the exact host-runtime APIs `execution/run/` needs
 * (`child_process.spawn`/`execFileSync`, `crypto.randomUUID`/`createHash`,
 * `process.env`/`process.cwd`/`process.kill`, `console`) so this
 * capability type-checks as SELF-CONTAINED — this repo has no
 * `package.json` and no `@types/node` installed, so Node's built-in
 * modules are not typed by default. Same pattern as
 * `../../connections/github/host-runtime.ts`: declare the small surface
 * this capability actually uses, module-scoped, so Capability Folder Law
 * ข้อ 7 stays true without adding a repo-wide dependency this round did
 * not decide to add.
 *
 * Input: none (pure host-boundary declarations + thin wrappers).
 * Output: `spawnProcess`, `captureCommandOutputSync`, `newExecutionId`,
 * `sha256Hasher`, `readEnvVar`, `currentWorkingDirectory`,
 * `killProcessGroup`, `nowIso`, `hostLog`, `hostError`, `HostChildProcess`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never widen the declared `spawn` options beyond what
 * `executor.ts` actually needs — in particular never add a `shell` option
 * default other than `false`, and never accept a caller-supplied
 * executable string that bypasses `./registry.ts`'s allowlist. Never log a
 * raw environment value through `hostLog`/`hostError`.
 */

/**
 * There is no `@types/node` in this repo, and — unlike `../../connections/
 * github/host-runtime.ts`'s `fetch`/`crypto.randomUUID` — Node's
 * `child_process` module has no equivalent global; it only exists as a
 * module export. `declare module "child_process" { ... }` (with or
 * without a `node:` prefix) does not work here either: TypeScript
 * special-cases Node's core module names and reports "module cannot be
 * found" / "did you mean to install @types/node" instead of treating the
 * declaration as a fresh ambient module. The one construct that reliably
 * works without `@types/node` is a plain ambient `require()`, which `tsx`
 * (this repo's real runtime — see ./tests/executor.test.ts's header)
 * supports inside an ESM file. This is a narrow, deliberate exception to
 * this repo's own import-syntax convention, confined to this one file.
 */
declare const require: (id: string) => unknown;

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
}
interface NodeChildProcessModule {
  spawn(
    command: string,
    args: readonly string[],
    options: { cwd: string; env: Record<string, string>; shell: false; stdio: readonly ["ignore", "pipe", "pipe"]; detached: boolean },
  ): HostChildProcess;
  execFileSync(command: string, args: readonly string[], options: { cwd: string; encoding: "utf-8"; timeout: number; maxBuffer: number }): string;
}
interface NodeHash {
  update(data: string): NodeHash;
  digest(encoding: "hex"): string;
}
interface NodeCryptoModule {
  randomUUID(): string;
  createHash(algorithm: "sha256"): NodeHash;
}

const childProcess = require("node:child_process") as NodeChildProcessModule;
const nodeCrypto = require("node:crypto") as NodeCryptoModule;
const { spawn, execFileSync } = childProcess;
const { randomUUID, createHash } = nodeCrypto;

declare const process: {
  readonly env: Record<string, string | undefined>;
  cwd(): string;
  kill(pid: number, signal?: string): void;
};
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const Buffer: { byteLength(input: string, encoding: string): number };

export interface SpawnOptions {
  cwd: string;
  env: Record<string, string>;
  detached: boolean;
}

/** The only place `spawn()` is called anywhere in this capability — always `shell: false`, always a literal argv array, never a caller-supplied executable path. */
export function spawnProcess(executable: string, argv: readonly string[], options: SpawnOptions): HostChildProcess {
  return spawn(executable, argv, { cwd: options.cwd, env: options.env, shell: false, stdio: ["ignore", "pipe", "pipe"], detached: options.detached });
}

/** Synchronous, bounded, best-effort command capture — used only for the workspace-integrity `git status` snapshot. Never throws to the caller; failure is reported as `undefined`, never guessed. */
export function captureCommandOutputSync(executable: string, argv: readonly string[], cwd: string, timeoutMs: number): string | undefined {
  try {
    return execFileSync(executable, argv, { cwd, encoding: "utf-8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return undefined;
  }
}

export function newExecutionId(): string {
  return randomUUID();
}

export function sha256Hasher(): { update(data: string): void; digestHex(): string } {
  const hash = createHash("sha256");
  return {
    update(data: string) {
      hash.update(data);
    },
    digestHex() {
      return hash.digest("hex");
    },
  };
}

export function readEnvVar(name: string): string | undefined {
  return process.env[name];
}

export function allEnvEntries(): ReadonlyArray<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) entries.push([name, value]);
  }
  return entries;
}

export function currentWorkingDirectory(): string {
  return process.cwd();
}

/** Kills the whole process GROUP a `detached:true` child spawned — mirrors the old repo's proven pattern (a negative PID signals the group on POSIX). Falls back to signaling just the PID if the group is already gone. */
export function killProcessGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

export function hostLog(...args: unknown[]): void {
  console.log(...args);
}

export function hostError(...args: unknown[]): void {
  console.error(...args);
}
