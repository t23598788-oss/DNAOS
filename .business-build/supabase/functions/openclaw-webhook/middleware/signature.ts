// OpenClaw/Pinto webhook signature verification — HMAC-SHA256 of raw body.
// Same scheme as LINE (see ../../line-webhook-v2/middleware/signature.ts):
// hex digest in the `x-openclaw-signature` header, keyed by the shared
// webhook secret configured on both sides (Pinto channel config on the
// OpenClaw gateway, and OPENCLAW_WEBHOOK_SECRET here).

export async function verifyOpenClawSignature(
  rawBody: string,
  signature: string | null,
  webhookSecret: string,
): Promise<boolean> {
  if (!signature) return false

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )

  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody))
  const expected = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  return expected === signature
}
