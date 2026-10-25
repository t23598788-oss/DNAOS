import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import type { DnaOsConfig } from "./config.js"
import { governanceGet, governancePost, type GovernanceResult } from "./governanceHttp.js"

const BASE = "/api/v1/mcp/governance"

export function createGovernanceMcpServer(config: DnaOsConfig): Server {
  const server = new Server({ name: "dna-os-governance-mcp", version: "0.1.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    { name: "governance.read_status", description: "Read governance sessions, evidence, impact checks and pending proposals.", inputSchema: { type: "object", properties: {}, required: [] } },
    { name: "governance.propose_session", description: "Create a session proposal only. Server binds owner from the DNA OS token; no action is executed.", inputSchema: { type: "object", properties: { goal: { type: "string" }, file_scope: { type: "array", items: { type: "string" } } }, required: ["goal", "file_scope"] } },
    { name: "governance.propose_registry_patch", description: "Submit a pending registry patch proposal only, linked to an existing session/evidence/check.", inputSchema: { type: "object", properties: { session_id: { type: "string" }, evidence_event_id: { type: "string" }, check_result_id: { type: "string" }, path: { type: "string" }, patch: { type: "object" } }, required: ["session_id", "evidence_event_id", "check_result_id", "path", "patch"] } },
    { name: "governance.read_impact", description: "Read impact analysis linked to one evidence event.", inputSchema: { type: "object", properties: { evidence_event_id: { type: "string" } }, required: ["evidence_event_id"] } },
    { name: "governance.read_deploy_approval_status", description: "Read blocking evidence and pending human approvals. Never deploys or approves.", inputSchema: { type: "object", properties: {}, required: [] } },
  ] }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    try {
      let result: GovernanceResult
      switch (request.params.name) {
        case "governance.read_status": result = await governanceGet(config, `${BASE}/status`); break
        case "governance.propose_session": result = await governancePost(config, `${BASE}/session-proposals`, { goal: args.goal, file_scope: args.file_scope }); break
        case "governance.propose_registry_patch": result = await governancePost(config, `${BASE}/registry-proposals`, args); break
        case "governance.read_impact": result = await governanceGet(config, `${BASE}/impact/${encodeURIComponent(String(args.evidence_event_id ?? ""))}`); break
        case "governance.read_deploy_approval_status": result = await governanceGet(config, `${BASE}/deploy-approval-status`); break
        default: return { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "BAD_REQUEST", message: `Unknown governance tool: ${request.params.name}` }) }] }
      }
      return { content: [{ type: "text", text: JSON.stringify(result.body, null, 2) }] }
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "GOVERNANCE_GATEWAY_ERROR", message: error instanceof Error ? error.message : String(error) }) }] }
    }
  })
  return server
}
