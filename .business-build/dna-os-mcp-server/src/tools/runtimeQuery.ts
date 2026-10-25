/**
 * Pure passthrough to POST /api/v1/query. All enforcement (Shadow Command
 * rejection, requires_confirmation gating, token validation) happens in the
 * existing engines/validation/dispatcher.ts — this file never calls the
 * dispatcher directly and never re-implements or bypasses any of its checks.
 */
import type { DnaOsConfig } from "../config.js"
import { httpPost } from "../httpClient.js"
import { resolveToolEndpoint } from "../manifestClient.js"
import { normalizeLegacyResponse, type NormalizedResult } from "../normalize.js"
import { configurationError, type McpAdapterError } from "../errors.js"

export const TOOL_NAME = "runtime.query"

export interface RuntimeQueryInput {
  command: string
  args?: Record<string, unknown>
}

export async function runRuntimeQuery(
  config: DnaOsConfig,
  input: RuntimeQueryInput
): Promise<{ ok: true; result: NormalizedResult } | { ok: false; error: McpAdapterError }> {
  if (!config.apiToken) {
    return {
      ok: false,
      error: configurationError(
        "DNA_OS_API_TOKEN is not set. runtime.query requires a token (GET /admin/api-tokens to generate one); architecture/registry read tools work without it.",
        "/api/v1/query"
      ),
    }
  }

  const resolved = await resolveToolEndpoint(config, TOOL_NAME)
  if (!resolved.ok) return resolved

  const res = await httpPost(
    config,
    resolved.endpoint,
    { command: input.command, args: input.args ?? {} },
    { withToken: true }
  )
  if (!res.ok) return res

  return {
    ok: true,
    result: normalizeLegacyResponse(res.body, {
      sourceFiles: [],
      registryVersion: {},
      confidenceReason:
        "runtime.query passes through whatever engines/validation/dispatcher.ts returns for the requested command; the specific source files read vary per command and are not enumerated by /api/v1/query's response.",
    }),
  }
}
