/**
 * GET /api/v1/developer-portal
 *
 * Machine-readable export of the DNA OS Developer Portal spec. AI agents and
 * connector builders read this endpoint to discover every documented endpoint,
 * its request schema, sample payloads and verification steps — the same data
 * the human portal at /admin/docs renders, from two real registries:
 * registry/developer-portal-spec.ts (endpoint contracts) and
 * registry/integration-portal-spec.ts (settings + end-to-end pipelines, where
 * every stage cites the file that enforces it).
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
import {
  FLOW_PIPELINES,
  PORTAL_STORY_VERSION,
  SECTION_KINDS,
  STORY_NAV,
} from "@/registry/integration-portal-spec";

export async function GET() {
  return NextResponse.json(
    {
      schema_version: PORTAL_SPEC_VERSION,
      journey_version: PORTAL_STORY_VERSION,
      system: "DNA OS",
      source: "registry/developer-portal-spec.ts",
      journey_source: "registry/integration-portal-spec.ts",
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
      journey: {
        sections: STORY_NAV,
        section_kinds: SECTION_KINDS,
        pipelines: FLOW_PIPELINES,
      },
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
