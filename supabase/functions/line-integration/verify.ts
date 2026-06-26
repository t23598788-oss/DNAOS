/**
 * LINE Signature Verification
 * ตรวจ X-Line-Signature ด้วย HMAC-SHA256
 */

export async function verifySignature(
  body: string,
  signature: string | null,
  channelSecret: string
): Promise<boolean> {
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return expected === signature;
}
