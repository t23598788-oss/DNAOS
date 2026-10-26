/**
 * Regression tests for the Connect Gateway webhook gate (owner security audit
 * 2026-10-26, findings C1–C7).
 *
 * Pure unit tests: no server, no Supabase, no network. They lock the behaviours
 * that were FAILING in production before the fix:
 *   - a webhook with no signature configuration was accepted (C1/C2)
 *   - a disabled connector could still ingest (C4)
 *   - no body cap (C6) and every header was stored (C7)
 *   - no idempotency key existed (C5)
 *
 * run: npx tsx scripts/connect-gateway-webhook-gate.test.ts
 */

import { createHash, createHmac } from "crypto"
import { evaluateWebhookRequest, MAX_WEBHOOK_BODY_BYTES, requireSignatureHeader, verifySignature } from "../app/api/connectors/webhook/[slug]/_lib/webhookGate"

let passed = 0
const failures: string[] = []

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

const SECRET = "test-signing-secret-value"
const BODY = JSON.stringify({ event: { id: "evt_123" }, amount: 100 })
const SIGNATURE = "sha256=" + createHmac("sha256", SECRET).update(BODY).digest("hex")

function connector(patch: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    auth_type: "webhook",
    status: "connected",
    enabled: true,
    config: { signature_header: "x-openclaw-signature", receiving_path: "/api/connectors/webhook/x" },
    secret: { signing_secret: SECRET },
    ...patch,
  }
}

console.log("\n[1] connector resolution")
check("missing connector → 404", (() => {
  const d = evaluateWebhookRequest({ connector: null, rawBody: BODY, headers: {} })
  return !d.ok && d.status === 404 && d.reason === "connector_not_found"
})())
check("non-webhook connector → 404", (() => {
  const d = evaluateWebhookRequest({ connector: connector({ auth_type: "token" }), rawBody: BODY, headers: {} })
  return !d.ok && d.status === 404 && d.reason === "connector_not_webhook"
})())
check("disabled connector → 404 (C4)", (() => {
  const d = evaluateWebhookRequest({ connector: connector({ enabled: false }), rawBody: BODY, headers: { "x-openclaw-signature": SIGNATURE } })
  return !d.ok && d.status === 404 && d.reason === "connector_not_enabled"
})())
check("status=error connector → 404", (() => {
  const d = evaluateWebhookRequest({ connector: connector({ status: "error" }), rawBody: BODY, headers: { "x-openclaw-signature": SIGNATURE } })
  return !d.ok && d.status === 404
})())

console.log("\n[2] fail-closed signature configuration (C1/C2)")
check("missing signature_header → 503", (() => {
  const d = evaluateWebhookRequest({ connector: connector({ config: {} }), rawBody: BODY, headers: { "x-openclaw-signature": SIGNATURE } })
  return !d.ok && d.status === 503 && d.reason === "signature_not_configured"
})())
check("missing signing_secret → 503", (() => {
  const d = evaluateWebhookRequest({ connector: connector({ secret: {} }), rawBody: BODY, headers: { "x-openclaw-signature": SIGNATURE } })
  return !d.ok && d.status === 503 && d.reason === "signature_not_configured"
})())
check("blank signature_header string → 503", (() => {
  const d = evaluateWebhookRequest({ connector: connector({ config: { signature_header: "   " } }), rawBody: BODY, headers: {} })
  return !d.ok && d.status === 503
})())

console.log("\n[3] signature checks")
check("no signature header in request → 401", (() => {
  const d = evaluateWebhookRequest({ connector: connector(), rawBody: BODY, headers: {} })
  return !d.ok && d.status === 401 && d.reason === "signature_missing"
})())
check("wrong signature → 401", (() => {
  const d = evaluateWebhookRequest({ connector: connector(), rawBody: BODY, headers: { "x-openclaw-signature": "sha256=00" } })
  return !d.ok && d.status === 401 && d.reason === "signature_invalid"
})())
check("tampered body with valid-for-original signature → 401", (() => {
  const d = evaluateWebhookRequest({ connector: connector(), rawBody: BODY + " ", headers: { "x-openclaw-signature": SIGNATURE } })
  return !d.ok && d.status === 401
})())
check("correct signature (with sha256= prefix) → accepted", (() => {
  const d = evaluateWebhookRequest({ connector: connector(), rawBody: BODY, headers: { "x-openclaw-signature": SIGNATURE } })
  return d.ok && d.verified === true
})())
check("correct signature without prefix → accepted", (() => {
  const hex = SIGNATURE.replace(/^sha256=/, "")
  const d = evaluateWebhookRequest({ connector: connector(), rawBody: BODY, headers: { "x-openclaw-signature": hex } })
  return d.ok
})())
check("verifySignature ignores empty signature/secret without throwing", (() => {
  return verifySignature(BODY, "", SECRET) === false && verifySignature(BODY, SIGNATURE, "") === false
})())

