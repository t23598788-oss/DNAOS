/**
 * GET /api/v1/workflows
 * Public — returns registry/commands/workflows.json (the real Workflow
 * Registry, read live by core/executor/engine.ts).
 *
 * Fixed 2026-07-14 (registry/existence.json known_mistakes KM-003,
 * registry/CHANGELOG.json DNA-000033): this route previously imported the
 * stale, pre-reorg 07-workflow-registry.json — a root-level file with zero
 * other real references anywhere in the codebase, describing a different,
 * older workflow model (business-process narratives with "v3-engines"/
 * "v4-ai"/"v5-presenter" step names that stopped existing at the 2026-07-06
 * folder reorg). It was serving stale, wrong data to a public, external-
 * facing endpoint. Now reads the real file.
 */
import { NextResponse } from "next/server"
import workflowRegistry from "@/registry/commands/workflows.json"

export async function GET() {
  const workflows = workflowRegistry as Record<string, unknown>
  return NextResponse.json(
    {
      schema_version: "1.0",
      source: "registry/commands/workflows.json",
      total: Object.keys(workflows).length,
      workflows,
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } }
  )
}
