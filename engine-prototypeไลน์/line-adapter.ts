import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto"
import type { EngineAdapter, EngineMessage } from "./contract"

type LineWebhookEvent = {
  webhookEventId?: string
  replyToken?: string
  source?: { userId?: string }
  message?: { type?: string; text?: string }
  type?: string
}

type LineWebhookBody = {
  destination?: string
  events?: LineWebhookEvent[]
}

type Dispatch = (message: EngineMessage) => Promise<void>
type FetchLike = typeof fetch

export class RealLineAdapter implements EngineAdapter {
  readonly name = "line"
  private readonly seenWebhookEventIds = new Set<string>()
  private readonly replyTokens = new Map<string, string>()
  private dispatch: Dispatch | null = null

  constructor(
    private readonly config: {
      channelSecret: string
      channelAccessToken: string
      fetchImpl?: FetchLike
    },
  ) {}

  connect(dispatch: Dispatch): void {
    this.dispatch = dispatch
  }

  async receive(message: EngineMessage, _emit: Dispatch): Promise<void> {
    if (message.type !== "REPLY_REQUESTED") return
    const payload = message.payload as { text?: string }
    const replyToken = this.replyTokens.get(message.correlationId)
    if (!replyToken || !payload.text) {
      await _emit(this.failure(message, "replyToken unavailable or output text missing"))
      return
    }
    const fetchImpl = this.config.fetchImpl ?? fetch
    let response: Response
    try {
      response = await fetchImpl("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.channelAccessToken}`,
        },
        body: JSON.stringify({ replyToken, messages: [{ type: "text", text: payload.text }] }),
      })
    } catch (error) {
      await _emit(this.failure(message, error instanceof Error ? error.message : "LINE request failed"))
      return
    }
    if (!response.ok) {
      await _emit(this.failure(message, `HTTP ${response.status}`))
      return
    }
    this.replyTokens.delete(message.correlationId)
    await _emit({
      eventId: randomUUID(),
      correlationId: message.correlationId,
      source: this.name,
      type: "LINE_REQUEST_ACCEPTED",
      payload: { httpStatus: response.status, sentMessages: [] },
      replyTo: message.eventId,
    })
  }

  private failure(message: EngineMessage, reason: string): EngineMessage {
    return {
      eventId: randomUUID(), correlationId: message.correlationId, source: this.name,
      type: "LINE_REPLY_FAILED", payload: { reason }, replyTo: message.eventId,
    }
  }

  async handleWebhook(request: Request): Promise<Response> {
    const rawBodyBytes = new Uint8Array(await request.arrayBuffer())
    const signature = request.headers.get("x-line-signature")
    const bodyHash = createHash("sha256").update(rawBodyBytes).digest("hex")
    console.log(`[RealLineAdapter] inbound signature_present=${signature ? "yes" : "no"} raw_bytes=${rawBodyBytes.byteLength} raw_sha256=${bodyHash}`)
    if (!signature || !verifyLineSignature(rawBodyBytes, signature, this.config.channelSecret)) {
      console.log("[RealLineAdapter] signature rejected")
      return response("Unauthorized", 401)
    }
    const rawBody = new TextDecoder().decode(rawBodyBytes)

    let body: LineWebhookBody
    try {
      body = JSON.parse(rawBody) as LineWebhookBody
    } catch {
      return response("Bad JSON", 400)
    }
    console.log(`[RealLineAdapter] webhook verified events=${body.events?.length ?? 0}`)

    for (const event of body.events ?? []) {
      const webhookEventId = event.webhookEventId
      if (!webhookEventId) continue
      if (this.seenWebhookEventIds.has(webhookEventId)) {
        if (this.dispatch) queueMicrotask(() => { void this.dispatch?.({
          eventId: randomUUID(), correlationId: webhookEventId, source: this.name,
          type: "DUPLICATE_IGNORED", payload: { webhookEventId },
        }) })
        continue
      }
      this.seenWebhookEventIds.add(webhookEventId)
      console.log(`[RealLineAdapter] webhook accepted event=${webhookEventId}`)
      if (event.replyToken) this.replyTokens.set(webhookEventId, event.replyToken)
      const message: EngineMessage = {
        eventId: randomUUID(),
        correlationId: webhookEventId,
        source: this.name,
        type: "MESSAGE_RECEIVED",
        payload: {
          webhookEventId,
          destination: body.destination,
          event,
          text: event.message?.text ?? "",
          replyToken: event.replyToken,
        },
      }
      if (this.dispatch) queueMicrotask(() => { void this.dispatch?.(message) })
    }

    return response(JSON.stringify({ ok: true }), 200)
  }
}

function response(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } })
}

export function verifyLineSignature(rawBody: string | Uint8Array, received: string, channelSecret: string): boolean {
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest("base64")
  const receivedBytes = Buffer.from(received, "utf8")
  const expectedBytes = Buffer.from(expected, "utf8")
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
}
