/**
 * POST /api/internal/device/commands { op:"pull" } — header:
 * x-dnaos-device-token. Auth = device's own token (revoked/missing account →
 * 401/403 via authenticateDevice). Returns live dispatched commands (expiry
 * enforced server-side: stale ones are flipped to failed BEFORE the handout).
 * Heartbeat (health route) never returns executable work — pull is the only
 * delivery path, so "ส่ง heartbeat" ≠ "ได้งาน" ≠ "สำเร็จ".
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/queries";
import { authenticateDevice } from "@/app/api/admin/devices/_lib/deviceRegistry";
import { pullDeviceCommands } from "@/app/api/admin/devices/_lib/deviceCommands";

export async function POST(req: NextRequest) {
  const auth = await authenticateDevice(supabaseAdmin(), req.headers.get("x-dnaos-device-token") ?? "");
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.status === 409 ? "META_TABLES_MISSING" : "UNAUTHORIZED", error: auth.error },
      { status: auth.status },
    );
  }
  try {
    const commands = await pullDeviceCommands(supabaseAdmin(), auth.device.id, 5);
    return NextResponse.json({
      ok: true,
      device_id: auth.device.id,
      grants: auth.device.grants,
      account_role: auth.accountRole,
      commands: commands.map((c) => ({
        id: c.id, command_kind: c.command_kind, payload: c.payload, expires_at: c.expires_at, attempts: c.attempts,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    if (code === "META_TABLES_MISSING") return NextResponse.json({ ok: false, code, error: msg }, { status: 409 });
    console.error("[device-commands pull] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
