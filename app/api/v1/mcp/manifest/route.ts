/**
 * GET /api/v1/mcp/manifest
 *
 * Public — MCP client discovery endpoint. Returns the same tool-name →
 * endpoint mapping declared in registry/mcp-planned-manifest.json, plus the
 * resource declared in registry/mcp-resource-registry.json. Pure passthrough
 * of those two JSON files — this route does not decide which tools exist,
 * the registry files do.
 */
import { NextResponse } from "next/server"
import plannedManifest from "@/registry/mcp-planned-manifest.json"
import resourceRegistry from "@/registry/mcp-resource-registry.json"
import { mcpEnvelope, mcpCorsHeaders } from "../_lib/envelope"

export async function GET() {
  const body = mcpEnvelope(
    {
      schema_version: "1.0",
      system: "DNA OS",
      tools: plannedManifest.tools,
      resources: resourceRegistry.resources,
    },
    {
      source_files: [
        "registry/mcp-planned-manifest.json",
        "registry/mcp-resource-registry.json",
      ],
      registry_version: {
        mcp_planned_manifest: plannedManifest.version,
        mcp_resource_registry: resourceRegistry.version,
      },
      confidence: "high",
    }
  )

  return NextResponse.json(body, { headers: mcpCorsHeaders() })
}
