export async function sendConnectPendingAuthorizationCommand(
  command: "pending_authorization.create" | "pending_authorization.resolve",
  payload: Record<string, unknown>,
  actor: string,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> | null }> {
  const appUrl = Deno.env.get("DNA_OS_APP_URL")
  const secret = Deno.env.get("CONNECT_INTERNAL_SECRET")
  if (!appUrl || !secret) {
    return { ok: false, error: "CONNECT_TRANSPORT_NOT_CONFIGURED" }
  }
  try {
    const res = await fetch(`${appUrl.replace(/\/+$/, "")}/api/internal/connect/pending-authorization`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-connect-internal-secret": secret },
      body: JSON.stringify({ command, actor, payload }),
      signal: AbortSignal.timeout(8000),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; data?: Record<string, unknown> | null }
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error ?? `CONNECT_TRANSPORT_HTTP_${res.status}`, data: body.data }
    }
    return { ok: true, data: body.data ?? null }
  } catch (err) {
    return { ok: false, error: `CONNECT_TRANSPORT_FAILED:${err instanceof Error ? err.message : String(err)}` }
  }
}
