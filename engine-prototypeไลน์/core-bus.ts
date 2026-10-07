import { randomUUID } from "node:crypto"
import type { EngineAdapter, EngineMessage, EngineTraceEntry } from "./contract"

export class CoreBus {
  private readonly adapters = new Map<string, EngineAdapter>()
  private readonly trace: EngineTraceEntry[] = []

  register(adapter: EngineAdapter): void {
    if (this.adapters.has(adapter.name)) throw new Error(`adapter already registered: ${adapter.name}`)
    this.adapters.set(adapter.name, adapter)
    const connect = (adapter as EngineAdapter & { connect?: (dispatch: (message: EngineMessage) => Promise<void>) => void }).connect
    connect?.call(adapter, (message) => this.receive(message))
  }

  getTrace(): readonly EngineTraceEntry[] {
    return this.trace
  }

  async receive(input: Omit<EngineMessage, "eventId" | "correlationId"> & Partial<Pick<EngineMessage, "eventId" | "correlationId">>): Promise<void> {
    const message: EngineMessage = {
      eventId: input.eventId ?? randomUUID(),
      correlationId: input.correlationId ?? randomUUID(),
      source: input.source,
      type: input.type,
      payload: input.payload,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    }
    this.record(message)
    await this.route(message)
  }

  private async route(message: EngineMessage): Promise<void> {
    const routed = message.type === "MESSAGE_RECEIVED"
      ? { ...message, eventId: randomUUID(), source: "core", type: "AI_INTERPRET" }
      : message
    if (routed !== message) this.record(routed)
    const target = this.targetFor(routed.type)
    if (!target) return
    const adapter = this.adapters.get(target)
    if (!adapter) throw new Error(`adapter not registered: ${target}`)
    await adapter.receive(routed, async (result) => {
      this.record(result)
      await this.route(result)
    })
  }

  private targetFor(type: string): string | null {
    if (type === "MESSAGE_RECEIVED") return "ai"
    if (type === "REPLY_REQUESTED") return "line"
    if (type === "AI_INTERPRET") return "ai"
    return null
  }

  private record(message: EngineMessage): void {
    this.trace.push({
      eventId: message.eventId,
      correlationId: message.correlationId,
      source: message.source,
      type: message.type,
      recordedAt: new Date().toISOString(),
    })
  }
}
