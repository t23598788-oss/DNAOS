/**
 * หน้าที่: declare the exact host-runtime APIs this capability needs
 * (`fetch`, `crypto.randomUUID`, `console`, `AbortSignal.timeout`) so
 * `connections/digitalocean/` type-checks as a SELF-CONTAINED folder —
 * copied and adapted from connections/github/host-runtime.ts's own
 * already-proven version of this same declaration (no `@types/node` in
 * this repo, no repo-wide dependency added).
 *
 * READ-ONLY BY CONSTRUCTION: `hostFetch` below takes NO method and NO
 * body parameter, exactly like connections/github/host-runtime.ts's own
 * hostFetch — `fetch` defaults to GET, so no code in this capability can
 * issue a POST/PUT/PATCH/DELETE even by mistake. This is the mechanical
 * form of Owner's Phase-1 scope: READ ONLY ONLY.
 *
 * Input: none (pure host-boundary declarations + thin wrappers).
 * Output: `hostFetch`, `hostRandomId`, `hostLog`, `hostError`,
 * `setHostExitCode`, `HostResponse`.
 * Dependency ที่อนุญาต: none — this file imports nothing at all.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม parameter `method` หรือ `body` เข้า
 * `hostFetch`. ห้ามประกาศ ambient global (`declare global`) — ต้องอยู่ใน
 * module scope เท่านั้น. ห้าม log ค่า credential ผ่าน
 * `hostLog`/`hostError` เด็ดขาด.
 */

declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const crypto: { randomUUID(): string };
declare const AbortSignal: { timeout(milliseconds: number): unknown };
declare const fetch: (url: string, init: { headers: Record<string, string>; signal: unknown }) => Promise<HostResponse>;
declare const process: { exitCode?: number };

/** The only parts of a real `Response` this capability reads. */
export interface HostResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** Either a real HTTP response, or a transport-level failure with no HTTP status at all. */
export type HostFetchOutcome = { kind: "response"; response: HostResponse } | { kind: "transport_error"; reason: string };

/** The injectable shape of `hostFetch` — production code uses the real implementation below; ./tests/adapter.test.ts injects a fake returning canned `HostResponse`-shaped data, so no test ever needs a real token or a real network call. */
export type FetchImpl = (url: string, headers: Record<string, string>, timeoutMilliseconds: number) => Promise<HostFetchOutcome>;

/**
 * GET-only HTTP. No method parameter, no body parameter — see file header.
 * Network failure and timeout are returned as data, never thrown.
 */
export const hostFetch: FetchImpl = async (url, headers, timeoutMilliseconds) => {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMilliseconds) });
    return { kind: "response", response };
  } catch (error) {
    return { kind: "transport_error", reason: error instanceof Error ? error.message : String(error) };
  }
};

export function hostRandomId(): string {
  return crypto.randomUUID();
}

export function hostLog(...args: unknown[]): void {
  console.log(...args);
}

export function hostError(...args: unknown[]): void {
  console.error(...args);
}

export function setHostExitCode(code: number): void {
  process.exitCode = code;
}
