/**
 * HMAC-SHA-256 fallback hashing for system AI Connection credentials —
 * used only when a given api_tokens row chooses token_hash over
 * vault_secret_id (see 20260804000007_ai_connection_stage1.sql's CHECK
 * constraint — exactly one of the two, never both).
 *
 * Never plain SHA-256: HMAC's pepper (a server-only secret, never
 * NEXT_PUBLIC_) means a leaked token_hash column alone is useless without
 * the pepper too. Comparison is constant-time (crypto.timingSafeEqual) to
 * avoid a timing side-channel on the hash comparison itself.
 *
 * This module never logs the raw token, the pepper, or the resulting hash.
 */
import { createHmac, timingSafeEqual } from "crypto"

function pepper(): string {
  const value = process.env.AI_CONNECTION_TOKEN_PEPPER
  if (!value) {
    // Fail closed — never hash with an empty/missing key, which would make
    // every token hash to the same predictable value.
    throw new Error("AI_CONNECTION_TOKEN_PEPPER is not set — refusing to hash without a real pepper.")
  }
  return value
}

export function hashToken(rawToken: string): string {
  return createHmac("sha256", pepper()).update(rawToken, "utf8").digest("hex")
}

export function verifyTokenHash(rawToken: string, storedHash: string): boolean {
  const computed = hashToken(rawToken)
  const a = Buffer.from(computed, "hex")
  const b = Buffer.from(storedHash, "hex")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
