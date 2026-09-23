/**
 * contractor.task.claim — contractor task intake over MCP (NEW-1, App-side half
 * is app/api/v1/mcp/contractor/task-claim/route.ts).
 *
 * PROTOCOL ADAPTER ONLY (registry/dependency-graph.json → notes.mcp_isolation):
 * this file imports nothing from the DNA OS app, engines, services or core. It
 * resolves its endpoint by NAME from the live manifest and posts to it. The
 * Universal Worker Contract types live in the app (workerContract.ts) and are
 * never copied here — the payload the tool receives/sends is plain JSON.
 */
import type { DnaOsConfig } from "../config.js"
import { httpPost } from "../httpClient.js"
import { resolveToolEndpoint } from "../manifestClient.js"
import { normalizeLegacyResponse, type NormalizedResult } from "../normalize.js"
import type { McpAdapterError } from "../errors.js"

export const TOOL_NAME = "contractor.task.claim"

export interface ContractorTaskClaimInput {
  ownerId: string
  capabilityRequired: string
  taskDescription: string
  acceptanceCriteria?: string[]
  permittedReadScope?: string[]
  permittedWriteScope?: string[]
  permittedTools?: string[]
  forbiddenTools?: string[]
}

export async function runContractorTaskClaim(
  config: DnaOsConfig,
  input: ContractorTaskClaimInput,
): Promise<{ ok: true; result: NormalizedResult } | { ok: false; error: McpAdapterError }> {
  const resolved = await resolveToolEndpoint(config, TOOL_NAME)
  if (!resolved.ok) return resolved

  // withToken: true — the app-side route authenticates with the DNA OS API token
  const res = await httpPost(config, resolved.endpoint, input, { withToken: true })
  if (!res.ok) return res

  return {
    ok: true,
    result: normalizeLegacyResponse(res.body, {
      sourceFiles: ["app/api/v1/mcp/contractor/task-claim/route.ts"],
      registryVersion: {},
      confidenceReason: "POST /api/v1/mcp/contractor/task-claim — the route builds a real JobContract via workerTaskOrchestrator and a queue job via queueRuntime.",
    }),
  }
}
