import type { DnaOsConfig } from "../config.js"
import { httpGet } from "../httpClient.js"
import { resolveToolEndpoint } from "../manifestClient.js"
import { normalizeEnvelopedResponse, type NormalizedResult } from "../normalize.js"
import type { McpAdapterError } from "../errors.js"

export const TOOL_NAME = "architecture.system_summary"

export async function runArchitectureSystemSummary(
  config: DnaOsConfig
): Promise<{ ok: true; result: NormalizedResult } | { ok: false; error: McpAdapterError }> {
  const resolved = await resolveToolEndpoint(config, TOOL_NAME)
  if (!resolved.ok) return resolved

  const res = await httpGet(config, resolved.endpoint, { withToken: true })
  if (!res.ok) return res

  return { ok: true, result: normalizeEnvelopedResponse(res.body) }
}
