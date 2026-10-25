/**
 * Shared response envelope for every /api/v1/mcp/* read route.
 * Pure formatting only — no business logic, no DB access, no dispatcher call.
 * Every MCP route wraps its data with this so trace_id/source_files/
 * registry_version/confidence/generated_at/read_only are never hand-rolled
 * per route and can't drift between them.
 */
import { randomUUID } from "crypto"

export interface McpEnvelopeMeta {
  source_files: string[]
  registry_version: Record<string, number>
  confidence: "high" | "medium" | "low"
}

export function mcpEnvelope<T>(data: T, meta: McpEnvelopeMeta) {
  return {
    data,
    trace_id: randomUUID(),
    source_files: meta.source_files,
    registry_version: meta.registry_version,
    confidence: meta.confidence,
    generated_at: new Date().toISOString(),
    read_only: true as const,
  }
}

export function mcpCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300",
  }
}
