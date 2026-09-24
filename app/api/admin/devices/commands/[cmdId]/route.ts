/**
 * POST /api/admin/devices/commands/[cmdId] { op: "cancel" | "requeue" }
 *  cancel  — dispatched/running → cancelled (owner stops a job; device's next
 *            ack/result hits the status guard and is refused)
 *  requeue  — failed & attempts<max → dispatched again (fresh expiry)
 * ADMIN_TIER + audit_logs both ops.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { requeueCommand } from "../../_lib/deviceCommands";

type Params = { params: Promise<{ cmdId: string }> };
const STATUS_FOR: Record<string, number> = { META_TABLES_MISSING: 409, NOT_FOUND: 404, CONFLICT: 409, RETRY_EXHAUSTED: 409 };

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { cmdId } = await params;
  const body = (await req.json().catch(() => ({}))) as { op?: unknown };
  const op = body.op;
  if (op !== "cancel" && op !== "requeue") {
    return NextResponse.json({ ok: false, error: "op ต้องเป็น cancel หรือ requeue" }, { status: 400 });
  }
  try {
    if (op === "cancel") {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabaseAdmin()
        .from("device_commands")
        .update({ status: "cancelled", error: "cancelled by admin", finished_at: nowIso, updated_at: nowIso })
        .eq("id", cmdId)
        .in("status", ["dispatched", "running"])
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        return NextResponse.json({ ok: false, code: "CONFLICT", error: "คำสั่งไม่อยู่ในสถานะ dispatched/running (อาจจบไปแล้ว/ถูกยกเลิก/ถูกเพิกถอน)" }, { status: 409 });
      }
      await supabaseAdmin().from("audit_logs").insert({
        entity_type: "device", entity_id: (data as { device_id: string }).device_id,
        action: "command_cancelled", field: cmdId, actor_user_id: auth.id,
      });
      return NextResponse.json({ ok: true, command: data });
    }
    const result = await requeueCommand(supabaseAdmin(), cmdId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, code: result.code, error: result.error }, { status: STATUS_FOR[result.code] ?? 400 });
    }
    await supabaseAdmin().from("audit_logs").insert({
      entity_type: "device", entity_id: result.command.device_id,
      action: "command_requeued", field: `${cmdId} attempt=${result.command.attempts}`, actor_user_id: auth.id,
    });
    return NextResponse.json({ ok: true, command: result.command });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    if (code === "META_TABLES_MISSING") return NextResponse.json({ ok: false, code, error: msg }, { status: 409 });
    console.error("[device-commands] op failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
