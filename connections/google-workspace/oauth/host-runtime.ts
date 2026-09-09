/**
 * Host helpers for Google Workspace OAuth (folder-local, TikTok DI pattern).
 * Never log client_secret / authorization_code / access_token / refresh_token.
 */

import { createHash, randomBytes } from "node:crypto";

declare const process: { readonly env: Record<string, string | undefined> };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const AbortSignal: { timeout(milliseconds: number): unknown };
declare const fetch: (
  url: string,
  init: { method: "POST" | "GET"; headers: Record<string, string>; body?: string; signal: unknown },
) => Promise<HostResponse>;

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
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export async function hostFetchPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMilliseconds: number,
): Promise<HostFetchOutcome> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
    return { kind: "response", response };
  } catch (error) {
    return { kind: "transport_error", reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function hostFetchGet(
  url: string,
  headers: Record<string, string>,
  timeoutMilliseconds: number,
): Promise<HostFetchOutcome> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
    return { kind: "response", response };
  } catch (error) {
    return { kind: "transport_error", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** SHA-256 raw digest bytes — Google PKCE S256 uses base64url of these bytes, not hex. */
export function sha256Raw(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

/** Base64url without padding (RFC 7636). */
export function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function hostLog(...args: unknown[]): void {
  console.log(...args);
}

export function hostError(...args: unknown[]): void {
  console.error(...args);
}
