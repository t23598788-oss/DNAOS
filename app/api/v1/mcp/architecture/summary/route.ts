/**
 * GET /api/v1/mcp/architecture/summary
 *
 * Public — backs the architecture.system_summary MCP tool. Returns the
 * layer stack, core/canonical principles, and authority model straight from
 * registry/CONSTITUTION.json, plus the list of layer names straight from
 * registry/dependency-graph.json's allowed_imports keys. No computation
 * beyond picking these existing fields out of the two files.
 */
import { NextResponse } from "next/server"
import constitution from "@/registry/CONSTITUTION.json"
import dependencyGraph from "@/registry/dependency-graph.json"
import { mcpEnvelope, mcpCorsHeaders } from "../../_lib/envelope"

export async function GET() {
  const body = mcpEnvelope(
    {
      system: "DNA OS",
      layer_stack: constitution.layer_architecture,
      layers: Object.keys(dependencyGraph.allowed_imports),
      core_principles: constitution.core_principles,
      canonical_principles: constitution.canonical_principles,
      authority_model: constitution.architecture_principles,
      runtime_contract: constitution.runtime_contract,
    },
    {
      source_files: ["registry/CONSTITUTION.json", "registry/dependency-graph.json"],
      registry_version: {
        constitution: constitution.version,
        dependency_graph: dependencyGraph.version,
      },
      confidence: "high",
    }
  )

  return NextResponse.json(body, { headers: mcpCorsHeaders() })
}
