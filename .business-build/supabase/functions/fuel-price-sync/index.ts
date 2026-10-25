// Fuel Price Auto-Sync (owner, 2026-07-24): "เฮียจะเอา ai มาทำหน้าที่ดึงเว็บ
// จากปั๊มน้ำมันจริงๆ นี่แหละภายใน 24 ชั่วโมง...โดยที่มนุษย์ไม่ต้องมานั่งระบุ
// ชี้เปลี่ยนค่าน้ำมันแบบมโน" — this is the real, verified fetcher: Bangchak's
// public retail oil price API (no key required, confirmed live 2026-07-24
// via direct curl: https://oil-price.bangchak.co.th/ApiOilPrice2/en).
//
// Picks "DIESEL B20" — the standard government-formula diesel Thai trucks
// run on (not the premium "Hi Diesel" blends) — as engines/fuel.ts's
// fuel-price config value. Every fetch is logged to fuel_price_log with its
// real source/timestamp before app_configs is touched, so a bad/missing
// fetch never silently corrupts the config (Rule 108: no silent override).
//
// Scope note: this is Bangchak's national/zone reference price, not a
// per-individual-partner-gas-station price — see the migration comment in
// 20260724000005_fuel_price_log.sql for the fuller (not yet built) idea.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"

const BANGCHAK_API = "https://oil-price.bangchak.co.th/ApiOilPrice2/en"
const TARGET_OIL_NAME = "DIESEL B20"

Deno.serve(async (req) => {
  const expected = Deno.env.get("FUEL_PRICE_SYNC_CRON_SECRET")
  const got = req.headers.get("x-fuel-sync-secret")
  if (!expected || got !== expected) {
    return new Response("unauthorized", { status: 401 })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, serviceKey)

  let payload: any
  try {
    const res = await fetch(BANGCHAK_API)
    if (!res.ok) return Response.json({ error: `Bangchak API HTTP ${res.status}` }, { status: 502 })
    payload = await res.json()
  } catch (e) {
    return Response.json({ error: `เรียก Bangchak API ไม่สำเร็จ: ${(e as Error).message}` }, { status: 502 })
  }

  const row = payload?.[0]
  if (!row?.OilList) return Response.json({ error: "รูปแบบข้อมูลจาก Bangchak เปลี่ยนไป — ไม่พบ OilList" }, { status: 502 })

  let oilList: { OilName: string; PriceToday: number }[]
  try {
    oilList = JSON.parse(row.OilList)
  } catch {
    return Response.json({ error: "แปลง OilList เป็น JSON ไม่สำเร็จ" }, { status: 502 })
  }

  const diesel = oilList.find((o) => o.OilName === TARGET_OIL_NAME)
  if (!diesel) return Response.json({ error: `ไม่พบราคา "${TARGET_OIL_NAME}" ใน OilList จริง` }, { status: 502 })

  const price = Number(diesel.PriceToday)
  const effectiveDate = row.OilPriceDate as string

  await supabase.from("fuel_price_log").insert({
    source: "bangchak",
    oil_name: TARGET_OIL_NAME,
    price,
    effective_date: effectiveDate,
  })

  const now = new Date().toISOString()
  await supabase.from("app_configs").upsert(
    { title: "fuel-price", data: String(price), updated_at: now },
    { onConflict: "title" },
  )

  return Response.json({ ok: true, oil_name: TARGET_OIL_NAME, price, effective_date: effectiveDate })
})
