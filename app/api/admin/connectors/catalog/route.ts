/**
 * GET /api/admin/connectors/catalog — real, merged Connector Catalog
 * (DB connectors + AI Worker Adapter Registry + Integration Gateway
 * adapters) for the /admin/connectors 3-pane UI. Read-only, no live/
 * costed calls — see app/api/admin/connectors/_lib/catalog.ts.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { buildConnectorCatalog, groupByFamily } from "../_lib/catalog";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const catalog = await buildConnectorCatalog();
  return NextResponse.json({ catalog, groups: groupByFamily(catalog) });
}