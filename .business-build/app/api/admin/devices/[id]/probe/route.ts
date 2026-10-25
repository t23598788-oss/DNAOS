/**
 * POST /api/admin/devices/[id]/probe { kind } — queue a server→device command.
 * Allowlisted kinds only (DEVICE_COMMANDS = ['probe_printers']) — there is no
 * free-form command channel in either direction (rule5: ไม่เปิดช่องรับ
 * shell). The device picks the command up on its next health heartbeat.
 * ADMIN_TIER + audit_logs.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { DEVICE_COMMANDS, queueDeviceProbe, type DeviceCommand } from "../../_lib/deviceRegistry";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { kind?: unknown };
  const kind = body.kind;
  if (typeof kind !== "string" || !(DEVICE_COMMANDS as readonly string[]).includes(kind)) {
    return NextResponse.json(
      { ok: false, code: "COMMAND_NOT_ALLOWED", error: `kind ต้องเป็นหนึ่งใน: ${DEVICE_COMMANDS.join(", ")}` },
      { status: 400 },
    );
  }
  try {
    const device = await queueDeviceProbe(supabaseAdmin(), id, kind as DeviceCommand);
    await supabaseAdmin().from("audit_logs").insert({
      entity_type: "device",
      entity_id: id,
      action: "probe_queued",
      field: kind,
      actor_user_id: auth.id,
    });
    return NextResponse.json({ ok: true, pending_probe: device.pending_probe, last_seen_at: device.last_seen_at });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    if (code === "META_TABLES_MISSING") return NextResponse.json({ ok: false, code, error: msg }, { status: 409 });
    if (code === "DEVICE_NOT_FOUND") return NextResponse.json({ ok: false, code, error: msg }, { status: 404 });
    console.error("[devices] probe queue failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
