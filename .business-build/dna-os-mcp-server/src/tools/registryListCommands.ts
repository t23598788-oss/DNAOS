import type { DnaOsConfig } from "../config.js"
import { httpGet } from "../httpClient.js"
import { resolveToolEndpoint } from "../manifestClient.js"
import { normalizeEnvelopedResponse, type NormalizedResult } from "../normalize.js"
import type { McpAdapterError } from "../errors.js"

export const TOOL_NAME = "registry.list_commands"

export async function runRegistryListCommands(
  config: DnaOsConfig
): Promise<{ ok: true; result: NormalizedResult } | { ok: false; error: McpAdapterError }> {
  const resolved = await resolveToolEndpoint(config, TOOL_NAME)
  if (!resolved.ok) return resolved

  const res = await httpGet(config, resolved.endpoint)
  if (!res.ok) return res

  return { ok: true, result: normalizeEnvelopedResponse(res.body) }
}
