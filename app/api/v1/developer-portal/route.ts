/**
 * GET /api/v1/developer-portal
 *
 * Machine-readable export of the DNA OS Developer Portal spec. AI agents and
 * connector builders read this endpoint to discover every documented endpoint,
 * its request schema, sample payloads and verification steps — the same data
 * the human portal at /admin/docs renders, from registry/developer-portal-spec.ts.
 *
 * Public, read-only, cacheable for 5 minutes.
 */
import { NextResponse } from "next/server";
import {
  CATEGORIES,
  DOCS,
  ENDPOINT_INDEX,
  PORTAL_SPEC_VERSION,
} from "@/registry/developer-portal-spec";

export async function GET() {
  return NextResponse.json(
    {
      schema_version: PORTAL_SPEC_VERSION,
      system: "DNA OS",
      source: "registry/developer-portal-spec.ts",
      human_portal: "/admin/docs",
      related: {
        tool_spec: "/api/v1/spec",
        modules: "/api/v1/modules",
        capabilities: "/api/v1/capabilities",
        constitution: "/api/v1/constitution",
      },
      categories: CATEGORIES,
      endpoints: ENDPOINT_INDEX,
      docs: DOCS,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
