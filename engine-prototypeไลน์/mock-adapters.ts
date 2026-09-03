import { randomUUID } from "node:crypto"
import type { EngineAdapter, EngineMessage } from "./contract"

export class MockLineAdapter implements EngineAdapter {
  readonly name = "line"
  readonly replies: unknown[] = []

  async receive(message: EngineMessage, emit: (message: EngineMessage) => Promise<void>): Promise<void> {
    if (message.type === "MESSAGE_RECEIVED") {
      await emit({
        eventId: randomUUID(),
        correlationId: message.correlationId,
        source: this.name,
        type: "AI_INTERPRET",
        payload: { text: (message.payload as { text: string }).text },
        replyTo: message.eventId,
      })
      return
    }
    if (message.type === "REPLY_REQUESTED") this.replies.push(message.payload)
  }
}

export class MockAiAdapter implements EngineAdapter {
  readonly name = "ai"

  async receive(message: EngineMessage, emit: (message: EngineMessage) => Promise<void>): Promise<void> {
    if (message.type !== "AI_INTERPRET") return
    const text = (message.payload as { text: string }).text
    await emit({
      eventId: randomUUID(),
      correlationId: message.correlationId,
      source: this.name,
      type: "AI_RESULT",
      payload: { interpretation: `mock:${text}` },
      replyTo: message.eventId,
    })
    await emit({
      eventId: randomUUID(),
      correlationId: message.correlationId,
      source: this.name,
      type: "REPLY_REQUESTED",
      payload: {
        text: `AI_RESULT:${text}`,
      },
      replyTo: message.eventId,
    })
  }
}
