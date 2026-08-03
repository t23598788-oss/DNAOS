/**
 * Protocol-only normalization. Guarantees every tool/resource result carries
 * trace_id/source_files/registry_version/confidence/generated_at/read_only,
 * regardless of whether the backing endpoint already returns that envelope
 * (the /api/v1/mcp/* routes do) or not (/api/v1/modules, /api/v1/constitution
 * predate this envelope and return their own shape).
 *
 * This NEVER touches or recomputes the underlying data — `content` is always
 * exactly what the endpoint returned, unmodified.
 */
import { randomUUID } from "node:crypto"

export interface NormalizedResult {
  content: unknown
  trace_id: string
  source_files: string[]
  registry_version: Record<string, unknown>
  confidence: "high" | "medium" | "low"
  confidence_reason?: string
  generated_at: string
  read_only: true
}

interface KnownEnvelope {
  data: unknown
  trace_id: string
  source_files: string[]
  registry_version: Record<string, unknown>
  confidence: "high" | "medium" | "low"
  generated_at: string
  read_only: true
}

function isKnownEnvelope(body: unknown): body is KnownEnvelope {
  if (typeof body !== "object" || body === null) return false
  const rec = body as Record<string, unknown>
  return (
    "trace_id" in rec &&
    "source_files" in rec &&
    "registry_version" in rec &&
    "confidence" in rec &&
    "generated_at" in rec &&
    "read_only" in rec
  )
}

/**
 * For endpoints that already speak the DNA OS MCP envelope
 * (everything under /api/v1/mcp/*), pass the envelope through untouched.
 */
export function normalizeEnvelopedResponse(body: unknown): NormalizedResult {
  if (isKnownEnvelope(body)) {
    return {
      content: body.data,
      trace_id: body.trace_id,
      source_files: body.source_files,
      registry_version: body.registry_version,
      confidence: body.confidence,
      generated_at: body.generated_at,
      read_only: true,
    }
  }
  // Defensive fallback — should not happen for our own /api/v1/mcp/* routes,
  // but never fabricate the missing fields as if they were real registry data.
  return normalizeLegacyResponse(body, {
    sourceFiles: [],
    registryVersion: {},
    confidenceReason: "Backing endpoint did not return the expected envelope shape.",
  })
}

/**
 * For pre-existing endpoints that predate this envelope (/api/v1/modules,
 * /api/v1/constitution) and were never designed to carry it. The adapter
 * synthesizes only protocol metadata (trace_id, generated_at) — it never
 * invents registry_version or source_files data the endpoint doesn't
 * actually expose; when that's the case, confidence drops to "medium" and
 * confidence_reason states exactly what's missing and why.
 */
export function normalizeLegacyResponse(
  body: unknown,
  meta: {
    sourceFiles: string[]
    registryVersion: Record<string, unknown>
    confidenceReason?: string
  }
): NormalizedResult {
  return {
    content: body,
    trace_id: randomUUID(),
    source_files: meta.sourceFiles,
    registry_version: meta.registryVersion,
    confidence: meta.confidenceReason ? "medium" : "high",
    confidence_reason: meta.confidenceReason,
    generated_at: new Date().toISOString(),
    read_only: true,
  }
}
