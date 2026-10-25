/**
 * contractor.status — contractor job status over MCP (NEW-1; App-side half is
 * app/api/v1/mcp/contractor/status/route.ts).
 *
 * PROTOCOL ADAPTER ONLY (registry/dependency-graph.json → notes.mcp_isolation):
 * HTTP GET only, no app import, no status model of its own — the app answers
 * straight from queueRuntime's existing job lifecycle.
 */
import type { DnaOsConfig } from "../config.js"
import { httpGet } from "../httpClient.js"
import { resolveToolEndpoint } from "../manifestClient.js"
import { normalizeLegacyResponse, type NormalizedResult } from "../normalize.js"
import type { McpAdapterError } from "../errors.js"

export const TOOL_NAME = "contractor.status"

export interface ContractorStatusInput {
  ownerId: string
  jobId?: string
}

export async function runContractorStatus(
  config: DnaOsConfig,
  input: ContractorStatusInput,
): Promise<{ ok: true; result: NormalizedResult } | { ok: false; error: McpAdapterError }> {
  const resolved = await resolveToolEndpoint(config, TOOL_NAME)
  if (!resolved.ok) return resolved

  const query = input.jobId
    ? `?ownerId=${encodeURIComponent(input.ownerId)}&jobId=${encodeURIComponent(input.jobId)}`
    : `?ownerId=${encodeURIComponent(input.ownerId)}`
  const res = await httpGet(config, `${resolved.endpoint}${query}`)
  if (!res.ok) return res

  return {
    ok: true,
    result: normalizeLegacyResponse(res.body, {
      sourceFiles: ["app/api/admin/ide/_lib/queueRuntime.ts"],
      registryVersion: {},
      confidenceReason: "GET /api/v1/mcp/contractor/status — queueRuntime.listJobs/getJob, the existing job lifecycle.",
    }),
  }
}
