#!/usr/bin/env npx tsx
/**
 * Central connector verification — L1 config gate acceptance test.
 *
 * Proves the rules of app/api/admin/connectors/_lib/verifyConnector.ts, the gate
 * the central Test endpoint runs before any outbound call:
 *
 *   1. PRESENCE IS DECIDED BY THE CANONICAL FIELDS — a bearer credential is
 *      accepted under the same names engines/connectors/tester.ts will send.
 *   2. BAD SHAPE IS REFUSED — non-https base_url / url / login_url and an
 *      unknown HTTP method never reach L2.
 *   3. WEBHOOK NEEDS A SIGNATURE HEADER — an inbound connector without one is
 *      refused (fail-closed, same rule as POST /api/admin/connectors).
 *   4. NO SECRET IN ANY ERROR — a canary credential planted in every case never
 *      appears in an error string; only field names do.
 *
 * No network, no database: the gate is pure.
 *
 * Run: npx tsx scripts/connector-verify-test.ts
 */
import assert from "node:assert/strict"
import { validateConnectorConfig } from "../app/api/admin/connectors/_lib/verifyConnector"

const CANARY = "canary-secret-value-9f3a"

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS  ${name}`)
}

function ok(authType: Parameters<typeof validateConnectorConfig>[0], config: unknown, secret: unknown) {
  const result = validateConnectorConfig(authType, config, secret)
  assert.equal(result.error, undefined, `expected pass, got: ${result.error}`)
  assert.equal(result.ok, true)
}

function refused(
  authType: Parameters<typeof validateConnectorConfig>[0],
  config: unknown,
  secret: unknown,
  expected: RegExp
) {
  const result = validateConnectorConfig(authType, config, secret)
  assert.equal(result.ok, false)
  assert.match(String(result.error), expected)
  assert.equal(String(result.error).includes(CANARY), false, "error must never carry the secret value")
}

// 1. canonical bearer fields
check("token accepts channel_access_token", () => {
  ok("token", { base_url: "https://api.line.me", test_path: "v2/bot/info" }, { channel_access_token: CANARY })
})
check("token accepts token", () => {
  ok("token", { base_url: "https://api.supabase.com" }, { token: CANARY })
})
check("api_key accepts api_key", () => {
  ok("api_key", { base_url: "https://generativelanguage.googleapis.com/v1beta", test_path: "models" }, { api_key: CANARY })
})
check("token without any canonical field is refused", () => {
  refused("token", { base_url: "https://api.example.com" }, { unrelated: CANARY }, /credential/)
})

// 2. shape
check("http base_url is refused", () => {
  refused("token", { base_url: "http://api.example.com" }, { token: CANARY }, /https/)
})
check("missing base_url is refused", () => {
  refused("api_key", {}, { api_key: CANARY }, /base_url/)
})
check("uri refuses unknown method", () => {
  refused("uri", { url: "https://example.com/hook", method: "TRACE" }, {}, /method/)
})
check("uri accepts GET", () => {
  ok("uri", { url: "https://example.com/hook", method: "get" }, {})
})
check("mcp requires an https url", () => {
  refused("mcp", { url: "ftp://example.com" }, { auth_token: CANARY }, /https/)
})
check("oauth without access_token asks for Connect", () => {
  refused("oauth", { test_url: "https://gmail.googleapis.com/gmail/v1/users/me/profile" }, {}, /Connect/)
})
check("oauth accepts a stored access token", () => {
  ok("oauth", { test_url: "https://gmail.googleapis.com/gmail/v1/users/me/profile" }, { access_token: CANARY })
})
check("login requires both username and password", () => {
  refused("login", { login_url: "https://erp.example.com/login" }, { username: "u" }, /username และ password/)
})

// 3. webhook fail-closed
check("webhook needs signature_header", () => {
  refused("webhook", { receiving_path: "/api/connectors/webhook/x" }, { signing_secret: CANARY }, /signature_header/)
})
check("webhook with path + header passes", () => {
  ok("webhook", { receiving_path: "/api/connectors/webhook/x", signature_header: "x-signature" }, { signing_secret: CANARY })
})

// 4. unknown auth type
check("unknown auth_type is refused", () => {
  refused("carrier-pigeon" as Parameters<typeof validateConnectorConfig>[0], {}, {}, /auth_type/)
})

console.log(`\n${passed} checks passed`)
