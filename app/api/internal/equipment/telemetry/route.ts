import { NextResponse } from "next/server"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { accumulateEngineHours } from "@/engines/equipment/engine-hours"

// Equipment GPS/Relay — Telemetry Ingestion (owner spec 2026-07-24,
// implemented 2026-08-04). Same internal-bridge auth pattern as
// app/api/internal/line/document-artifact/route.ts: a bearer secret header,
// not requireAuth (this is called by hardware/gateway infrastructure, not a
// logged-in admin).
//
// WIRE FORMAT — genuinely provider-agnostic, per Rule 108 (no silent
// config override / no fabricated hardware protocol). The doc
// (docs/equipment-maintenance-lock-module.md) specifies the SIGNAL
// (VCC >= 13.5V means engine running) but no hardware/SMS-gateway provider
// has been chosen yet, so no vendor-specific payload shape exists to
// implement against. This route accepts a reasonable generic JSON body and
// derives engine_running itself so the 13.5V threshold lives in one place,
// not duplicated per-provider:
//   { imei: string, vccVoltage: number, recordedAt?: string (ISO, defaults to now) }
// TODO(provider-integration): once a GPS box/SMS-gateway vendor is chosen,
// add a provider-specific payload parser here (or a sibling route) that
// maps their real wire format onto this same { imei, vccVoltage, recordedAt }
// shape before calling the shared logic below — do not fork the DB write
// path per-provider.
const ENGINE_RUNNING_THRESHOLD_VCC = 13.5

export async function POST(req: Request) {
  const secret = process.env.EQUIPMENT_TELEMETRY_SECRET
  const got = req.headers.get("x-equipment-telemetry-secret")
  if (!secret) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า EQUIPMENT_TELEMETRY_SECRET — ดู .env.local.example" }, { status: 500 })
  }
  if (got !== secret) {
    return NextResponse.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { imei?: string; vccVoltage?: number; recordedAt?: string } | null
  const imei = typeof body?.imei === "string" ? body.imei.trim() : ""
  const vccVoltage = typeof body?.vccVoltage === "number" ? body.vccVoltage : null
  if (!imei || vccVoltage === null) {
    return NextResponse.json({ error: "ต้องระบุ imei และ vccVoltage" }, { status: 400 })
  }
  const recordedAt = typeof body?.recordedAt === "string" && !Number.isNaN(new Date(body.recordedAt).getTime())
    ? new Date(body.recordedAt).toISOString()
    : new Date().toISOString()

  const db = supabase()

  const { data: asset, error: assetErr } = await db
    .from("equipment_assets")
    .select("id")
    .eq("imei", imei)
    .maybeSingle()
  if (assetErr) {
    return NextResponse.json({ error: `ค้นหาเครื่องจักรไม่สำเร็จ: ${assetErr.message}` }, { status: 500 })
  }
  if (!asset) {
    return NextResponse.json({ error: `ไม่พบเครื่องจักรที่ IMEI นี้: ${imei}` }, { status: 404 })
  }

  const engineRunning = vccVoltage >= ENGINE_RUNNING_THRESHOLD_VCC

  const { error: insertErr } = await db.from("equipment_telemetry_pings").insert({
    equipment_id: asset.id,
    recorded_at: recordedAt,
    engine_running: engineRunning,
    vcc_voltage: vccVoltage,
    raw_payload: body,
  })
  if (insertErr) {
    return NextResponse.json({ error: `บันทึก telemetry ไม่สำเร็จ: ${insertErr.message}` }, { status: 500 })
  }

  const accResult = await accumulateEngineHours(db, asset.id, { recordedAt, engineRunning })
  if (!accResult.ok) {
    return NextResponse.json({ error: accResult.error, telemetry_saved: true }, { status: 500 })
  }

  if (engineRunning) {
    await db.from("equipment_assets").update({ current_status: "RUNNING", updated_at: new Date().toISOString() }).eq("id", asset.id)
  }

  return NextResponse.json({
    ok: true,
    engine_running: engineRunning,
    delta_hours: accResult.deltaHours ?? 0,
    capped_from_hours: accResult.cappedFromHours ?? null,
    new_total_hours: accResult.newTotalHours,
  })
}
