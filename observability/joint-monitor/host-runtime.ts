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
declare const Object: { entries<T>(o: Record<string, T>): [string, T][] };

interface NodeBufferLike {
  length: number;
  toString(encoding: string): string;
}
declare const Buffer: { concat(chunks: NodeBufferLike[]): NodeBufferLike; byteLength(input: string, encoding?: string): number };

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
/** Minimal shape of `http.request`/`https.request` — the stdlib fallback for a runtime with no global `fetch`. */
interface NodeRequestModule {
  request(
    options: { hostname: string; port: string; path: string; method: string; headers: Record<string, string>; timeout: number },
    callback: (res: { statusCode?: number; resume(): void }) => void,
  ): { on(event: string, listener: (...args: unknown[]) => void): void; write(chunk: string): void; end(): void; destroy(): void };
}
interface NodeFsModule {
  appendFileSync(path: string, data: string, options: { encoding: string; mode: number }): void;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: string): string;
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
const httpRequestModule = require("http") as NodeRequestModule;
const httpsRequestModule = require("https") as NodeRequestModule;

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

/**
 * Reads back a durable jsonl log this folder wrote. Added 2026-08-26 (Owner —
 * DURABLE RUNTIME phase): rows were appended to `data/joints.jsonl` from the
 * first day and never read again, so a restarted collector served an EMPTY
 * snapshot while the durable rows sat on disk beside it — the dashboard's
 * "no joints recorded yet" was a statement about this process's memory, not
 * about the system.
 *
 * A malformed line is SKIPPED, never repaired and never guessed at: a
 * half-written final line is the normal shape of a file whose writer was
 * killed, and inventing a value for it would be exactly the fabrication this
 * capability exists to make impossible.
 */
export function readJsonlLines<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const out: T[] = [];
    for (const line of String(fs.readFileSync(filePath, "utf8")).split("\n")) {
      if (line.trim() === "") continue;
      try { out.push(JSON.parse(line) as T); } catch { /* skipped, never repaired */ }
    }
    return out;
  } catch {
    return [];
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
/**
 * A real POST over `http`/`https`, used when the runtime has no global
 * `fetch`. `ok` means exactly what `Response.ok` means — a 2xx status — so
 * a caller cannot tell the two paths apart, and neither can be mistaken for
 * the other's success.
 */
function postJsonViaStdlib(url: string, payload: string, headers: Record<string, string>, timeoutMilliseconds: number): Promise<{ ok: boolean }> {
  return new Promise((resolvePromise) => {
    try {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === "https:";
      const requestModule = isHttps ? httpsRequestModule : httpRequestModule;
      const request = requestModule.request(
        {
          hostname: parsed.hostname,
          port: parsed.port !== "" ? parsed.port : isHttps ? "443" : "80",
          path: `${parsed.pathname}${parsed.search}`,
          method: "POST",
          headers: { ...headers, "Content-Length": String(Buffer.byteLength(payload)) },
          timeout: timeoutMilliseconds,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          res.resume();
          resolvePromise({ ok: status >= 200 && status < 300 });
        },
      );
      // A timeout or a socket error is a FAILED delivery, never an assumed one.
      request.on("timeout", () => { request.destroy(); resolvePromise({ ok: false }); });
      request.on("error", () => resolvePromise({ ok: false }));
      request.write(payload);
      request.end();
    } catch {
      resolvePromise({ ok: false });
    }
  });
}

export async function hostPostJson(url: string, body: unknown, timeoutMilliseconds: number, authorizationHeader?: string, extraHeaders?: Record<string, string>): Promise<{ ok: boolean }> {
  try {
    // `Authorization` is sent only when the caller actually has a secret
    // to send (2026-08-26 — before this, every POST from ./client.ts went
    // out unauthenticated, so a joint-monitor with
    // JOINT_MONITOR_SHARED_SECRET set answered every real reporter 401;
    // proven live against the Railway deployment, see ../../README of
    // this folder's "Reaching a remote joint-monitor" section).
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (typeof authorizationHeader === "string" && authorizationHeader.length > 0) headers.Authorization = authorizationHeader;
    // Supabase's gateway requires its own `apikey` header alongside the
    // Authorization bearer (2026-08-26) — hence a general extra-header slot
    // rather than a second Supabase-shaped function.
    if (extraHeaders) for (const [name, value] of Object.entries(extraHeaders)) headers[name] = value;
    const payload = JSON.stringify(body);
    // NODE 16 (found live, 2026-08-26): this machine's Node has no global
    // `fetch`, so the line below threw ReferenceError on EVERY report and
    // the catch turned it into a silent `{ ok: false }` — every joint and
    // violation this repo has ever reported from this runtime was dropped
    // at the transport. The stdlib fallback is not a nicety; without it
    // the whole delivery channel is dead here.
    if (typeof fetch !== "function") return postJsonViaStdlib(url, payload, headers, timeoutMilliseconds);
    const response = await fetch(url, { method: "POST", headers, body: payload, signal: AbortSignal.timeout(timeoutMilliseconds) });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}
