/**
 * GET /api/admin/workspace/database — Database tool's real data source
 * (Integrated Development Workspace shell, owner, 2026-08-05).
 *   - tables: SUPABASE_TABLES from config/system-links.ts (real, actively
 *     maintained — grepped from real .from() calls across the codebase,
 *     not a second registry).
 *   - connection: latest database.health.observed evidence from
 *     integration_gateway_events (real, written by
 *     engines/integration-gateway/adapters/supabase.ts).
 *   - column-level schema browsing: honestly NOT_IMPLEMENTED — would
 *     require a new information_schema RPC (a real backend change), not
 *     built here per "ห้ามเปลี่ยนโครงสร้าง Backend โดยไม่จำเป็น". Real column
 *     detail is already reachable at /admin/schema-audit's schema_change_log
 *     (DDL history), which this route also surfaces a link into.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { SUPABASE_TABLES } from "@/config/system-links";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const db = supabaseAdmin();
  const { data: healthEvents } = await db
    .from("integration_gateway_events")
    .select("evidence, occurred_at")
    .eq("provider", "supabase")
    .eq("capability", "database.health.observed")
    .order("occurred_at", { ascending: false })
    .limit(1);

  return NextResponse.json({
    tables: SUPABASE_TABLES,
    connection: healthEvents?.[0]
      ? { ...(healthEvents[0].evidence as object), checked_at: healthEvents[0].occurred_at }
      : { status: "UNKNOWN", reason: "no database.health.observed event yet — run npm run gateway:observe:supabase" },
    column_schema: { status: "NOT_IMPLEMENTED", reason: "requires a new information_schema RPC — see /admin/schema-audit for real DDL change history instead" },
  });
}
