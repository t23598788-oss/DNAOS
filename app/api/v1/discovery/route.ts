import { NextRequest, NextResponse } from "next/server"
import capabilityRegistry from "@/registry/capability-registry.json"
import commandRegistry from "@/registry/command-registry.json"
import { authenticate } from "@/app/api/v1/mcp/governance/_lib/auth"
import { getApiTokenCallerProfile, MissingServiceRoleKeyError } from "@/services/supabase/api-tokens"
import permissions from "@/registry/permissions.json"
import { buildReadOnlyToolSpec, type ApiCommandDefinition } from "@/app/api/v1/_lib/tool-spec"

type CapabilityDefinition = {
  CapabilityId: string
  OwnerModule: string
  ExportName: string
  Category: string
  Description: string
  Version: string
  InputContract: string
  OutputContract: string
  ExecutionType: string
  Mutability: string
  StatePolicy: string
  Dependencies: string[]
  Tags: string[]
  Status: string
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-DNA-Token",
  "Vary": "Origin",
  "Cache-Control": "private, no-store",
}

function withCors(response: NextResponse): NextResponse {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value)
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function ownerKey(value: string): string {
  return value.replace(/\\/g, "/").replace(/\.ts$/, "").trim()
}

function readOnlyCommandsByOwner(): Map<string, string[]> {
  const commands = (commandRegistry as { commands: Record<string, ApiCommandDefinition> }).commands
  const result = new Map<string, string[]>()
  for (const [name, definition] of Object.entries(commands)) {
    if (name.startsWith("_") || (definition.status ?? "active") !== "active" || definition.requires_confirmation) continue
    const key = ownerKey(definition.owner)
    const list = result.get(key) ?? []
    list.push(name)
    result.set(key, list)
  }
  return result
}

