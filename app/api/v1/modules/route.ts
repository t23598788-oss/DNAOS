/**
 * GET /api/v1/modules
 * Public — returns module-registry.json
 */
import { NextResponse } from "next/server"
import moduleRegistry from "@/lib/registry/module-registry.json"

export async function GET() {
  const modules = Object.entries(moduleRegistry.modules)
    .filter(([k]) => !k.startsWith("_"))
    .map(([path, m]: [string, any]) => ({
      path,
      owner: m.owner,
      layer: m.layer,
      purpose_th: m.purpose_th ?? m.purpose,
      exports: m.exports ?? [],
      status: m.status ?? "active",
      access: m.access,
    }))

  return NextResponse.json(
    {
      schema_version: "1.0",
      source: "lib/registry/module-registry.json",
      total: modules.length,
      modules,
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } }
  )
}
