/**
 * POST /api/internal/device/commands/[cmdId] — header: x-dnaos-device-token.
 *   { op:"ack" }                          dispatched→running (+POLICY RE-CHECK
 *                                         with jobId=command; deny → cancelled)
 *   { op:"result", ok, result?, error? }  running→succeeded|failed EXACTLY
 *                                         ONCE (duplicate → no-op, returns
 *                                         stored terminal state)
 * Device auth re-checked EVERY call (revoked device → 401/403), so "ทำต่อหลัง
 * revoke" ถูกปิดทุกจุด: revoke ยกเลิก in-flight commands + status guards here.
 * Success = terminal status from this result only — never from ack/pull/health.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/queries";
import { authenticateDevice } from "@/app/api/admin/devices/_lib/deviceRegistry";
import { ackCommand, completeCommand } from "@/app/api/admin/devices/_lib/deviceCommands";

type Params = { params: Promise<{ cmdId: string }> };
const STATUS_FOR: Record<string, number> = {
  META_TABLES_MISSING: 409, SCOPE_DENIED: 403, NOT_FOUND: 404, WRONG_DEVICE: 404,
  EXPIRED: 410, CONFLICT: 409, NOT_ACKED: 409,
};

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authenticateDevice(supabaseAdmin(), req.headers.get("x-dnaos-device-token") ?? "");
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.status === 409 ? "META_TABLES_MISSING" : "UNAUTHORIZED", error: auth.error },
      { status: auth.status },
    );
  }
  const { cmdId } = await params;
  const body = (await req.json().catch(() => ({}))) as { op?: unknown; ok?: unknown; result?: Record<string, unknown>; error?: unknown };
  try {
    if (body.op === "ack") {
      const result = await ackCommand(supabaseAdmin(), cmdId, auth.device.id);
      if (!result.ok) {
        return NextResponse.json({ ok: false, code: result.code, error: result.error }, { status: STATUS_FOR[result.code] ?? 400 });
      }
      return NextResponse.json({ ok: true, already: Boolean(result.already) });
    }
    if (body.op === "result") {
      if (typeof body.ok !== "boolean") {
        return NextResponse.json({ ok: false, error: "result ต้องระบุ ok:boolean" }, { status: 400 });
      }
      const result = await completeCommand(supabaseAdmin(), cmdId, auth.device.id, {
        ok: body.ok,
        result: body.result,
        error: typeof body.error === "string" ? body.error : undefined,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, code: result.code, error: result.error }, { status: STATUS_FOR[result.code] ?? 400 });
      }
      return NextResponse.json({ ok: true, status: result.status, duplicate: Boolean(result.duplicate) });
    }
    return NextResponse.json({ ok: false, error: "op ต้องเป็น ack หรือ result" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    if (code === "META_TABLES_MISSING") return NextResponse.json({ ok: false, code, error: msg }, { status: 409 });
    console.error("[device-commands op] failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
