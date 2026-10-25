// Provider boundary → DNA OS main path (capability A, 2026-09-23).
//
// The LINE Edge Function stays the provider-side receiver (signature check,
// protocol parsing). Instead of the core having to understand a raw LINE
// payload, this helper hands the SAME raw body + signature to the canonical
// gateway observe ingress (app/api/gateway/observe/line/route.ts), which
// translates it via engines/integration-gateway/adapters/line.ts into the
// provider-neutral GatewayEvent contract and publishes it to the event bus.
//
// Deliberately NOT a credential path: no token, no secret value, no new auth
// scheme — authenticity is the provider's own signature, re-verified at the
// ingress. The old in-function handling keeps running unchanged (this is the
// additive step of the provider-retreat line; the old path is retired only
// after every caller has moved and zero-caller proof exists).
//
// Best-effort by contract: a missing DNA_OS_APP_URL, a slow/absent app or a
// non-2xx response must never affect the provider's webhook ACK.
export async function forwardLineInbound(
  rawBody: string,
  signature: string | null,
): Promise<void> {
  const appUrl = Deno.env.get("DNA_OS_APP_URL")
  if (!appUrl || !signature) return

  try {
    await fetch(`${appUrl.replace(/\/+$/, "")}/api/gateway/observe/line`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": signature },
      body: rawBody,
      signal: AbortSignal.timeout(3000),
    })
  } catch (err) {
    // Never surface to the provider — the existing handling already ran.
    console.warn("[connect-forward] main-path forward skipped:", err instanceof Error ? err.message : String(err))
  }
}
