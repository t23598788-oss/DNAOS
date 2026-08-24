/**
 * หน้าที่: declare the exact host-runtime APIs the circuit's plain Node
 * `http` server needs — this repo has no `package.json` and no
 * `@types/node` installed, so Node's built-in modules are not typed by
 * default. Same pattern as `../../execution/run/host-runtime.ts` and
 * `../../connections/github/host-runtime.ts`: declare the small surface
 * this file actually uses via an ambient `require()`, never widen beyond
 * what `./server.ts` needs.
 *
 * Input: none (ambient declarations + thin wrappers).
 * Output: `createHttpServer`, `HostHttpRequest`, `HostHttpResponse`,
 * `readFileUtf8`, `writeFileUtf8`, `resolvePath`, `fileExists`,
 * `hostRandomId`, `readRequestBody` (added 2026-08-18 for the real
 * `POST /findings` inbound route — see ./finding-receiver.ts).
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never add a dependency on any npm package here — only
 * Node built-ins (`http`, `fs`, `path`), matching the "no new frameworks"
 * hard constraint for this task.
 */

declare const require: (id: string) => unknown;
declare const process: { env: Record<string, string | undefined>; cwd(): string };

/** The small slice of Node's real `Buffer` this file actually touches — no `@types/node` in this repo, same reasoning as every other ambient declaration here. */
interface NodeBufferLike {
  length: number;
  toString(encoding: string): string;
}
declare const Buffer: { concat(chunks: NodeBufferLike[]): NodeBufferLike };

export interface HostHttpRequest {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: "close", listener: () => void): void;
  on(event: "data", listener: (chunk: NodeBufferLike) => void): void;
  on(event: "end", listener: () => void): void;
}
export interface HostHttpResponse {
  writeHead(statusCode: number, headers?: Record<string, string>): void;
  write(chunk: string): boolean;
  end(chunk?: string): void;
  headersSent: boolean;
}
interface NodeHttpModule {
  createServer(handler: (req: HostHttpRequest, res: HostHttpResponse) => void): {
    listen(port: number, callback?: () => void): void;
    close(callback?: () => void): void;
  };
}
interface NodeFsModule {
  readFileSync(path: string, encoding: "utf-8"): string;
  existsSync(path: string): boolean;
  writeFileSync(path: string, data: string, encoding: "utf-8"): void;
}
interface NodePathModule {
  join(...segments: string[]): string;
  extname(p: string): string;
}
interface NodeCryptoModule {
  randomUUID(): string;
}

const http = require("http") as NodeHttpModule;
const fs = require("fs") as NodeFsModule;
const path = require("path") as NodePathModule;
// Explicit require rather than the ambient global `crypto` — verified
// 2026-08-18 that tsx's CJS execution context does not reliably expose
// globalThis.crypto the way a plain `node -e` invocation does (real,
// reproducible ReferenceError hit while testing ./finding-receiver.ts),
// even on Node v24. require("crypto") works in every context.
const nodeCrypto = require("crypto") as NodeCryptoModule;

export function createHttpServer(handler: (req: HostHttpRequest, res: HostHttpResponse) => void) {
  return http.createServer(handler);
}

export function readFileUtf8(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function joinPath(...segments: string[]): string {
  return path.join(...segments);
}

export function extname(filePath: string): string {
  return path.extname(filePath);
}

/** This repo's own README/test convention always invokes plain-program files via `npx tsx <path-from-repo-root>` (see e.g. `../../execution/run/tests/executor.test.ts` header) — so `process.cwd()` is reliably the repo root for every real invocation of `./server.ts`. */
export function repoRootDirname(): string {
  return process.cwd();
}

export function readEnvVar(name: string): string | undefined {
  return process.env[name];
}

export function writeFileUtf8(filePath: string, data: string): void {
  fs.writeFileSync(filePath, data, "utf-8");
}

export function hostRandomId(): string {
  return nodeCrypto.randomUUID();
}

/**
 * Reads a full request body into a string. GET/SSE handlers never call
 * this (matches ../../connections/github/host-runtime.ts's read-only-by-
 * construction discipline for THOSE routes) — this exists specifically
 * for the one real inbound route this server has, `POST /findings`
 * (see ./finding-receiver.ts). Bounded to 1MB to avoid an unbounded
 * request body ever exhausting memory; oversized bodies reject rather
 * than silently truncate.
 */
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
export function readRequestBody(req: HostHttpRequest): Promise<{ ok: true; body: string } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    let received = 0;
    const chunks: NodeBufferLike[] = [];
    let settled = false;
    req.on("data", (chunk: NodeBufferLike) => {
      if (settled) return;
      received += chunk.length;
      if (received > MAX_REQUEST_BODY_BYTES) {
        settled = true;
        resolve({ ok: false, reason: `request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes` });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve({ ok: true, body: Buffer.concat(chunks).toString("utf-8") });
    });
  });
}
