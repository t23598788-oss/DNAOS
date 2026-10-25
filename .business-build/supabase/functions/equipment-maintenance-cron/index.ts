// Equipment GPS/Relay — Maintenance Ticket + Auto-Lock Cron (owner spec
// 2026-07-24, implemented 2026-08-04 per
// docs/equipment-maintenance-lock-module.md's PLANNED rows). Runs every 10
// minutes, same interval/pattern as debt-reminder-cron and
// receipt-reconcile-sweep (Rule 103 — reuse the existing scheduled-job
// shape, don't invent a new one).
//
// Combines three related jobs in one function (deliberately, to avoid
// registering 3 near-identical cron schedules for the same domain):
// 1. Maintenance ticket generation — opens a maintenance_tickets row the
//    first time total_engine_hours crosses each 250h boundary since the
//    asset's last closed ticket.
// 2. +50h-overdue auto-lock — if an OPEN ticket's asset has run >= 50 more
//    engine-hours past its 250h trigger point, sends a real lock command.
//    This is a system-initiated SAFETY lock (defaults to the safe state),
//    not an unlock/start action — Rule 72's human-confirmation requirement
//    is about the system taking a risky ACTION; locking is the opposite.
//    See docs/equipment-maintenance-lock-module.md's Constitution
//    Alignment section for the same reasoning applied to trigger-start.
// 3. 17:00 (Bangkok time) shift-end lock — locks every currently-unlocked
//    asset. No override/exception mechanism exists in
//    driver_equipment_permissions today (no "always allowed" flag) — this
//    is flagged as a real, possibly-unintended gap in the report, but
//    implemented per the doc's literal intent since no contrary schema
//    evidence exists.
//
// Both lock triggers call app/api/internal/equipment/lock-command/route.ts
// (the Edge-cron bridge to the real Node relay-command.ts engine) rather
// than reimplementing the SMS command shape here — same cross-runtime
// bridge pattern as auto-confirm-payment.ts's receipt-document push.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"

const TICKET_INTERVAL_HOURS = 250 // owner's own spec value, not invented
const OVERDUE_GRACE_HOURS = 50    // owner's own spec value, not invented
const SHIFT_END_HOUR_BANGKOK = 17 // owner's own spec value, not invented

async function callLockCommand(baseUrl: string, secret: string, equipmentId: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/api/internal/equipment/lock-command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-equipment-lock-secret": secret },
      body: JSON.stringify({ equipmentId }),
    })
    if (!res.ok) return `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
    return null
  } catch (e) {
    return (e as Error).message
  }
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("EQUIPMENT_MAINTENANCE_CRON_SECRET")
  const got = req.headers.get("x-reconcile-secret")
  if (!expected || got !== expected) {
    return new Response("unauthorized", { status: 401 })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, serviceKey)

  const appBaseUrl = Deno.env.get("APP_BASE_URL")
  const lockSecret = Deno.env.get("EQUIPMENT_LOCK_INTERNAL_SECRET")
  const canLock = Boolean(appBaseUrl && lockSecret)

  const { data: assets, error: assetsErr } = await supabase
    .from("equipment_assets")
    .select("id, asset_code, total_engine_hours, last_ticket_trigger_hours, current_status")
  if (assetsErr) return Response.json({ error: assetsErr.message }, { status: 500 })

  const results: Record<string, string[]> = {}
  const pushResult = (code: string, msg: string) => {
    if (!results[code]) results[code] = []
    results[code].push(msg)
  }

  // 1. Ticket generation
  for (const asset of assets ?? []) {
    const totalHours = Number(asset.total_engine_hours ?? 0)
    const lastTrigger = Number(asset.last_ticket_trigger_hours ?? 0)
    const nextBoundary = Math.floor(totalHours / TICKET_INTERVAL_HOURS) * TICKET_INTERVAL_HOURS
    if (nextBoundary > 0 && nextBoundary > lastTrigger) {
      const { data: existing } = await supabase
        .from("maintenance_tickets")
        .select("id")
        .eq("equipment_id", asset.id)
        .eq("trigger_hours", nextBoundary)
        .maybeSingle()
      if (!existing) {
        const { error: insertErr } = await supabase.from("maintenance_tickets").insert({
          equipment_id: asset.id,
          trigger_hours: nextBoundary,
          status: "open",
        })
        if (insertErr) {
          pushResult(asset.asset_code, `เปิดใบงานไม่สำเร็จ: ${insertErr.message}`)
        } else {
          await supabase.from("equipment_assets").update({ last_ticket_trigger_hours: nextBoundary }).eq("id", asset.id)
          pushResult(asset.asset_code, `เปิดใบงานซ่อมบำรุงที่ ${nextBoundary} ชม.`)
        }
      }
    }
  }

  // 2. +50h overdue auto-lock
  const { data: openTickets, error: openErr } = await supabase
    .from("maintenance_tickets")
    .select("id, equipment_id, trigger_hours, overdue_locked, equipment_assets(asset_code, total_engine_hours, current_status)")
    .eq("status", "open")
    .eq("overdue_locked", false)
  if (openErr) return Response.json({ error: openErr.message }, { status: 500 })

  for (const ticket of openTickets ?? []) {
    const equipment = (ticket as any).equipment_assets
    if (!equipment) continue
    const totalHours = Number(equipment.total_engine_hours ?? 0)
    if (totalHours - Number(ticket.trigger_hours) >= OVERDUE_GRACE_HOURS) {
      if (!canLock) {
        pushResult(equipment.asset_code, "เกิน +50h แล้วแต่ล็อกอัตโนมัติไม่ได้ — ยังไม่ตั้งค่า APP_BASE_URL/EQUIPMENT_LOCK_INTERNAL_SECRET")
        continue
      }
      const err = await callLockCommand(appBaseUrl!, lockSecret!, ticket.equipment_id)
      if (err) {
        pushResult(equipment.asset_code, `ล็อกอัตโนมัติ (เกิน 50 ชม.) ไม่สำเร็จ: ${err}`)
      } else {
        await supabase.from("maintenance_tickets").update({ overdue_locked: true, overdue_locked_at: new Date().toISOString() }).eq("id", ticket.id)
        pushResult(equipment.asset_code, "ล็อกอัตโนมัติแล้ว — เกินกำหนดซ่อมบำรุง 50 ชม.")
      }
    }
  }

  // 3. 17:00 Bangkok shift-end lock — Bangkok is UTC+7, no DST, same fixed
  // offset already used by debt-reminder-cron.
  const bangkokHour = (new Date().getUTCHours() + 7) % 24
  if (bangkokHour === SHIFT_END_HOUR_BANGKOK) {
    for (const asset of assets ?? []) {
      if (asset.current_status === "LOCKED") continue
      if (!canLock) {
        pushResult(asset.asset_code, "ถึงเวลาเลิกงาน 17:00 แต่ล็อกอัตโนมัติไม่ได้ — ยังไม่ตั้งค่า APP_BASE_URL/EQUIPMENT_LOCK_INTERNAL_SECRET")
        continue
      }
      const err = await callLockCommand(appBaseUrl!, lockSecret!, asset.id)
      if (err) {
        pushResult(asset.asset_code, `ล็อกเลิกงาน 17:00 ไม่สำเร็จ: ${err}`)
      } else {
        pushResult(asset.asset_code, "ล็อกอัตโนมัติแล้ว — หมดเวลาทำงาน 17:00")
      }
    }
  }

  return Response.json({ results })
})
