/**
 * GET-only host fetch for Google Workspace API reads.
 * No method/body parameters — write verbs cannot be issued by mistake.
 */

declare const crypto: { randomUUID(): string };
declare const AbortSignal: { timeout(milliseconds: number): unknown };
declare const fetch: (url: string, init: { headers: Record<string, string>; signal: unknown }) => Promise<HostResponse>;

export interface HostResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type HostFetchOutcome =
  | { kind: "response"; response: HostResponse }
  | { kind: "transport_error"; reason: string };

export type FetchImpl = (
  url: string,
  headers: Record<string, string>,
  timeoutMilliseconds: number,
) => Promise<HostFetchOutcome>;

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

export function hostNowIso(): string {
  return new Date().toISOString();
}
