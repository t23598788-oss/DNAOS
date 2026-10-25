/**
 * GET /api/v1/capabilities
 * Public — returns existence.json (what DNA OS can/cannot do)
 *
 * Core chain wiring (P1): the frozen Capability Registry and the existing
 * Capability Composer (core/workspace/composer, Phase 7.5) — which until now
 * was reachable only from inside its own directory — are reachable from the
 * Core execution chain through this route.
 *   ?resolve=<capability.id>,<capability.id>   -> real CompositionPlan
 *   (no query)                                 -> registry summary + existence.json
 * Nothing is resolved here: composerResolver / capabilityComposer do the work
 * and capabilityRegistryAccess is the only reader of the registry file.
 */
import { NextRequest, NextResponse } from "next/server"
import existenceRegistry from "@/registry/existence.json"
import { capabilityRegistryAccess, composerResolver } from "@/core/workspace/composer"

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" }
}

export async function GET(req: NextRequest) {
  const requestedIds = (req.nextUrl.searchParams.get("resolve") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  const compositionPlan =
    requestedIds.length > 0
      ? composerResolver.resolve({
          applicationId: req.nextUrl.searchParams.get("application_id") ?? "api.v1.capabilities",
          workspaceId: req.nextUrl.searchParams.get("workspace_id") ?? "default",
          name: "api.v1.capabilities",
          capabilityIds: requestedIds,
        })
      : null

  return NextResponse.json(
    {
      schema_version: "1.0",
      source: "registry/existence.json",
      ...(existenceRegistry as any),
      capability_registry: {
        source: "registry/capability-registry.json",
        version: capabilityRegistryAccess.version,
        checksum: capabilityRegistryAccess.checksum,
        resolution_entrypoint: "core/workspace/composer (composerResolver -> capabilityComposer)",
      },
      composition_plan: compositionPlan,
    },
    { headers: corsHeaders() }
  )
}
