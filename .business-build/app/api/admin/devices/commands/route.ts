/**
 * GET  /api/admin/devices/commands — latest command rows (owner view: งานใดกำลังทำ).
 * POST /api/admin/devices/commands {device_id, command_kind, payload?, idempotency_key?, ttl_seconds?}
 *      — dispatch AFTER deny-by-default scope check (core/policy/scope) with
 *        idempotent submit-by-key. ADMIN_TIER + audit_logs. heartbeat ไม่นับเป็นผล.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { createDeviceCommand } from "../_lib/deviceCommands";

const STATUS_FOR: Record<string, number> = {
  META_TABLES_MISSING: 409, KIND_UNKNOWN: 400, DEVICE_NOT_FOUND: 404,
  DEVICE_REVOKED: 403, SCOPE_DENIED: 403,
};

function errStatus(code: string): number {
  return STATUS_FOR[code] ?? 500;
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  try {
    const { data, error } = await supabaseAdmin()
      .from("device_commands")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const { data: devices } = await supabaseAdmin().from("device_registry").select("id, device_name");
    const nameOf = new Map((devices ?? []).map((d: { id: string; device_name: string }) => [d.id, d.device_name]));
    return NextResponse.json({
      ok: true,
      commands: ((data ?? []) as Record<string, unknown>[]).map((c) => ({ ...c, device_name: nameOf.get(c.device_id as string) ?? "?" })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    if (code === "META_TABLES_MISSING") return NextResponse.json({ ok: false, code, error: msg }, { status: 409 });
    console.error("[device-commands] list failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      device_id?: unknown; command_kind?: unknown; payload?: Record<string, unknown>; idempotency_key?: unknown; ttl_seconds?: unknown;
    };
    const deviceId = typeof body.device_id === "string" ? body.device_id : "";
    const kind = typeof body.command_kind === "string" ? body.command_kind : "";
    const key = typeof body.idempotency_key === "string" && body.idempotency_key ? body.idempotency_key : `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    if (!deviceId || !kind) {
      return NextResponse.json({ ok: false, code: "INVALID_REQUEST", error: "ต้องระบุ device_id และ command_kind" }, { status: 400 });
    }
    const result = await createDeviceCommand(supabaseAdmin(), {
      deviceId,
      kind,
      payload: body.payload ?? {},
      idempotencyKey: key,
      createdBy: auth.id,
      ttlSeconds: typeof body.ttl_seconds === "number" ? body.ttl_seconds : undefined,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, code: result.code, error: result.error }, { status: errStatus(result.code) });
    }
    await supabaseAdmin().from("audit_logs").insert({
      entity_type: "device",
      entity_id: deviceId,
      action: "command_dispatched",
      field: `${kind}${result.created ? "" : " (idempotent-duplicate)"}`,
      actor_user_id: auth.id,
    });
    return NextResponse.json({ ok: true, command: result.command, created: result.created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    if (code === "META_TABLES_MISSING") return NextResponse.json({ ok: false, code, error: msg }, { status: 409 });
    console.error("[device-commands] create failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
