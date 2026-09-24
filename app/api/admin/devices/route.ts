/**
 * GET  /api/admin/devices — list paired devices (metadata only; token hash
 *      never leaves the server — only a has_token boolean).
 * POST /api/admin/devices { device_name } — mint a ONE-TIME pairing code for
 *      the admin to hand to the machine (plain code returned exactly once).
 * ADMIN_TIER — same guard as every /api/admin route. Device credential issued
 * here is the device's OWN token at pair time; owner/admin/service-role
 * secrets are never part of this flow (rule4).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { createPairingCode, loadDevices } from "./_lib/deviceRegistry";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  try {
    const { rows, migrated } = await loadDevices(supabaseAdmin());
    return NextResponse.json({
      ok: true,
      migrated,
      devices: rows.map((d) => {
        const { device_token_hash: _hash, ...rest } = d;
        return { ...rest, has_token: Boolean(d.device_token_hash) };
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[devices] list failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await req.json().catch(() => ({}))) as { device_name?: unknown };
    const deviceName = typeof body.device_name === "string" ? body.device_name : "";
    const result = await createPairingCode(supabaseAdmin(), {
      deviceName,
      requestedBy: { id: auth.id, email: auth.email, role: auth.role },
    });
    // audit_logs — pairing request by this admin (no secret material logged)
    await supabaseAdmin().from("audit_logs").insert({
      entity_type: "device",
      entity_id: result.device.id,
      action: "pairing_requested",
      field: result.device.device_name,
      actor_user_id: auth.id,
    });
    return NextResponse.json({
      ok: true,
      device_id: result.device.id,
      code: result.code, // shown ONCE — only its sha256 is stored
      expires_at: result.expiresAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    if (code === "INVALID_DEVICE_NAME") return NextResponse.json({ ok: false, code, error: msg }, { status: 400 });
    if (code === "META_TABLES_MISSING") return NextResponse.json({ ok: false, code, error: msg }, { status: 409 });
    console.error("[devices] create pairing code failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
