/**
 * หน้าที่: declare the exact host-runtime APIs this capability needs
 * (`process.env`, `fetch`, `crypto.randomUUID`, `console`,
 * `AbortSignal.timeout`) so `connections/github/` type-checks as a
 * SELF-CONTAINED folder. This repo has no `package.json` and no
 * `@types/node` installed, so the standard Node globals are not typed by
 * default; declaring the small surface this capability actually uses —
 * inside this capability's own folder, module-scoped, not global — keeps
 * Capability Folder Law ข้อ 7 true ("แก้/ย้าย/test/ตรวจ dependency ได้เป็น
 * โฟลเดอร์เดียว") without adding a repo-wide dependency that is not this
 * round's decision to make.
 *
 * `hostFetch` below takes NO method and NO body parameter — `fetch`
 * defaults to GET, so no code that calls `hostFetch` can issue a
 * POST/PUT/PATCH/DELETE even by mistake. That was the mechanical form of
 * the Owner's 2026-08-14 scope decision (connect/test/read-status only).
 * STEP "Build Minimal Source Execution to GitHub" is the explicit,
 * later authorization that lifts it for exactly one, separate function —
 * `hostFetchWrite` — used only by `../write-api.ts`, PUT-only (GitHub's
 * Contents API create-or-update), never DELETE, never an arbitrary
 * method. `hostFetch` itself is untouched and remains provably GET-only.
 *
 * Input: none (pure host-boundary declarations + thin wrappers).
 * Output: `readEnvVar`, `hostFetch`, `hostFetchWrite`, `hostRandomId`,
 * `hostLog`, `hostError`, `setHostExitCode`, `HostResponse`.
 *
 * แก้ไข 2026-08-14 (Owner — API version change-plan prep, see
 * ../CHANGE_PLAN_API_VERSION.md): `HostResponse.headers.get()` added so a
 * caller can read a RESPONSE header (e.g. GitHub's own
 * `x-github-api-version-selected`) — this is still read-only, adds no
 * write surface, and is the real global `fetch`'s own `Response.headers`
 * shape (a `Headers` object already has `.get()`; this only types the one
 * method this capability needs).
 * Dependency ที่อนุญาต: none — this file imports nothing at all (the
 * timeout is passed in as an argument by the caller, so this file has no
 * dependency even on ./adapter-config).
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม parameter `method` หรือ `body` เข้า
 * `hostFetch` เด็ดขาด — ต้องคงเป็น GET-only ตลอดไป, การเขียนต้องผ่าน
 * `hostFetchWrite` เท่านั้น ซึ่งถูกจำกัดไว้ที่ PUT อย่างเดียว. ห้ามประกาศ
 * ambient global (`declare global`) ที่นี่ — การประกาศต้องอยู่ใน module
 * scope เท่านั้น ไม่ให้รั่วไปทั้ง repo. ห้าม log ค่า credential ผ่าน
 * `hostLog`/`hostError` เด็ดขาด.
 */

declare const process: { readonly env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const crypto: { randomUUID(): string };
declare const AbortSignal: { timeout(milliseconds: number): unknown };
declare const fetch: (url: string, init: { headers: Record<string, string>; signal: unknown }) => Promise<HostResponse>;

/** The only parts of a real `Response` this capability reads. */
export interface HostResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** Either a real HTTP response, or a transport-level failure with no HTTP status at all. */
export type HostFetchOutcome =
  | { kind: "response"; response: HostResponse }
  | { kind: "transport_error"; reason: string };

/**
 * Read one environment variable by name. The NAME is data (it arrives from
 * a `ConnectionRegistration.credential_ref`); the VALUE never leaves this
 * process and is never logged — see ./credential-resolution.ts.
 */
export function readEnvVar(name: string): string | undefined {
  return process.env[name];
}

/**
 * GET-only HTTP. No method parameter, no body parameter — see the file
 * header. Network failure and timeout are returned as data, never thrown,
 * so no caller can accidentally swallow them in a catch-all.
 */
export async function hostFetch(
  url: string,
  headers: Record<string, string>,
  timeoutMilliseconds: number
): Promise<HostFetchOutcome> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMilliseconds) });
    return { kind: "response", response };
  } catch (error) {
    return { kind: "transport_error", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * WRITE HTTP — PUT only, deliberately separate from `hostFetch` (never
 * modify that function's signature, per its own header). STEP "Build
 * Minimal Source Execution to GitHub" is the explicit authorization that
 * lifts the prior "no write path" scope decision — used only by
 * `../write-api.ts`, and only ever with `method: "PUT"` (GitHub's Contents
 * API create-or-update operation; there is no DELETE, no arbitrary method,
 * no body-less write). Network failure and timeout are returned as data,
 * never thrown, matching `hostFetch`'s own discipline.
 */
type WriteCapableFetch = (url: string, init: { method: "PUT"; headers: Record<string, string>; body: string; signal: unknown }) => Promise<HostResponse>;

export async function hostFetchWrite(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMilliseconds: number
): Promise<HostFetchOutcome> {
  try {
    // Same real global `fetch` as hostFetch above — the narrower type on
    // `fetch` itself is what makes hostFetch provably GET-only; this is
    // the one, deliberate, explicitly-authorized place that type is widened.
    const response = await (fetch as unknown as WriteCapableFetch)(url, { method: "PUT", headers, body, signal: AbortSignal.timeout(timeoutMilliseconds) });
    return { kind: "response", response };
  } catch (error) {
    return { kind: "transport_error", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Unique id for an EventEnvelope produced by this adapter. */
export function hostRandomId(): string {
  return crypto.randomUUID();
}

export function hostLog(...args: unknown[]): void {
  console.log(...args);
}

export function hostError(...args: unknown[]): void {
  console.error(...args);
}

/** Used by ./adapter.test.ts so a failed assertion produces a non-zero exit code. */
export function setHostExitCode(code: number): void {
  process.exitCode = code;
}
