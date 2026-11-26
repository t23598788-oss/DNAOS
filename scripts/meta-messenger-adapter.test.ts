/**
 * Offline contract checks for the existing Meta webhook receiver.
 * Run with: npx tsx scripts/meta-messenger-adapter.test.ts
 */
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import {
  capabilityForMetaMessage,
  metaVerifyChallenge,
  normalizeMetaWebhook,
  verifyMetaSignature,
} from "../engines/integration-gateway/adapters/meta"

let passed = 0
const failed: string[] = []
function check(name: string, ok: boolean) {
  if (ok) { passed++; console.log(`PASS ${name}`) }
  else { failed.push(name); console.log(`FAIL ${name}`) }
}

const secret = "local-test-only"
const raw = JSON.stringify({ object: "page", entry: [] })
const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`
check("valid Meta raw-body signature is accepted", verifyMetaSignature(raw, signature, secret))
check("tampered payload signature is rejected", !verifyMetaSignature(`${raw} `, signature, secret))
check("missing signature is rejected", !verifyMetaSignature(raw, null, secret))
check("missing app secret is rejected", !verifyMetaSignature(raw, signature, ""))
check("valid subscription challenge is echoed", metaVerifyChallenge({ mode: "subscribe", verifyToken: "vt", challenge: "c-1" }, "vt") === "c-1")
check("wrong subscription token is rejected", metaVerifyChallenge({ mode: "subscribe", verifyToken: "wrong", challenge: "c-1" }, "vt") === null)
check("challenge is not accepted with missing configured token", metaVerifyChallenge({ mode: "subscribe", verifyToken: "vt", challenge: "c-1" }, "") === null)

const normalized = normalizeMetaWebhook({
  object: "page",
  entry: [{ id: "page-1", time: 1_700_000_000_000, messaging: [
    { sender: { id: "psid-1" }, recipient: { id: "page-1" }, timestamp: 1_700_000_000_001, message: { mid: "mid-1", text: "Need stock today" } },
    { sender: { id: "page-1" }, recipient: { id: "psid-1" }, message: { mid: "echo-1", text: "Sent reply", is_echo: true } },
    { sender: { id: "psid-1" }, recipient: { id: "page-1" }, delivery: { mids: ["mid-1"] } },
  ] }],
})
check("inbound Page message is normalized once", normalized.events.length === 1 && normalized.events[0]?.provider === "facebook")
check("inbound event has stable message id and sender", normalized.events[0]?.event_id === "EVT-facebook-mid-1" && normalized.events[0]?.evidence.sender_id === "psid-1")
check("observe adapter never requests a send/reply side effect", normalized.events[0]?.requested_effect === "none" && normalized.events[0]?.channel === "observe")
check("echoes and delivery receipts are skipped", normalized.skipped === 2)
check("raw chat text is excluded from gateway event evidence", !JSON.stringify(normalized.events[0]?.evidence).includes("Need stock today"))
check("text messages map to message.received", normalized.events[0]?.capability === "message.received")
check("media messages map to document.received", capabilityForMetaMessage(true, "image") === "document.received")
check("unknown Meta objects are skipped", normalizeMetaWebhook({ object: "user", entry: [] }).events.length === 0)
const malformedPayload = normalizeMetaWebhook({ object: "page", entry: [null, { messaging: [null] }] })
check("malformed entry and event values are ignored without throwing", malformedPayload.events.length === 0 && malformedPayload.skipped === 2)
const malformedAttachments = normalizeMetaWebhook({ object: "page", entry: [{ messaging: [{ message: { mid: "safe-mid", text: "hello", attachments: { unexpected: true } } }] }] })
check("malformed attachment container cannot crash event normalization", malformedAttachments.events.length === 1 && malformedAttachments.events[0]?.event_id === "EVT-facebook-safe-mid")

const developerGuide = readFileSync("public/landing-preview/docs/integrations/facebook-messenger.md", "utf8")
check("developer guide documents callback, secrets and ACK behavior", ["/api/gateway/observe/meta", "META_APP_SECRET", "META_VERIFY_TOKEN", "HTTP 200"].every((fact) => developerGuide.includes(fact)))
const publicGuide = readFileSync("public/landing-preview/docs/integrations/meta-mcp-and-facebook-page-installation.md", "utf8")
check("public setup guide separates admin MCP from customer Page connection", publicGuide.includes("Meta Social Technologies MCP") && publicGuide.includes("ยังไม่อยู่ใน Production") && publicGuide.includes("ผู้ดูแลร้าน/องค์กร") && publicGuide.includes("meta/agentic-tools"))
const landingRoutes = readFileSync("workers/landing-entry/wrangler.jsonc", "utf8")
check("homepage Worker exposes integration guide assets", landingRoutes.includes("dnaos.dev/docs/integrations/*"))
const publicIndex = readFileSync("public/landing-preview/llms.txt", "utf8")
check("AI index links to public Meta integration guides", publicIndex.includes("/docs/integrations/facebook-messenger.md") && publicIndex.includes("/docs/integrations/meta-mcp-and-facebook-page-installation.md"))
const publicStatus = JSON.parse(readFileSync("public/landing-preview/api-status.json", "utf8")) as { endpoints: { method: string; path: string; status: string; http_status?: number }[] }
check("public status map records current Meta production routes as not deployed", ["GET", "POST"].every((method) => publicStatus.endpoints.some((endpoint) => endpoint.method === method && endpoint.path === "/api/gateway/observe/meta" && endpoint.status === "IN_DEVELOPMENT" && endpoint.http_status === 404)))
const webhookRoute = readFileSync("app/api/gateway/observe/meta/route.ts", "utf8")
check("webhook verifies signature before translating payload", webhookRoute.indexOf("verifyMetaSignature(rawBody") < webhookRoute.indexOf("normalizeMetaWebhook(payload)"))
check("webhook publishes each normalized event to the central bus", webhookRoute.includes("for (const event of events)") && webhookRoute.includes("publish(supabaseAdmin(), event)"))
check("bus failure returns retryable HTTP 500", webhookRoute.includes("status: 500") && webhookRoute.includes("!result.ok"))
check("successful forwarding ACKs Meta with accepted event count", webhookRoute.includes("{ ok: true, accepted: events.length, skipped }") && webhookRoute.includes("NextResponse.json"))
check("this phase contains no Messenger Send API call", !webhookRoute.includes("graph.facebook.com") && !webhookRoute.includes("sendMetaMessage"))

console.log(`\nMeta webhook contract: ${passed} passed, ${failed.length} failed`)
if (failed.length) process.exit(1)
