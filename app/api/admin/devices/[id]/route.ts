/**
 * DELETE /api/admin/devices/[id] — REVOKE a device: token stops
 * authenticating immediately (status='revoked', hash kept for audit only).
 * The admin who revokes is recorded in audit_logs. ADMIN_TIER.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { revokeDevice } from "../_lib/deviceRegistry";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    await revokeDevice(supabaseAdmin(), id);
    await supabaseAdmin().from("audit_logs").insert({
      entity_type: "device",
      entity_id: id,
      action: "revoked",
      actor_user_id: auth.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    if (code === "META_TABLES_MISSING") return NextResponse.json({ ok: false, code, error: msg }, { status: 409 });
    console.error("[devices] revoke failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
