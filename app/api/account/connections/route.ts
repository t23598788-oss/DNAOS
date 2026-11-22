import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { supabaseAdmin } from "@/services/supabase/queries";
import { EXTERNAL_SERVICE_CATALOG } from "@/registry/external-service-catalog";

export const dynamic = "force-dynamic";

/** Return the public catalog and only the signed-in user's connection metadata. */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await supabaseAdmin()
    .from("user_provider_connections")
    .select("id, owner_user_id, provider_id, connection_method, external_account_id, account_label, granted_scopes, status, last_verified_at, last_error_code, created_at, updated_at")
    .eq("owner_user_id", auth.id)
    .order("created_at", { ascending: false });

  if (error) {
    const missing = error.code === "PGRST205" || /Could not find the table|schema cache|does not exist/i.test(error.message);
    return NextResponse.json(
      { ok: false, code: missing ? "USER_CONNECTIONS_NOT_MIGRATED" : "USER_CONNECTIONS_READ_FAILED" },
      { status: missing ? 503 : 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  return NextResponse.json({
    ok: true,
    catalog: EXTERNAL_SERVICE_CATALOG,
    connections: (data ?? []).map(({ owner_user_id: _owner, ...connection }) => connection),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
