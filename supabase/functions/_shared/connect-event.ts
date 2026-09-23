// Connect event transport (capability D, 2026-09-23) — the Deno side's only way
// to mutate a business event.
//
// It knows FOUR canonical commands and nothing else. It deliberately knows
// nothing about: the business_events table or its columns, Supabase writes to
// business tables, provider payload shapes (LINE message objects), identity
// resolution, or money. Callers pass canonical values; the Connect boundary
// maps them into the canonical writer.
//
// Fail-closed by contract: a missing app URL/secret, a non-2xx response or a
// writer rejection all come back as { ok: false } — the caller keeps its
// existing error handling (no silent local fallback, never a direct DB write).
export type ConnectEventCommand =
  | "business_event.create"
  | "business_event.transition"
  | "business_event.enrich"
  | "business_event.link_transaction"

export interface ConnectEventResult<T = Record<string, unknown>> {
  ok: boolean
  error?: string
  data?: T
}

export async function sendConnectEventCommand<T = Record<string, unknown>>(
  command: ConnectEventCommand,
  payload: Record<string, unknown>,
  actor: string,
): Promise<ConnectEventResult<T>> {
  const appUrl = Deno.env.get("DNA_OS_APP_URL")
  const secret = Deno.env.get("CONNECT_INTERNAL_SECRET")
  if (!appUrl || !secret) {
    return { ok: false, error: "CONNECT_TRANSPORT_NOT_CONFIGURED" }
  }

  try {
    const res = await fetch(`${appUrl.replace(/\/+$/, "")}/api/internal/connect/event`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-connect-internal-secret": secret },
      body: JSON.stringify({ command, actor, payload }),
      signal: AbortSignal.timeout(8000),
    })
    const body = (await res.json().catch(() => ({}))) as ConnectEventResult<T>
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error ?? `CONNECT_TRANSPORT_HTTP_${res.status}`, data: body.data }
    }
    return { ok: true, data: body.data }
  } catch (err) {
    return { ok: false, error: `CONNECT_TRANSPORT_FAILED:${err instanceof Error ? err.message : String(err)}` }
  }
}

/** Canonical provider id this edge serves — a value, never a branch inside the transport. */
export const CONNECT_PROVIDER = "line"