console.log("\n[4] body size cap (C6)")
check(`body over ${MAX_WEBHOOK_BODY_BYTES}B → 413`, (() => {
  const big = "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1)
  const d = evaluateWebhookRequest({ connector: connector(), rawBody: big, headers: { "x-openclaw-signature": SIGNATURE } })
  return !d.ok && d.status === 413 && d.reason === "body_too_large"
})())
check("declared content-length over cap → 413 before parsing", (() => {
  const d = evaluateWebhookRequest({
    connector: connector(),
    rawBody: "{}",
    headers: { "x-openclaw-signature": SIGNATURE },
    contentLength: String(MAX_WEBHOOK_BODY_BYTES + 10),
  })
  return !d.ok && d.status === 413
})())
check("body exactly at cap is still allowed", (() => {
  const body = "y".repeat(MAX_WEBHOOK_BODY_BYTES)
  const sig = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex")
  const d = evaluateWebhookRequest({ connector: connector(), rawBody: body, headers: { "x-openclaw-signature": sig } })
  return d.ok
})())

console.log("\n[5] stored headers allow-list (C7)")
check("authorization/cookie are never persisted", (() => {
  const d = evaluateWebhookRequest({
    connector: connector(),
    rawBody: BODY,
    headers: {
      "x-openclaw-signature": SIGNATURE,
      "content-type": "application/json",
      authorization: "Bearer leak-me",
      cookie: "session=leak-me",
      "x-real-ip": "203.0.113.9",
    },
  })
  if (!d.ok) return false
  const keys = Object.keys(d.storedHeaders)
  return keys.includes("content-type") && keys.includes("x-openclaw-signature") && !keys.includes("authorization") && !keys.includes("cookie") && !keys.includes("x-real-ip")
})())

console.log("\n[6] idempotency key (C5)")
check("falls back to sha256 of the raw body", (() => {
  const d = evaluateWebhookRequest({ connector: connector(), rawBody: BODY, headers: { "x-openclaw-signature": SIGNATURE } })
  if (!d.ok) return false
  return d.eventKey === "sha256:" + createHash("sha256").update(BODY).digest("hex")
})())
check("uses config.event_id_path when declared", (() => {
  const d = evaluateWebhookRequest({
    connector: connector({ config: { signature_header: "x-openclaw-signature", event_id_path: "event.id" } }),
    rawBody: BODY,
    headers: { "x-openclaw-signature": SIGNATURE },
  })
  return d.ok && d.eventKey === "id:evt_123"
})())
check("same bytes twice → identical key (dedup possible)", (() => {
  const a = evaluateWebhookRequest({ connector: connector(), rawBody: BODY, headers: { "x-openclaw-signature": SIGNATURE } })
  const b = evaluateWebhookRequest({ connector: connector(), rawBody: BODY, headers: { "x-openclaw-signature": SIGNATURE } })
  return a.ok && b.ok && a.eventKey === b.eventKey
})())
check("different bodies → different keys", (() => {
  const other = JSON.stringify({ event: { id: "evt_999" } })
  const sig = "sha256=" + createHmac("sha256", SECRET).update(other).digest("hex")
  const a = evaluateWebhookRequest({ connector: connector(), rawBody: BODY, headers: { "x-openclaw-signature": SIGNATURE } })
  const b = evaluateWebhookRequest({ connector: connector(), rawBody: other, headers: { "x-openclaw-signature": sig } })
  return a.ok && b.ok && a.eventKey !== b.eventKey
})())

console.log("\n[7] connector creation rule (C3)")
check("requireSignatureHeader normalises case/space", (() => {
  return requireSignatureHeader("  X-OpenClaw-Signature ") === "x-openclaw-signature"
})())
check("requireSignatureHeader throws when absent", (() => {
  try { requireSignatureHeader(undefined); return false } catch { return true }
})())
check("requireSignatureHeader throws on blank", (() => {
  try { requireSignatureHeader("   "); return false } catch { return true }
})())

console.log("\n[8] payload pass-through")
check("verified JSON body is parsed and returned", (() => {
  const d = evaluateWebhookRequest({ connector: connector(), rawBody: BODY, headers: { "x-openclaw-signature": SIGNATURE } })
  return d.ok && typeof d.payload === "object" && (d.payload as { event?: { id?: string } }).event?.id === "evt_123"
})())
check("verified non-JSON body is kept as raw text", (() => {
  const raw = "not-json-at-all"
  const sig = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex")
  const d = evaluateWebhookRequest({ connector: connector(), rawBody: raw, headers: { "x-openclaw-signature": sig } })
  return d.ok && d.payload === raw
})())

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  for (const f of failures) console.log("  FAILED:", f)
  process.exit(1)
}
