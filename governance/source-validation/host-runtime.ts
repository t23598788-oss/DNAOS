/**
 * หน้าที่: declare the small real host surface `governance/source-validation/`
 * needs (`fs`, `path`) — same isolation pattern as every other
 * host-runtime.ts in this repo. Read-only by construction: every export
 * here reads the filesystem, none ever writes.
 *
 * Input: none.
 * Output: `readFileUtf8`, `fileExists`, `isDirectory`, `listDirEntries`,
 * `joinPath`, `dirnamePath`, `relativePath`, `repoRootDirname`.
 * Dependency ที่อนุญาต: none — ambient require() only.
 * สิ่งที่ห้ามแตะ: never add a write-capable primitive here — this
 * capability only ever reads source files to report on them.
 */

declare const require: (id: string) => unknown;
declare const process: { cwd(): string };

interface NodeFsModule {
  readFileSync(path: string, encoding: string): string;
  existsSync(path: string): boolean;
  statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
  readdirSync(path: string): string[];
}
interface NodePathModule {
  join(...parts: string[]): string;
  dirname(path: string): string;
  relative(from: string, to: string): string;
  basename(path: string): string;
}

const fs = require("fs") as NodeFsModule;
const nodePath = require("path") as NodePathModule;

export function readFileUtf8(path: string): string {
  return fs.readFileSync(path, "utf-8");
}

export function fileExists(path: string): boolean {
  return fs.existsSync(path);
}

export function isDirectory(path: string): boolean {
  return fs.existsSync(path) && fs.statSync(path).isDirectory();
}

export function isFile(path: string): boolean {
  return fs.existsSync(path) && fs.statSync(path).isFile();
}

export function listDirEntries(path: string): readonly string[] {
  return fs.readdirSync(path);
}

export function joinPath(...parts: string[]): string {
  return nodePath.join(...parts);
}

export function dirnamePath(path: string): string {
  return nodePath.dirname(path);
}

export function basenamePath(path: string): string {
  return nodePath.basename(path);
}

export function relativePath(from: string, to: string): string {
  return nodePath.relative(from, to);
}

export function repoRootDirname(): string {
  return process.cwd();
}
