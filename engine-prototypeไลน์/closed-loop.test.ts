import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { CoreBus } from "./core-bus"
import { MockAiAdapter } from "./mock-adapters"
import { RealLineAdapter, verifyLineSignature } from "./line-adapter"
import { loadLineConfig } from "./config"

function signedRequest(body: string, secret: string): Request {
  const signature = createHmac("sha256", secret).update(body).digest("base64")
  return { text: async () => body, headers: new Map([["x-line-signature", signature]]) } as unknown as Request
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

async function main(): Promise<void> {
  const requests: RequestInit[] = []
  const line = new RealLineAdapter({
    channelSecret: "secret",
    channelAccessToken: "token",
    fetchImpl: async (_input, init) => {
      requests.push(init ?? {})
      return { ok: true, status: 200 } as Response
    },
  })
  const bus = new CoreBus()
  bus.register(line)
  bus.register(new MockAiAdapter())

  const body = JSON.stringify({
    destination: "Ubot",
    events: [{ webhookEventId: "01TEST", replyToken: "reply-token", type: "message", message: { type: "text", text: "ENGINE TEST 001" } }],
  })

  const accepted = await line.handleWebhook(signedRequest(body, "secret"))
  assert.equal(accepted.status, 200)
  const duplicate = await line.handleWebhook(signedRequest(body, "secret"))
  assert.equal(duplicate.status, 200)
  await settle()

  const trace = bus.getTrace()
  assert.deepEqual(trace.slice(0, 4).map((entry) => entry.type), [
    "MESSAGE_RECEIVED", "AI_INTERPRET", "AI_RESULT", "REPLY_REQUESTED",
  ])
  assert.deepEqual(new Set(trace.slice(4).map((entry) => entry.type)), new Set(["LINE_REQUEST_ACCEPTED", "DUPLICATE_IGNORED"]))
  assert.equal(trace.filter((entry) => entry.type === "AI_INTERPRET").length, 1)
  assert.equal(trace.every((entry) => entry.correlationId === "01TEST"), true)
  assert.equal(requests.length, 1)
  assert.equal(JSON.parse(String(requests[0].body)).messages[0].text, "AI_RESULT:ENGINE TEST 001")

  const empty = JSON.stringify({ destination: "Ubot", events: [] })
  const emptyResult = await line.handleWebhook(signedRequest(empty, "secret"))
  assert.equal(emptyResult.status, 200)
  await settle()
  assert.equal(bus.getTrace().filter((entry) => entry.correlationId === "01EMPTY").length, 0)

  const invalid = await line.handleWebhook({ text: async () => body, headers: new Map([["x-line-signature", "invalid"]]) } as unknown as Request)
  assert.equal(invalid.status, 401)

  assert.equal(verifyLineSignature(body, "invalid", "secret"), false)
  assert.deepEqual(loadLineConfig({ LINE_MODE: "mock" }), { mode: "mock" })
  assert.throws(() => loadLineConfig({ LINE_MODE: "real" }), /LINE_CHANNEL_SECRET/)
  assert.throws(() => loadLineConfig({ LINE_MODE: "unset" }), /LINE_MODE/)
  console.log(JSON.stringify({ ok: true, trace, emptyAck: emptyResult.status, invalidSignature: invalid.status, lineRequests: requests.length }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
