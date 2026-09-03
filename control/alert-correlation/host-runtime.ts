/**
 * หน้าที่: the private real-host surface for `control/alert-correlation/`
 * — filesystem existence checks and ONE bounded HTTP health probe. Same
 * isolation discipline as `../runtime-adapter/host-runtime.ts`: every
 * real side effect this capability performs is declared here, so
 * `./parse.ts`, `./resolve.ts` and `./dedup.ts` stay pure.
 *
 * Input: none.
 * Output: `repoPathExists`, `probeHttp`, `nowIso`, `REPO_ROOT`.
 * Dependency ที่อนุญาต: node:fs, node:path, node:url.
 * สิ่งที่ห้ามแตะ: never add a mail-protocol client here. This capability
 * reads no mailbox — see ./README.md's INGESTION SEAM. Never remove the
 * probe timeout: an unbounded probe turns a correlation run into a hang.
 */

import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo root, derived from this file's own location — never from cwd. */
export const REPO_ROOT = resolve(__dirname, "..", "..");

export function nowIso(): string {
  return new Date().toISOString();
}

/** True only for a path that really exists under the repo root. */
export function repoPathExists(relativePath: string): boolean {
  return existsSync(join(REPO_ROOT, relativePath));
}

export interface HttpProbeResult {
  reachable: boolean;
  status: number | null;
  detail: string;
}

/**
 * One bounded GET. Any network failure is reported as unreachable with
 * the real reason — never thrown, never converted into a fake success.
 * A non-2xx response is still "reachable": the host answered, which is a
 * different fact from the host being down, and collapsing the two would
 * make a 500 look identical to a DNS failure.
 */
/**
 * NO GLOBAL `fetch` ON THIS RUNTIME (found live, 2026-08-26). This machine
 * runs Node 16, where `fetch` is undefined — the call threw ReferenceError
 * and the catch below reported it as an unreachable host. A live service
 * was being called dead. The stdlib client is used whenever `fetch` is
 * absent; behaviour is otherwise identical.
 */
function stdlibGetStatus(url: string, timeoutMs: number): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const client = isHttps ? httpsGet : httpGet;
    const request = client(
      { hostname: parsed.hostname, port: parsed.port !== "" ? Number(parsed.port) : isHttps ? 443 : 80, path: `${parsed.pathname}${parsed.search}`, timeout: timeoutMs },
      (res) => { res.resume(); resolvePromise(res.statusCode ?? 0); },
    );
    request.on("timeout", () => { request.destroy(); rejectPromise(new Error(`no answer within ${timeoutMs}ms`)); });
    request.on("error", (error) => rejectPromise(error));
  });
}

export async function probeHttp(url: string, timeoutMs = 12_000): Promise<HttpProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const status = typeof fetch === "function"
      ? (await fetch(url, { method: "GET", signal: controller.signal, redirect: "follow" })).status
      : await stdlibGetStatus(url, timeoutMs);
    return {
      reachable: true,
      status,
      detail: `host answered HTTP ${status}`,
    };
  } catch (error) {
    const reason = error instanceof Error ? (error.name === "AbortError" ? `no answer within ${timeoutMs}ms` : error.message) : String(error);
    return { reachable: false, status: null, detail: `probe failed: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
