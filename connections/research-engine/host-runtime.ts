/**
 * หน้าที่: declare the exact host-runtime APIs this capability needs
 * (`fetch`, `AbortSignal.timeout`) so `connections/research-engine/`
 * type-checks as a SELF-CONTAINED folder, matching
 * `../github/host-runtime.ts`'s own reasoning (Capability Folder Law ข้อ 7,
 * no repo-wide `@types/node` dependency).
 *
 * READ-ONLY BY CONSTRUCTION: `hostFetch` below takes NO method and NO body
 * parameter — identical discipline to `../github/host-runtime.ts`. `fetch`
 * defaults to GET, so no code in this capability can issue a write call
 * even by mistake.
 *
 * Input: none (pure host-boundary declarations + a thin wrapper).
 * Output: `hostFetch`, `HostResponse`, `HostFetchOutcome`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม parameter `method` หรือ `body` เข้า `hostFetch`.
 * ห้ามประกาศ ambient global (`declare global`) — module scope เท่านั้น.
 */

declare const AbortSignal: { timeout(milliseconds: number): unknown };
declare const fetch: (url: string, init: { headers: Record<string, string>; signal: unknown }) => Promise<HostResponse>;

/** The only parts of a real `Response` this capability reads. */
export interface HostResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** Either a real HTTP response, or a transport-level failure with no HTTP status at all (connection refused, DNS failure, or an aborted/timed-out request). */
export type HostFetchOutcome = { kind: "response"; response: HostResponse } | { kind: "transport_error"; reason: string };

/**
 * GET-only HTTP. No method parameter, no body parameter — see the file
 * header. Network failure and timeout are returned as data, never thrown,
 * so no caller can accidentally let a rejected promise escape unhandled.
 */
export async function hostFetch(url: string, headers: Record<string, string>, timeoutMilliseconds: number): Promise<HostFetchOutcome> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMilliseconds) });
    return { kind: "response", response };
  } catch (error) {
    return { kind: "transport_error", reason: error instanceof Error ? error.message : String(error) };
  }
}
