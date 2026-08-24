/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch real
 * host ambients — same isolation pattern as every other host-runtime.ts
 * in this repo (execution/run/, control/agent-host/, dna-os-circuit/runtime/).
 * `repoRootDirname()` here resolves via `process.cwd()`, same convention
 * as execution/file-write/host-runtime.ts — NEVER a hard-coded path.
 *
 * Input: none.
 * Output: fs/path/crypto primitives this capability needs.
 * Dependency ที่อนุญาต: none — ambient require() only.
 * สิ่งที่ห้ามแตะ: never hard-code /Users/tam or any absolute path here —
 * this is the one thing Phase 23 explicitly forbids repo-wide.
 */
declare const require: (id: string) => unknown;
interface NodeFsModule {
  readFileSync(p: string, e: string): string;
  writeFileSync(p: string, c: string, e: string): void;
  existsSync(p: string): boolean;
  mkdirSync(p: string, o: { recursive: boolean }): void;
  appendFileSync(p: string, c: string, e: string): void;
}
interface NodePathModule {
  join(...parts: string[]): string;
}
interface NodeCryptoModule {
  randomUUID(): string;
}
declare const process: { cwd(): string };

const fs = require("node:fs") as NodeFsModule;
const nodePath = require("node:path") as NodePathModule;
const nodeCrypto = require("node:crypto") as NodeCryptoModule;

export function repoRootDirname(): string {
  return process.cwd();
}
export function joinPath(...parts: string[]): string {
  return nodePath.join(...parts);
}
export function readFileUtf8(p: string): string {
  return fs.readFileSync(p, "utf-8");
}
export function writeFileUtf8(p: string, content: string): void {
  fs.writeFileSync(p, content, "utf-8");
}
export function appendFileUtf8(p: string, content: string): void {
  fs.appendFileSync(p, content, "utf-8");
}
export function fileExists(p: string): boolean {
  return fs.existsSync(p);
}
export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}
export function newId(prefix: string): string {
  return `${prefix}-${nodeCrypto.randomUUID()}`;
}
export function nowIso(): string {
  return new Date().toISOString();
}
