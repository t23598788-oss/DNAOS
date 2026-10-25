/**
 * contractor.evidence.submit — contractor result/evidence intake over MCP
 * (NEW-1; App-side half is app/api/v1/mcp/contractor/evidence-submit/route.ts).
 *
 * PROTOCOL ADAPTER ONLY (registry/dependency-graph.json → notes.mcp_isolation):
 * no import from the DNA OS app/engines/services/core, and the WorkerResponse
 * type is never copied — the tool forwards plain JSON and the app side validates
 * it against the Universal Worker Contract.
 */
import type { DnaOsConfig } from "../config.js"
import { httpPost } from "../httpClient.js"
import { resolveToolEndpoint } from "../manifestClient.js"
import { normalizeLegacyResponse, type NormalizedResult } from "../normalize.js"
import type { McpAdapterError } from "../errors.js"

export const TOOL_NAME = "contractor.evidence.submit"

export interface ContractorEvidenceSubmitInput {
  ownerId: string
  jobId: string
  workerResponse: {
    status: string
    output?: string | null
    error?: string | null
    evidence?: string[]
  }
  evidenceRefs?: { kind: "DECISION" | "PROBLEM"; refId: string }[]
}

export async function runContractorEvidenceSubmit(
  config: DnaOsConfig,
  input: ContractorEvidenceSubmitInput,
): Promise<{ ok: true; result: NormalizedResult } | { ok: false; error: McpAdapterError }> {
  const resolved = await resolveToolEndpoint(config, TOOL_NAME)
  if (!resolved.ok) return resolved

  // withToken: true — the app-side route authenticates with the DNA OS API token
  const res = await httpPost(config, resolved.endpoint, input, { withToken: true })
  if (!res.ok) return res

  return {
    ok: true,
    result: normalizeLegacyResponse(res.body, {
      sourceFiles: ["app/api/v1/mcp/contractor/evidence-submit/route.ts"],
      registryVersion: {},
      confidenceReason: "POST /api/v1/mcp/contractor/evidence-submit — evidence refs are verified by changeSetRuntime and the queue job is finalized by queueRuntime; nothing is applied here.",
    }),
  }
}
