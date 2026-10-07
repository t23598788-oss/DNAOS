import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
/**
 * หน้าที่: the private real-host surface for
 * `connections/email-alert-source/` — exactly ONE outbound HTTP call and
 * a clock. Nothing else.
 *
 * Input: none.
 * Output: `httpPostJson`, `nowIso`.
 * Dependency ที่อนุญาต: none (global fetch, Node >=18 per package.json engines).
 * สิ่งที่ห้ามแตะ: never add a Google/Gmail/OAuth host here. This file may
 * only call the endpoint its caller supplies. A hardcoded
 * `oauth2.googleapis.com` or `gmail.googleapis.com` call would make this
 * folder a second Gmail reader, which the Owner forbade.
 */

export function nowIso(): string {
  return new Date().toISOString();
}

export interface HttpResult {
  /** False when the host could not be contacted at all — distinct from a non-2xx answer. */
  reached: boolean;
  status: number;
  bodyText: string;
  detail: string;
}

/**
 * NO GLOBAL `fetch` ON THIS RUNTIME (found live, 2026-08-26). This machine
 * runs Node 16, where `fetch` is undefined — the call threw ReferenceError
 * and the catch below reported it as an unreachable host. A live service
 * was being called dead. The stdlib client is used whenever `fetch` is
 * absent; behaviour is otherwise identical.
 */
function stdlibPostJson(url: string, payload: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; bodyText: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const client = isHttps ? httpsRequest : httpRequest;
    const request = client(
      {
        hostname: parsed.hostname,
        port: parsed.port !== "" ? Number(parsed.port) : isHttps ? 443 : 80,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: { ...headers, "Content-Length": String(Buffer.byteLength(payload)) },
        timeout: timeoutMs,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { text += chunk; });
        res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, bodyText: text }));
      },
    );
    request.on("timeout", () => { request.destroy(); rejectPromise(new Error(`no answer within ${timeoutMs}ms`)); });
    request.on("error", (error) => rejectPromise(error));
    request.write(payload);
    request.end();
  });
}

export async function httpPostJson(
  url: string,
  headers: Readonly<Record<string, string>>,
  body: unknown,
  timeoutMs: number,
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (typeof fetch !== "function") {
      const viaStdlib = await stdlibPostJson(url, JSON.stringify(body), { "Content-Type": "application/json", ...headers }, timeoutMs);
      return { reached: true, status: viaStdlib.status, bodyText: viaStdlib.bodyText, detail: `HTTP ${viaStdlib.status}` };
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    return { reached: true, status: response.status, bodyText, detail: `HTTP ${response.status}` };
  } catch (error) {
    const reason = error instanceof Error ? (error.name === "AbortError" ? `no answer within ${timeoutMs}ms` : error.message) : String(error);
    return { reached: false, status: 0, bodyText: "", detail: `could not reach ${url}: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