function openApiDocument(tools: ReturnType<typeof buildReadOnlyToolSpec>) {
  const requests = tools.map(({ function: tool }) => ({
    type: "object",
    properties: {
      command: { type: "string", const: tool._dna_command },
      args: tool.parameters,
    },
    required: Array.isArray(tool.parameters.required) && tool.parameters.required.length > 0
      ? ["command", "args"]
      : ["command"],
    additionalProperties: false,
  }))

  return {
    openapi: "3.1.0",
    info: {
      title: "DNA OS External Read API",
      version: String(capabilityRegistry.version),
      description: "Generated from the repository command and capability registries. Mutating execution is disabled.",
    },
    paths: {
      "/api/v1/discovery": {
        get: {
          operationId: "discoverDnaOsCapabilities",
          summary: "Discover registered capabilities and read-only entry points",
          security: [{ DnaOsToken: [] }],
          responses: { "200": { description: "Capability catalog and generated contracts" }, "401": { description: "Missing or invalid DNA OS token" }, "403": { description: "Token lacks read scope" } },
        },
      },
      "/api/v1/query": {
        post: {
          operationId: "queryDnaOs",
          summary: "Run one registered read-only command",
          security: [{ DnaOsToken: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: requests.length ? { oneOf: requests } : { type: "object" } } },
          },
          responses: { "200": { description: "Command result" }, "400": { description: "Unknown or invalid command" }, "401": { description: "Missing or invalid DNA OS token" }, "403": { description: "Read scope or command permission required" } },
        },
      },
    },
    components: {
      securitySchemes: { DnaOsToken: { type: "apiKey", in: "header", name: "X-DNA-Token" } },
    },
    "x-dna-tool-spec": tools,
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

export async function GET(req: NextRequest) {
  let auth: Awaited<ReturnType<typeof authenticate>>
  try {
    auth = await authenticate(req, "read")
  } catch (error) {
    if (error instanceof MissingServiceRoleKeyError) {
      return NextResponse.json({ ok: false, error: "DNA OS token service is not configured" }, { status: 503, headers: corsHeaders })
    }
    throw error
  }
  if (!auth.ok) return withCors(auth.response)

  // Match /api/v1/query's live authorization rule so discovery never tells an
  // agent that query commands are available to a token whose account has lost
  // the required admin-tier membership.
  let callerProfile: { id: string; role: string | null } | null
  try {
    callerProfile = await getApiTokenCallerProfile(auth.token.user_email)
  } catch (error) {
    if (error instanceof MissingServiceRoleKeyError) {
      return NextResponse.json({ ok: false, error: "DNA OS token service is not configured" }, { status: 503, headers: corsHeaders })
    }
    throw error
  }
  const adminTier = (permissions.role_tiers as { admin_tier: string[] }).admin_tier
  if (!callerProfile?.role || !adminTier.includes(callerProfile.role)) {
    return NextResponse.json({ ok: false, error: "An active admin-tier account is required" }, { status: 403, headers: corsHeaders })
  }

  const capabilities = capabilityRegistry.capabilities as CapabilityDefinition[]
  const commandsByOwner = readOnlyCommandsByOwner()
  const entries = capabilities.map((capability) => {
    const linkedCommands = commandsByOwner.get(ownerKey(capability.OwnerModule)) ?? []
    const queryAvailable = capability.Status === "active" && capability.Mutability === "readOnly" && linkedCommands.length > 0
    return {
      id: capability.CapabilityId,
      name: capability.ExportName,
      category: capability.Category,
      description: capability.Description,
      owner_module: capability.OwnerModule,
      version: capability.Version,
      input_contract: capability.InputContract,
      output_contract: capability.OutputContract,
      execution_type: capability.ExecutionType,
      mutability: capability.Mutability,
      dependencies: capability.Dependencies,
      tags: capability.Tags,
      registry_status: capability.Status,
      availability: queryAvailable ? "read_query_linked" : "catalog_only",
      callable_via: queryAvailable ? "/api/v1/query" : null,
      linked_read_commands: linkedCommands,
      linkage_basis: linkedCommands.length ? "owner_module_match_not_direct_export_binding" : null,
      execute_enabled: false,
    }
  })

  const tools = buildReadOnlyToolSpec()
  const apiSpec = openApiDocument(tools)
  const counts = entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.availability] = (acc[entry.availability] ?? 0) + 1
    return acc
  }, {})

  return NextResponse.json({
    schema_version: "1.0.0",
    service: "DNA OS",
    service_role: "Economic & Operational Control Plane",
    generated_at: new Date().toISOString(),
    authentication: {
      required: true,
      scheme: "X-DNA-Token",
      token_issuer: "/admin/api-tokens",
      required_scope: "read",
      required_account_role: "admin-tier (same authorization required by /api/v1/query)",
      identity_model: "account-bound, revocable DNA OS API token",
      shared_family_secret: false,
      note: "Uses the existing DNA OS API token and scope system; each connecting agent must be issued an account-bound token. No new shared secret is introduced.",
    },
    channels: {
      discovery: { enabled: true, method: "GET", path: "/api/v1/discovery" },
      observe: { enabled: true, method: "POST", path: "/api/v1/query", constraint: "read-only commands only" },
      execute: { enabled: false, reason: "execution channel remains closed" },
    },
    registry: {
      source: "registry/capability-registry.json",
      version: capabilityRegistry.version,
      checksum: capabilityRegistry.checksum,
      frozen: capabilityRegistry.frozen,
      generated_at: capabilityRegistry.generatedAt,
      declared_count: capabilityRegistry.capabilityCount,
      returned_count: entries.length,
      availability_counts: counts,
    },
    endpoints: {
      discovery: "/api/v1/discovery",
      read_query: "/api/v1/query",
      generated_tool_contract: "/api/v1/spec",
      existing_capability_catalog: "/api/v1/capabilities",
    },
    api_spec: apiSpec,
    capabilities: entries,
  }, { headers: corsHeaders })
}
