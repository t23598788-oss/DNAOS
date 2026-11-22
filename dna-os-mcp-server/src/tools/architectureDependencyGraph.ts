import type { DnaOsConfig } from "../config.js"
import { httpGet } from "../httpClient.js"
import { resolveToolEndpoint } from "../manifestClient.js"
import { normalizeEnvelopedResponse, type NormalizedResult } from "../normalize.js"
import type { McpAdapterError } from "../errors.js"

export const TOOL_NAME = "architecture.get_dependency_graph"

export type ArchitectureDependencyGraphInput = {
  q?: string
  node_type?: "File" | "Function" | "Module" | "Task"
  edge_type?: "IMPORTS" | "CALLS" | "DEPENDS_ON" | "TASK_LINKED_TO"
  source_node_key?: string
  target_node_key?: string
  limit?: number
  offset?: number
}

export async function runArchitectureGetDependencyGraph(
  config: DnaOsConfig,
  input: ArchitectureDependencyGraphInput = {}
): Promise<{ ok: true; result: NormalizedResult } | { ok: false; error: McpAdapterError }> {
  const resolved = await resolveToolEndpoint(config, TOOL_NAME)
  if (!resolved.ok) return resolved

  const params = new URLSearchParams()
  for (const key of ["q", "node_type", "edge_type", "source_node_key", "target_node_key"] as const) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) params.set(key, value.trim())
  }
  if (input.limit !== undefined) params.set("limit", String(input.limit))
  if (input.offset !== undefined) params.set("offset", String(input.offset))
  const endpoint = params.size ? `${resolved.endpoint}?${params.toString()}` : resolved.endpoint
  const res = await httpGet(config, endpoint, { withToken: true })
  if (!res.ok) return res

  return { ok: true, result: normalizeEnvelopedResponse(res.body) }
}
