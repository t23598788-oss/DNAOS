/**
 * registry.list_modules reuses the pre-existing DNA OS command of the same
 * name (owner: runtime/engine, command-registry.json) via the pre-existing
 * GET /api/v1/modules route — no new command-registry entry, no new route,
 * no filter args, because the existing contract has none. See
 * registry/mcp-planned-manifest.json's registry.list_modules entry.
 */
import type { DnaOsConfig } from "../config.js"
import { httpGet } from "../httpClient.js"
import { resolveToolEndpoint } from "../manifestClient.js"
import { normalizeLegacyResponse, type NormalizedResult } from "../normalize.js"
import type { McpAdapterError } from "../errors.js"

export const TOOL_NAME = "registry.list_modules"

export async function runRegistryListModules(
  config: DnaOsConfig
): Promise<{ ok: true; result: NormalizedResult } | { ok: false; error: McpAdapterError }> {
  const resolved = await resolveToolEndpoint(config, TOOL_NAME)
  if (!resolved.ok) return resolved

  const res = await httpGet(config, resolved.endpoint)
  if (!res.ok) return res

  return {
    ok: true,
    result: normalizeLegacyResponse(res.body, {
      sourceFiles: ["registry/module-registry.json"],
      registryVersion: {},
      confidenceReason:
        "GET /api/v1/modules (the pre-existing route this tool reuses) does not expose module-registry.json's own version field in its response body.",
    }),
  }
}
