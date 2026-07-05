/**
 * GET /api/v1/capabilities
 * Public — returns existence.json (what DNA OS can/cannot do)
 */
import { NextResponse } from "next/server"
import existenceRegistry from "@/lib/registry/existence.json"

export async function GET() {
  return NextResponse.json(
    {
      schema_version: "1.0",
      source: "lib/registry/existence.json",
      ...(existenceRegistry as any),
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } }
  )
}
