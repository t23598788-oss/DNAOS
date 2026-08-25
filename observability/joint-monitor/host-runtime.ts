/**
 * หน้าที่: declare the exact host-runtime APIs `observability/joint-monitor/`
 * needs — a plain Node `http` server (SSE + JSON routes), durable JSONL
 * append for the audit trail, and an outbound `fetch` POST client for
 * ./client.ts's fire-and-forget reporters. Same isolation pattern as
 * every other host-runtime.ts in this repo (`../../dna-os-circuit/runtime/host-runtime.ts`,
 * `../../execution/run/host-runtime.ts`, `../../connections/research-engine/host-runtime.ts`)
 * — this repo has no `@types/node`, so Node built-ins are declared via
 * ambient `require()` rather than assumed typed.
 *
 * Input: none (ambient declarations + thin wrappers).
 * Output: `createHttpServer`, `HostHttpRequest`, `HostHttpResponse`,
 * `readRequestBody`, `appendJsonlLine`, `ensureDirReal`, `hostRandomId`,
 * `nowIso`, `readEnvVar`, `repoRootDirname`, `hostPostJson`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never add an npm dependency here — Node built-ins only
 * (`http`, `fs`, `path`, `crypto`, `fetch`), matching the repo-wide "no
 * new frameworks" constraint (`../../dna-os-circuit/runtime/server.ts`'s
 * own header states this explicitly for the sibling server this file's
 * server.ts is modeled on).
 */

declare const require: (id: string) => unknown;
declare const process: { env: Record<string, string | undefined>; cwd(): string };
declare const AbortSignal: { timeout(milliseconds: number): unknown };
declare const fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: unknown }) => Promise<{ ok: boolean; status: number }>;

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
    listen(port: number, host?: string, callback?: () => void): void;
    close(callback?: () => void): void;
  };
}
interface NodeFsModule {
  appendFileSync(path: string, data: string, options: { encoding: string; mode: number }): void;
  mkdirSync(path: string, options: { recursive: boolean }): void;
}
interface NodePathModule {
  join(...segments: string[]): string;
  dirname(p: string): string;
}
interface NodeCryptoModule {
  randomUUID(): string;
}

const http = require("http") as NodeHttpModule;
const fs = require("fs") as NodeFsModule;
const path = require("path") as NodePathModule;
const nodeCrypto = require("crypto") as NodeCryptoModule;

export function createHttpServer(handler: (req: HostHttpRequest, res: HostHttpResponse) => void) {
  return http.createServer(handler);
}

export function joinPath(...segments: string[]): string {
  return path.join(...segments);
}

export function ensureDirReal(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Durable audit-trail append — swallows its own failure so a full disk or a permission error never crashes an already-recorded in-memory event (matches `../../audit/command-audit/file-audit-sink.ts`'s exact swallow-and-continue discipline). */
export function appendJsonlLine(filePath: string, row: unknown): void {
  try {
    ensureDirReal(path.dirname(filePath));
    fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, { encoding: "utf-8", mode: 0o600 });
  } catch {
    // Durability failure must never crash an already-recorded in-memory event.
  }
}

export function repoRootDirname(): string {
  return process.cwd();
}

export function readEnvVar(name: string): string | undefined {
  return process.env[name];
}

export function hostRandomId(): string {
  return nodeCrypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

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

/**
 * Fire-and-forget POST used by ./client.ts's `reportJoint`/
 * `reportViolation` — never throws, always resolves, matching
 * `../../connections/research-engine/host-runtime.ts`'s "network failure
 * returned as data, never thrown" discipline. A down/unreachable
 * dashboard must never surface as an error to the real caller (a live
 * Owner command) that triggered the report.
 */
export async function hostPostJson(url: string, body: unknown, timeoutMilliseconds: number, authorizationHeader?: string): Promise<{ ok: boolean }> {
  try {
    // `Authorization` is sent only when the caller actually has a secret
    // to send (2026-08-26 — before this, every POST from ./client.ts went
    // out unauthenticated, so a joint-monitor with
    // JOINT_MONITOR_SHARED_SECRET set answered every real reporter 401;
    // proven live against the Railway deployment, see ../../README of
    // this folder's "Reaching a remote joint-monitor" section).
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (typeof authorizationHeader === "string" && authorizationHeader.length > 0) headers.Authorization = authorizationHeader;
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMilliseconds) });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}
