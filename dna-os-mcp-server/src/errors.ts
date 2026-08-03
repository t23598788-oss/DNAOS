/**
 * Structured error contract returned to MCP clients. Never carries a token,
 * header, or any secret — only code/message/endpoint/trace_id/retryable.
 */

export interface McpAdapterError {
  code:
    | "CONFIGURATION_ERROR"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "BAD_REQUEST"
    | "UPSTREAM_ERROR"
    | "NETWORK_ERROR"
  message: string
  endpoint: string
  trace_id?: string
  retryable: boolean
}

export function configurationError(message: string, endpoint: string): McpAdapterError {
  return { code: "CONFIGURATION_ERROR", message, endpoint, retryable: false }
}

export function networkError(message: string, endpoint: string): McpAdapterError {
  return { code: "NETWORK_ERROR", message, endpoint, retryable: true }
}

export function fromHttpResponse(
  status: number,
  body: unknown,
  endpoint: string
): McpAdapterError {
  const traceId =
    typeof body === "object" && body !== null && "trace_id" in body
      ? String((body as Record<string, unknown>).trace_id)
      : undefined

  const message = extractMessage(body) ?? `Upstream returned HTTP ${status}`

  if (status === 401) return { code: "UNAUTHORIZED", message, endpoint, trace_id: traceId, retryable: false }
  if (status === 403) return { code: "FORBIDDEN", message, endpoint, trace_id: traceId, retryable: false }
  if (status >= 400 && status < 500) return { code: "BAD_REQUEST", message, endpoint, trace_id: traceId, retryable: false }
  return { code: "UPSTREAM_ERROR", message, endpoint, trace_id: traceId, retryable: true }
}

function extractMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined
  const rec = body as Record<string, unknown>
  if (typeof rec.error === "string") return rec.error
  if (typeof rec.message === "string") return rec.message
  return undefined
}
