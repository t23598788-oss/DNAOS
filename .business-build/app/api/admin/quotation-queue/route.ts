import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { resolveMaterialText } from "@/engines/material-resolver"

// Real quotation requests extracted from LINE chat (business_events,
// status='quotation_pending'/'awaiting_info'/'ready_to_quote') that nothing
// has fully resolved yet — resolves each material name against the real
// material_types table so เฮีย can see what's ready vs ambiguous. Pricing IS
// computed automatically now (engines/quote-price.ts / the Deno LINE-bot
// version, both wired through event-followup.ts) — an event stuck at
// 'ready_to_quote' here means the pricing engine genuinely couldn't answer
// (no pit has a price set for that material yet), not that nothing ran. Fix
// it by setting a real price at /admin/pits.

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()

  const QUOTE_ONLY_TYPES = new Set(["ขอราคา", "สอบถามทั่วไป", "inquiry"])

  const [{ data: events, error }, { data: materialTypes }] = await Promise.all([
    db
      .from("business_events")
      .select("id, event_code, event_type, material_text, quantity, quantity_unit, destination, schedule_text, contact_name, contact_phone, partner_id, source_line_user_id, status, created_at")
      .in("status", ["quotation_pending", "awaiting_info", "ready_to_quote"])
      .order("created_at", { ascending: false }),
    db.from("material_types").select("id, name"),
  ])

  // Owner instruction (2026-07-30): a read/list endpoint must never crash the
  // page — degrade to an empty queue instead of a hard 500.
  if (error) {
    console.error("[quotation-queue] query failed:", error.message)
    return NextResponse.json({ queue: [] })
  }

  const lineUserIds = [...new Set((events ?? []).map((e) => e.source_line_user_id).filter(Boolean))]
  // A real person can have more than one LINE account, so this goes through
  // company_line_links rather than a single companies.line_user_id column.
  const { data: links } = lineUserIds.length
    ? await db.from("company_line_links").select("line_user_id, companies(id, name)").in("line_user_id", lineUserIds)
    : { data: [] }
  const companyByLineUserId = new Map(
    (links ?? []).filter((l: any) => l.companies).map((l: any) => [l.line_user_id, l.companies])
  )

  const partnerIds = [...new Set((events ?? []).map((e) => e.partner_id).filter(Boolean))]
  const { data: sitesByPartner } = partnerIds.length
    ? await db.from("customer_sites").select("customer_company_id").eq("is_active", true).in("customer_company_id", partnerIds)
    : { data: [] }
  const hasSite = new Set((sitesByPartner ?? []).map((s: any) => s.customer_company_id))

  // A written-down checklist, not just a free-text "what's missing" blob
  // (owner instruction 2026-07-10: "ไม่มีใครมาเขียนลงในสมุดบันทึกให้เห็นหนิ
  // ว่าตอนนี้ได้ข้อมูลตรงนี้แล้วนะ" — nobody's writing down what's been
  // collected so far). Quote-only requests don't need a site/partner check —
  // they just need material + quantity + a destination in text.
  const queue = (events ?? []).map((e) => {
    const material_matches = e.material_text ? resolveMaterialText(e.material_text, materialTypes ?? []) : []
    const materialOk = material_matches.length > 0 && material_matches.every((m: any) => m.matched)
    const isQuoteOnly = QUOTE_ONLY_TYPES.has(e.event_type ?? "")
    const checklist = [
      { key: "material", label: "วัสดุ", done: materialOk },
      { key: "quantity", label: "จำนวน", done: !!e.quantity },
      { key: "destination", label: "ปลายทาง", done: !!e.destination },
      ...(isQuoteOnly ? [] : [
        { key: "partner", label: "บริษัท", done: !!e.partner_id },
        { key: "site", label: "ไซต์งานยืนยันแล้ว", done: e.status === "job_created" || (!!e.partner_id && hasSite.has(e.partner_id)) },
        { key: "contact", label: "ผู้ติดต่อ/เบอร์โทร", done: !!e.contact_phone },
      ]),
    ]
    return {
      ...e,
      is_quote_only: isQuoteOnly,
      matched_company: e.source_line_user_id ? (companyByLineUserId.get(e.source_line_user_id) ?? null) : null,
      material_matches,
      checklist,
    }
  })

  return NextResponse.json({ queue })
}
