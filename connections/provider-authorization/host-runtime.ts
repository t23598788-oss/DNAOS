/**
 * หน้าที่: declare the exact host-runtime APIs this capability needs
 * (`process.env`, `fetch` POST-only, `console`) — the same
 * self-contained-folder pattern `connections/github/host-runtime.ts`
 * already established, but its own, separate declaration: this capability
 * never imports from `connections/github/`.
 *
 * `hostFetchPost` is deliberately POST-only — the GitHub Device Flow's
 * two real calls (`POST /login/device/code`, `POST /login/oauth/access_token`)
 * are the only HTTP this capability ever issues. No GET, no arbitrary
 * method.
 *
 * Input: none.
 * Output: `readEnvVar`, `hostFetchPost`, `hostLog`, `hostError`, `HostResponse`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้าม log ค่า access_token/secret ใดๆ ผ่าน hostLog/hostError.
 */

declare const process: { readonly env: Record<string, string | undefined> };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const AbortSignal: { timeout(milliseconds: number): unknown };
declare const fetch: (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal: unknown }) => Promise<HostResponse>;
declare function setTimeout(callback: () => void, milliseconds: number): unknown;

export interface HostResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type HostFetchOutcome =
  | { kind: "response"; response: HostResponse }
  | { kind: "transport_error"; reason: string };

export function readEnvVar(name: string): string | undefined {
  return process.env[name];
}

export async function hostFetchPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMilliseconds: number
): Promise<HostFetchOutcome> {
  try {
    const response = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMilliseconds) });
    return { kind: "response", response };
  } catch (error) {
    return { kind: "transport_error", reason: error instanceof Error ? error.message : String(error) };
  }
}

export function hostLog(...args: unknown[]): void {
  console.log(...args);
}

export function hostError(...args: unknown[]): void {
  console.error(...args);
}

export function sleepMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
