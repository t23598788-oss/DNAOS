import { resolveMaterialText } from "@/engines/material-resolver"
import { geocodeThaiAddress } from "@/engines/geocoding"
import { linkBusinessEventTransaction, transitionBusinessEvent } from "@/engines/canonical/event-write"

// Two different intents need two different amounts of information — a price
// question is not a commitment (owner instruction 2026-07-10: "ถ้าอยากได้
// เฉพาะราคาเฉยๆ ก็ถามเอาเฉพาะพื้นที่ GPS ที่จะให้ส่ง แค่นั้น ไม่ต้องเอาเบอร์
// โทร"): ขอราคา only needs material + quantity + a delivery location text —
// no site record, no phone number, no Job. สั่งซื้อ (an actual order) needs
// a real confirmed site, because a repeat customer does NOT always deliver
// to the same site (owner instruction 2026-07-10: "ไม่มีใครส่งหน้างานเดิม
// ตลอด 24 ชั่วโมงหรือ 24 เดือนหรอก") — so an existing site is NEVER silently
// reused; it's always offered back for explicit confirmation instead.

export interface AutoCreateEventInput {
  id: string
  event_type: string | null
  partner_id: string | null
  material_text: string | null
  quantity: number | string | null
  quantity_unit: string | null
  destination: string | null
  contact_name: string | null
  contact_phone: string | null
  source_line_user_id?: string | null
}

// LINE's own location-share already geocodes into a Thai address string —
// same parser as supabase/functions/line-webhook-v2/handlers/location.ts
// (duplicated, not imported, since that file runs in Deno and this runs in
// Next.js — different runtimes in this repo).
function parseThaiAddress(raw: string): { subdistrict: string; district: string; province: string; postal_code: string } | null {
  const subM = raw.match(/(?:ตำบล|แขวง)\s*([^\s]+)/)
  const distM = raw.match(/(?:อำเภอ|เขต)\s*([^\s]+)/)
  const postalM = raw.match(/(\d{5})/)
  if (!subM || !distM || !postalM) return null
  const distEnd = (distM.index ?? 0) + distM[0].length
  const postalStart = postalM.index ?? raw.length
  const province = raw.slice(distEnd, postalStart).trim()
  if (!province) return null
  return { subdistrict: subM[1], district: distM[1], province, postal_code: postalM[1] }
}

const QUOTE_ONLY_TYPES = new Set(["ขอราคา", "สอบถามทั่วไป", "inquiry"])

export type MissingField = "partner" | "material" | "quantity" | "destination" | "site_confirm" | "contact"

export type AutoCreateResult =
  | { status: "created"; orderId: string; orderNo: string }
  | { status: "ready_to_quote" } // has everything a price needs; no Job created
  | { status: "needs_info"; missing: MissingField[]; ambiguousMaterial?: { input: string; candidates: string[] }; siteChoice?: { existingName: string } }
  | { status: "skipped"; reason: string }

