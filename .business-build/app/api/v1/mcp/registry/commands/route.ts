/**
 * GET /api/v1/mcp/registry/commands
 *
 * Public — backs the registry.list_commands MCP tool. Returns the raw
 * registry/command-registry.json listing (name, owner, layer, input, output,
 * description, requires_confirmation, status) for every non-internal entry.
 *
 * Distinct from GET /api/v1/spec on purpose: /api/v1/spec reshapes commands
 * into OpenAI/Claude tool-use function schemas for direct LLM tool-calling
 * and drops requires_confirmation:true commands entirely. This route is a
 * plain registry browse for MCP clients — it keeps requires_confirmation
 * and status visible as information rather than filtering commands out,
 * since listing that a write command exists is not itself an execution.
 */
import { NextResponse } from "next/server"
import commandRegistry from "@/registry/command-registry.json"
import { getCommandSurface } from "@/engines/validation/dispatcher"
import { mcpEnvelope, mcpCorsHeaders } from "../../_lib/envelope"

interface CommandEntry {
  owner: string
  layer: string
  input?: Record<string, string>
  output?: string
  description?: string
  description_th?: string
  requires_confirmation?: boolean
  status?: string
}

export async function GET() {
  const commands = Object.entries(commandRegistry.commands)
    .filter(([key]) => !key.startsWith("_"))
    .map(([name, def]) => {
      const d = def as CommandEntry
      return {
        name,
        owner: d.owner,
        layer: d.layer,
        input: d.input ?? {},
        output: d.output ?? "unknown",
        description: d.description_th ?? d.description ?? "",
        requires_confirmation: Boolean(d.requires_confirmation),
        status: d.status ?? "active",
        surface: getCommandSurface(name),
      }
    })

  const body = mcpEnvelope(
    { total: commands.length, commands },
    {
      source_files: ["registry/command-registry.json"],
      registry_version: { command_registry: commandRegistry.version },
      confidence: "high",
    }
  )

  return NextResponse.json(body, { headers: mcpCorsHeaders() })
}
