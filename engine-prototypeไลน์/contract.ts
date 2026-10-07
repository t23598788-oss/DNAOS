export type EngineMessage = {
  eventId: string
  correlationId: string
  source: string
  type: string
  payload: unknown
  replyTo?: string
}

export type EngineTraceEntry = {
  eventId: string
  correlationId: string
  source: string
  type: string
  recordedAt: string
}

export type EngineAdapter = {
  name: string
  receive(message: EngineMessage, emit: (message: EngineMessage) => Promise<void>): Promise<void>
}
