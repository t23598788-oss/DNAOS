/**
 * GET /api/v1/mcp/architecture/dependency-graph
 *
 * Public — backs the architecture.get_dependency_graph MCP tool. Returns
 * registry/dependency-graph.json's allowed_imports and notes verbatim.
 */
import { NextResponse } from "next/server"
import dependencyGraph from "@/registry/dependency-graph.json"
import { mcpEnvelope, mcpCorsHeaders } from "../../_lib/envelope"

export async function GET() {
  const body = mcpEnvelope(
    {
      allowed_imports: dependencyGraph.allowed_imports,
      notes: dependencyGraph.notes,
      policy: dependencyGraph.policy,
    },
    {
      source_files: ["registry/dependency-graph.json"],
      registry_version: { dependency_graph: dependencyGraph.version },
      confidence: "high",
    }
  )

  return NextResponse.json(body, { headers: mcpCorsHeaders() })
}
