/**
 * หน้าที่: declare the small real host surface `execution/file-write/`
 * needs (`fs`, `path`, `crypto`) — same isolation pattern as
 * `execution/run/host-runtime.ts` (no `@types/node` in this repo). Uses
 * `require()`, the proven-reliable pattern in this repo's real tsx
 * execution context (see ../../control/ai-write-control/host-runtime.ts's
 * own header for why the ambient `declare const crypto` form is unreliable
 * here).
 *
 * Input: none.
 * Output: `writeFileReal`, `readFileReal`, `fileExistsReal`,
 * `ensureDirReal`, `joinPath`, `dirnamePath`, `newWriteId`, `nowIso`,
 * `byteLength`, `nodeExecPath` (added 2026-08-22 for ./sandboxed-executor.ts).
 * Dependency ที่อนุญาต: none — ambient require() only.
 * สิ่งที่ห้ามแตะ: this file may perform real fs writes — but it exports
 * only narrow primitives; ./executor.ts and ./sandboxed-executor.ts (both
 * internal to this same capability folder) are the only callers, and
 * `executeFileWrite`/`executeFileWriteSandboxed` are the ONLY exported
 * gate-checked entry points of this whole capability (see ./executor.ts's
 * own header for the "no ungated export" rule — unchanged by this
 * addition).
 */

declare const require: (id: string) => unknown;

interface NodeFsModule {
  writeFileSync(path: string, content: string, encoding: string): void;
  readFileSync(path: string, encoding: string): string;
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  statSync(path: string): { size: number };
}
interface NodePathModule {
  join(...parts: string[]): string;
  dirname(path: string): string;
}
interface NodeCryptoModule {
  randomUUID(): string;
}

const fs = require("fs") as NodeFsModule;
const nodePath = require("path") as NodePathModule;
const nodeCrypto = require("crypto") as NodeCryptoModule;

declare const process: { cwd(): string; execPath: string };

export function joinPath(...parts: string[]): string {
  return nodePath.join(...parts);
}

/** The real absolute path to the Node executable running THIS process — the one literal binary `control/agent-host/`'s sandbox profile will be told to allow exec of (see ./sandboxed-executor.ts). Never a resolved-from-PATH guess. */
export function nodeExecPath(): string {
  return process.execPath;
}

export function dirnamePath(path: string): string {
  return nodePath.dirname(path);
}

export function repoRootDirname(): string {
  return process.cwd();
}

export function fileExistsReal(path: string): boolean {
  return fs.existsSync(path);
}

export function ensureDirReal(path: string): void {
  fs.mkdirSync(path, { recursive: true });
}

export function writeFileReal(path: string, content: string): number {
  fs.writeFileSync(path, content, "utf-8");
  return fs.statSync(path).size;
}

export function readFileReal(path: string): string {
  return fs.readFileSync(path, "utf-8");
}

export function newWriteId(): string {
  return `write_${nodeCrypto.randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