export async function tryAutoCreateJob(db: any, event: AutoCreateEventInput): Promise<AutoCreateResult> {
  const missing: MissingField[] = []
  let ambiguousMaterial: { input: string; candidates: string[] } | undefined
  let siteChoice: { existingName: string } | undefined

  const isQuoteOnly = QUOTE_ONLY_TYPES.has(event.event_type ?? "")

  if (!isQuoteOnly && !event.partner_id) missing.push("partner")

  if (!event.material_text) {
    missing.push("material")
  } else {
    const { data: materialTypes } = await db.from("material_types").select("id, name")
    const matches = resolveMaterialText(event.material_text, materialTypes ?? [])
    const unresolved = matches.filter((m) => !m.matched)
    if (unresolved.length > 0) {
      missing.push("material")
      const withCandidates = unresolved.find((m) => m.candidates.length > 0)
      if (withCandidates) {
        ambiguousMaterial = { input: withCandidates.input, candidates: withCandidates.candidates.map((c) => c.name) }
      }
    }
  }

  if (!event.quantity) missing.push("quantity")

  if (isQuoteOnly) {
    // A price question just needs to know WHERE, in plain text — nothing
    // needs to be saved as a permanent site, no phone number required.
    if (!event.destination) missing.push("destination")
    if (missing.length > 0) return { status: "needs_info", missing, ambiguousMaterial }
    return { status: "ready_to_quote" }
  }

  // Real order — needs a CONFIRMED site, never an assumed one.
  let confirmedSiteId: string | null = null
  if (event.partner_id) {
    const { data: sites } = await db
      .from("customer_sites")
      .select("id, site_name, address")
      .eq("customer_company_id", event.partner_id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)

    const site = sites?.[0]
    if (site) {
      // Has the customer's LATEST message already confirmed this site by
      // name, or explicitly said "เหมือนเดิม" (same as before)? Only then
      // do we use it — never silently.
      const destText = (event.destination ?? "").trim()
      const confirmedBySameWord = /เหมือนเดิม|ที่เดิม|เดิม|เหมือนครั้งก่อน/.test(destText)
      const confirmedByName = destText && site.site_name && destText.includes(site.site_name)
      if (confirmedBySameWord || confirmedByName) {
        confirmedSiteId = site.id
      } else if (event.destination) {
        // They gave a NEW location — try converting it into a fresh site
        // instead of assuming they meant the old one.
        confirmedSiteId = await tryCreateSiteFromText(db, event.partner_id, event.destination)
        if (!confirmedSiteId) missing.push("destination")
      } else {
        missing.push("site_confirm")
        siteChoice = { existingName: site.site_name }
      }
    } else if (event.source_line_user_id) {
      const created = await tryCreateSiteFromLineLocation(db, event.partner_id, event.source_line_user_id)
      if (created) confirmedSiteId = created
      else missing.push("destination")
    } else {
      missing.push("destination")
    }
  }

  // A truck can't actually be dispatched without someone to call at the
  // site — this was already part of the real working flow before today
  // (owner-confirmed, seen in real chat history: "ชื่อผู้ติดต่อ...เบอร์
  // โทรศัพท์..."), just never enforced by the auto-create logic until now.
  if (!event.contact_phone) missing.push("contact")

  if (missing.length > 0) {
    return { status: "needs_info", missing, ambiguousMaterial, siteChoice }
  }

  const stamp = Date.now().toString().slice(-6)
  const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "")
  const jobTitle = [event.material_text, event.quantity ? `${event.quantity} ${event.quantity_unit ?? ""}`.trim() : null]
    .filter(Boolean).join(" ") || "งานใหม่จาก LINE"

  const { data: project, error: projectError } = await db
    .from("projects")
    .insert({
      project_no: `PRJ-${dateStr}-${stamp}`,
      customer_company_id: event.partner_id,
      customer_site_id: confirmedSiteId,
      title: jobTitle,
      status: "ACTIVE",
      updated_at: new Date().toISOString(),
    })
    .select("id, project_no")
    .single()
  if (projectError) return { status: "skipped", reason: projectError.message }

  const { data: docGroup, error: docGroupError } = await db
    .from("document_groups")
    .insert({
      group_no: `DG-${dateStr}-${stamp}`,
      project_id: project.id,
      project_no: project.project_no,
      customer_company_id: event.partner_id,
      title: jobTitle,
      status: "OPEN",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (docGroupError) return { status: "skipped", reason: docGroupError.message }

  const orderNo = `ORD-${dateStr}-${stamp}`
  const { data: order, error: orderError } = await db
    .from("customer_orders")
    .insert({
      order_no: orderNo,
      project_id: project.id,
      document_group_id: docGroup.id,
      customer_company_id: event.partner_id,
      customer_site_id: confirmedSiteId,
      status: "DRAFT",
      delivery_note: `ผู้ติดต่อหน้างาน: ${event.contact_name ?? "-"} โทร ${event.contact_phone}`,
      updated_at: new Date().toISOString(),
    })
    .select("id, order_no")
    .single()
  if (orderError) return { status: "skipped", reason: orderError.message }

  // Capability D: the event → canonical transaction link goes through the
  // canonical Business Event writer (engines/canonical/event-write.ts), split
  // into its two real meanings: LINK (transaction identity) then TRANSITION
  // (state). No direct business_events mutation remains in this engine.
  await linkBusinessEventTransaction(db, {
    eventId: event.id,
    transactionId: order.id,
    actor: "system:jobs:auto-create",
  })
  await transitionBusinessEvent(db, {
    eventId: event.id,
    to: "job_created",
    actor: "system:jobs:auto-create",
  })

  return { status: "created", orderId: order.id, orderNo: order.order_no }
}

async function tryCreateSiteFromText(db: any, partnerId: string, destinationText: string): Promise<string | null> {
  const parsed = parseThaiAddress(destinationText)
  if (!parsed) return null

  // Real geocoding (owner, 2026-07-24): before this, a typed address (as
  // opposed to a live LINE location-share pin) never got gps_lat/gps_lng at
  // all — findNearestPit()/the whole Location & Matching pipeline requires
  // real coordinates, so a text-only address silently couldn't be priced.
  // Best-effort: a failed/unconfigured geocode still creates the site with
  // province/district/subdistrict/postal_code (same as before), just without
  // coordinates — never blocks site creation on this being available.
  const geocoded = await geocodeThaiAddress(destinationText)

  const { data, error } = await db
    .from("customer_sites")
    .insert({
      customer_company_id: partnerId,
      site_name: destinationText.slice(0, 40),
      address: destinationText,
      province: parsed.province,
      district: parsed.district,
      subdistrict: parsed.subdistrict,
      postal_code: parsed.postal_code,
      gps_lat: geocoded.ok ? geocoded.lat : null,
      gps_lng: geocoded.ok ? geocoded.lng : null,
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  return error ? null : data.id
}

async function tryCreateSiteFromLineLocation(db: any, partnerId: string, lineUserId: string): Promise<string | null> {
  const { data: locationMsg } = await db
    .from("line_events")
    .select("raw_text, extracted")
    .eq("line_user_id", lineUserId)
    .eq("raw_type", "location")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!locationMsg) return null
  const parsed = parseThaiAddress(locationMsg.raw_text ?? "")
  if (!parsed) return null
  const { data, error } = await db
    .from("customer_sites")
    .insert({
      customer_company_id: partnerId,
      site_name: "จากพิกัด LINE",
      address: locationMsg.raw_text,
      province: parsed.province,
      district: parsed.district,
      subdistrict: parsed.subdistrict,
      postal_code: parsed.postal_code,
      gps_lat: locationMsg.extracted?.latitude ?? null,
      gps_lng: locationMsg.extracted?.longitude ?? null,
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  return error ? null : data.id
}

// Short, direct asks — owner instruction 2026-07-10: "ถามตรงๆ...ไม่ต้อง
// อธิบายเยอะ" (ask directly, don't over-explain). One line per missing item.
const MISSING_LABEL: Record<string, string> = {
  partner: "ขอชื่อบริษัทหรือชื่อที่ติดต่อด้วยครับ",
  material: "ส่งชนิดวัสดุที่ต้องการให้หน่อยครับ",
  quantity: "ขอจำนวนที่ต้องการด้วยครับ",
  destination: "ส่ง GPS หรือที่อยู่จัดส่งให้หน่อยครับ",
  contact: "ขอชื่อผู้ติดต่อหน้างานกับเบอร์โทรด้วยครับ",
}

// Composes the one clarifying question to send back — no financial figures
// involved, so it's safe to send directly (not a Rule 72 draft-review case).
export function composeMissingInfoMessage(result: Extract<AutoCreateResult, { status: "needs_info" }>): string {
  if (result.ambiguousMaterial) {
    return `"${result.ambiguousMaterial.input}" เอาชนิดไหนครับ ${result.ambiguousMaterial.candidates.join(" / ")}`
  }
  if (result.missing.includes("site_confirm") && result.siteChoice) {
    return `ส่งที่ "${result.siteChoice.existingName}" เหมือนเดิมไหมครับ หรือที่ใหม่ (ถ้าที่ใหม่ ส่ง GPS หรือที่อยู่มาได้เลยครับ)`
  }
  const lines = result.missing.map((m) => MISSING_LABEL[m]).filter(Boolean)
  return lines.join(" ")
}
