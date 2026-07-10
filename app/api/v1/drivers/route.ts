/**
 * GET /api/v1/drivers
 * Public — returns drivers.json (hardware/platform connectors DNA OS controls)
 */
import { NextResponse } from "next/server"
import driversRegistry from "@/registry/drivers.json"

export async function GET() {
  return NextResponse.json(
    {
      schema_version: "1.0",
      source: "registry/drivers.json",
      description: "Hardware and platform drivers that DNA OS can control via V6-Executor",
      ...(driversRegistry as any),
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } }
  )
}
