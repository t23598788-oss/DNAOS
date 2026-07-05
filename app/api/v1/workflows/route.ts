/**
 * GET /api/v1/workflows
 * Public — returns workflow-registry.json
 */
import { NextResponse } from "next/server"
import workflowRegistry from "@/07-workflow-registry.json"

export async function GET() {
  return NextResponse.json(
    {
      schema_version: "1.0",
      source: "07-workflow-registry.json",
      ...(workflowRegistry as any),
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } }
  )
}
