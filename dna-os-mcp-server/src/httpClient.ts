/**
 * The only place this adapter talks to DNA OS. Plain fetch, nothing else —
 * no retries, no caching of response bodies, no business interpretation of
 * payloads. Every tool/resource goes through here.
 */
import type { DnaOsConfig } from "./config.js"
import { fromHttpResponse, networkError, type McpAdapterError } from "./errors.js"

export interface HttpResult<T> {
  ok: true
  status: number
  body: T
}

export interface HttpFailure {
  ok: false
  error: McpAdapterError
}

export type HttpOutcome<T> = HttpResult<T> | HttpFailure

export async function httpGet<T = unknown>(
  config: DnaOsConfig,
  path: string,
  { withToken = false }: { withToken?: boolean } = {}
): Promise<HttpOutcome<T>> {
  return request<T>(config, "GET", path, undefined, withToken)
}

export async function httpPost<T = unknown>(
  config: DnaOsConfig,
  path: string,
  body: unknown,
  { withToken }: { withToken: boolean }
): Promise<HttpOutcome<T>> {
  return request<T>(config, "POST", path, body, withToken)
}

async function request<T>(
  config: DnaOsConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  withToken = false
): Promise<HttpOutcome<T>> {
  const url = `${config.baseUrl}${path}`
  const headers: Record<string, string> = { Accept: "application/json" }
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (withToken && config.apiToken) headers["X-DNA-Token"] = config.apiToken

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    return {
      ok: false,
      error: networkError(err instanceof Error ? err.message : "fetch failed", path),
    }
  }

  let parsed: unknown = undefined
  try {
    parsed = await res.json()
  } catch {
    // non-JSON response body — fall through with undefined
  }

  if (!res.ok) {
    return { ok: false, error: fromHttpResponse(res.status, parsed, path) }
  }

  return { ok: true, status: res.status, body: parsed as T }
}
