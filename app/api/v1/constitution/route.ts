/**
 * GET /api/v1/constitution
 * Public — returns registry/CONSTITUTION.json, the real, current source of
 * truth for DNA OS's Iron Rules + design principles.
 *
 * Fixed 2026-07-14 (registry/existence.json known_mistakes KM-003,
 * registry/CHANGELOG.json DNA-000033): this route previously hardcoded its
 * own separate copy of the Constitution as a literal object in this file —
 * a second, undeclared duplicate of registry/CONSTITUTION.json (the exact
 * pattern Rule 101 forbids) that had drifted stale, still using pre-reorg
 * "V2"/"V3"/"V5"/"V6" layer terminology CLAUDE.md explicitly forbids in new
 * code, and missing every rule added since (including Rules 100, 101, 102 —
 * the very rules that led to this fix). Now reads the real file directly;
 * no separate copy is maintained here to drift again.
 *
 * Schema note: registry/CONSTITUTION.json's iron_rules is a flat array of
 * free-text rule strings (each may embed its own "Rule N" reference), not
 * the old id/category/severity/rule_en/rule_th structure this route used to
 * fabricate — that structured breakdown doesn't exist in the real registry,
 * so it is not reconstructed here rather than guessed.
 */
import { NextResponse } from "next/server"
import constitution from "@/registry/CONSTITUTION.json"

export async function GET() {
  return NextResponse.json(
    {
      schema_version: "1.0",
      system: "DNA OS",
      source: "registry/CONSTITUTION.json",
      ...(constitution as Record<string, unknown>),
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } }
  )
}
