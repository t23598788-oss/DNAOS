// LINE webhook signature verification — HMAC-SHA256 of raw body
// LINE docs: https://developers.line.biz/en/docs/messaging-api/receiving-messages/#verify-signature

export async function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string
): Promise<boolean> {
  if (!signature) return false

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )

  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody))
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)))

  return expected === signature
}
