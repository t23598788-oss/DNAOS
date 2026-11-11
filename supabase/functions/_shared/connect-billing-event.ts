export async function markSupabaseBillingEventPaidViaConnect(
  partnerPayableRequestId: string,
  actor: string,
): Promise<{ ok: boolean; error?: string }> {
  const appUrl = Deno.env.get("DNA_OS_APP_URL")
  const secret = Deno.env.get("CONNECT_INTERNAL_SECRET")
  if (!appUrl || !secret) {
    return { ok: false, error: "CONNECT_TRANSPORT_NOT_CONFIGURED" }
  }
  try {
    const res = await fetch(`${appUrl.replace(/\/+$/, "")}/api/internal/connect/billing-event`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-connect-internal-secret": secret },
      body: JSON.stringify({ command: "billing_event.mark_paid", actor, payload: { partner_payable_request_id: partnerPayableRequestId } }),
      signal: AbortSignal.timeout(8000),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error ?? `CONNECT_TRANSPORT_HTTP_${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `CONNECT_TRANSPORT_FAILED:${err instanceof Error ? err.message : String(err)}` }
  }
}
