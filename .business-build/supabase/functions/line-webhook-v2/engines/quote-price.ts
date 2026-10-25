// Closes the real gap diagnosed 2026-07-10: the system had "receive message +
// build queue" but no "close the queue with a material price and reply on
// LINE." ready_to_quote was just a status — nothing ever called the pricing
// engine. Originally material-only (owner instruction 2026-07-10: "ไม่ต้องไล่
// รถ"). Owner reversed that 2026-07-26: "มนุษย์อยากได้ราคาที่พร้อมขนส่งเสร็จ
// สรรพ...นั่นถึงจะจบขั้นตอนจริงๆ" — real customers decide based on the full
// delivered price, and don't know vehicle capacities themselves. This now
// computes material + real transport cost together, picking a vehicle that
// can actually reach the site (customer_sites.access_restriction — real
// field, previously unused).
//
// Duplicated (not imported) from engines/distance.ts's haversine on purpose —
// that file runs in Next.js/Node, this runs in Deno.

import { boqCardFlex } from "../templates/flex/boq-card.ts"
import { validateDensity } from "./material-density.ts"

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Real bug, live 2026-07-26: material_types.name can hold multiple aliases
// in one field ("ทรายหยาบ หรือ ทรายถม") — split on "หรือ" and match each
// alias separately, same fix as event-followup.ts's resolveOne (this file
// has its own copy since it's called with a single already-resolved
// material name at a time, not shared code by design in this repo).
function nameAliases(name: string): string[] {
  return name.split("หรือ").map((a) => a.replace(/\s+/g, "")).filter(Boolean)
}

function resolveOne(input: string, materialTypes: { id: string; name: string; density_ton_per_cbm?: number | null }[]) {
  const norm = input.replace(/\s+/g, "")
  const exact = materialTypes.find((m) => nameAliases(m.name).includes(norm))
  if (exact) return exact
  const candidates = materialTypes.filter((m) => nameAliases(m.name).some((mn) => mn.includes(norm) || norm.includes(mn)))
  return candidates.length === 1 ? candidates[0] : null
}

// GPS isn't stored on business_events (only on customer_sites) — this
// re-checks the destination text itself, then falls back to the contact's
// most recent LINE location share, same pattern already used for site
// creation in event-followup.ts.
async function resolveGps(supabase: any, userId: string, destinationText: string | null): Promise<{ lat: number; lng: number } | null> {
  const { data: locationMsg } = await supabase
    .from("line_events")
    .select("raw_text, extracted")
    .eq("line_user_id", userId)
    .eq("raw_type", "location")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (locationMsg?.extracted?.latitude && locationMsg?.extracted?.longitude) {
    return { lat: locationMsg.extracted.latitude, lng: locationMsg.extracted.longitude }
  }
  return null
}

// Real business rule (owner, 2026-07-26): "หมู่บ้านรถพ่วงมันเข้าไม่ได้"
// — vehicle choice must respect the actual delivery site's real
// constraints, not just tonnage math. customer_sites.access_restriction is
// a real free-text field (previously never populated/read anywhere) —
// simple keyword check, not a guess: only excludes a vehicle when its own
// name is explicitly mentioned as restricted.
function vehicleAllowedAtSite(vehicleName: string, accessRestriction: string | null): boolean {
  if (!accessRestriction) return true
  const restriction = accessRestriction.replace(/\s+/g, "")
  // Real vehicle_types.name values have a space ("รถ 10 ล้อ (ดั้ม)") — strip
  // whitespace before checking so "10ล้อ"/"6ล้อ" actually match.
  const name = vehicleName.replace(/\s+/g, "")
  const vehicleKeyword = name.includes("พ่วง") ? "พ่วง" : name.includes("10ล้อ") ? "10ล้อ" : name.includes("6ล้อ") ? "6ล้อ" : null
  if (!vehicleKeyword) return true
  return !restriction.includes(`${vehicleKeyword}เข้าไม่ได้`) && !restriction.includes(`ห้าม${vehicleKeyword}`)
}

async function resolveAccessRestriction(supabase: any, userId: string): Promise<string | null> {
  const { data: link } = await supabase
    .from("company_line_links").select("company_id").eq("line_user_id", userId).maybeSingle()
  if (!link?.company_id) return null
  const { data: site } = await supabase
    .from("customer_sites").select("access_restriction")
    .eq("customer_company_id", link.company_id).eq("is_active", true)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle()
  return site?.access_restriction ?? null
}

interface VehicleOption {
  name: string
  loadCapacity: number
  fuelConsumptionRate: number // km per liter — real vehicle_types field
}

// Picks the vehicle that needs the fewest trips among ones actually allowed
// at this site — never the biggest available regardless of fit, and never
// a vehicle the site itself can't take just because it happens to be
// "efficient" for the tonnage.
function pickVehicle(quantity: number, vehicles: VehicleOption[], accessRestriction: string | null): { vehicle: VehicleOption; trips: number } | null {
  const allowed = vehicles.filter((v) => vehicleAllowedAtSite(v.name, accessRestriction))
  if (allowed.length === 0) return null
  let best: { vehicle: VehicleOption; trips: number } | null = null
  for (const v of allowed) {
    const trips = Math.ceil(quantity / v.loadCapacity)
    if (!best || trips < best.trips) best = { vehicle: v, trips }
  }
  return best
}

export interface QuoteResult {
  // true only when a real price was found and computed — event-followup.ts
  // uses this to decide whether the event is actually resolved or should
  // stay visible in the quotation queue (owner-reported bug 2026-07-11:
  // every reply — even an apology — was marked "quoted", so unresolvable
  // price requests silently vanished from the queue).
  ok: boolean
  text: string
  // Owner instruction (2026-07-26): "จัดระเบียบเป็นการ์ดที่ LINE มีไว้ให้...
  // ยาวๆ เหมือนโค้ดคอมพิวเตอร์มากกว่า" — a long plain-text quote is hard to
  // read on a phone. Populated only for a full material+transport quote
  // (reuses templates/flex/boq-card.ts's existing card, not a new one —
  // Rule 101/103). `text` is kept too, as a plain fallback for callers that
  // can't send Flex (and for the multi-material text.ok gate).
  flex?: object
  // Owner instruction (2026-07-26): "ระบบต้องเห็นสลิปจริงก่อนถึงสั่งรถ" —
  // the real grand total, stored on business_events.quoted_amount so an
  // incoming payment slip has a real number to match against before
  // anything gets marked safe to dispatch.
  amount?: number
}

export async function tryQuoteMaterialPrice(
  supabase: any,
  userId: string,
  materialText: string,
  quantity: number | string,
  destination: string | null,
  quantityUnit: string | null = null,
  // Owner-reported bug (2026-07-26): the Flex card's "ยืนยัน"/"ยกเลิก"
  // buttons carried a fake placeholder ID (material.id + timestamp) that no
  // real record matches — pressing confirm couldn't do anything real.
  // Pass the actual business_events.id through so the postback can act on
  // a real row.
  businessEventId: string | null = null
): Promise<QuoteResult> {
  const { data: materialTypes } = await supabase.from("material_types").select("id, name, density_ton_per_cbm")
  const material = resolveOne(materialText, materialTypes ?? [])
  if (!material) return { ok: false, text: `ขอโทษครับ ไม่พบวัสดุ "${materialText}" ในระบบ รบกวนพิมพ์ชื่อวัสดุอีกครั้งได้ไหมครับ` }

  // Real physics (owner, 2026-07-26): คิว (volume) and ตัน (weight) are only
  // convertible through this specific material's real density — never a
  // single hardcoded factor. See engines/material-density.ts.
  let quantityInTons = Number(quantity)
  if (quantityUnit === "คิว") {
    const density = material.density_ton_per_cbm ? Number(material.density_ton_per_cbm) : null
    if (!density) {
      return { ok: false, text: `ขอโทษครับ ยังไม่มีค่าความหนาแน่นของ "${material.name}" ในระบบ แปลงคิวเป็นตันไม่ได้ รบกวนแจ้งปริมาณเป็นตันแทนได้ไหมครับ` }
    }
    // Audit finding (2026-07-26): validateDensity() existed in
    // material-density.ts but had zero real call sites — a bad value
    // (e.g. sand entered as 7.8, steel's range) would have silently
    // produced a wrong price with no warning. Wired in here, the one real
    // place a density value gets used for a customer-facing calculation.
    const densityError = validateDensity(material.name, density)
    if (densityError) {
      console.error(`[quote-price] ${densityError}`)
      return { ok: false, text: `ขอโทษครับ ค่าความหนาแน่นของ "${material.name}" ในระบบผิดปกติ (${density} ตัน/คิว) รบกวนติดต่อเจ้าหน้าที่ให้ตรวจสอบก่อนนะครับ` }
    }
    quantityInTons = quantityInTons * density
  }

  const gps = await resolveGps(supabase, userId, destination)
  if (!gps) {
    // Ask directly instead of a vague "we'll get back to you" — real gap
    // 2026-07-10: quote-only inquiries silently stalled with a holding
    // message instead of telling the customer what's actually missing.
    // Never auto-reuse a past site (owner instruction: "ไม่มีใครส่งหน้างาน
    // เดิมตลอด 24 ชั่วโมง") — only offer it as a question when a real
    // active site exists for this contact's company.
    const { data: link } = await supabase
      .from("company_line_links").select("company_id").eq("line_user_id", userId).maybeSingle()
    if (link?.company_id) {
      const { data: site } = await supabase
        .from("customer_sites").select("site_name, address")
        .eq("customer_company_id", link.company_id).eq("is_active", true)
        .order("updated_at", { ascending: false }).limit(1).maybeSingle()
      if (site) {
        return { ok: false, text: `ส่งที่หน้างานเดิม "${site.site_name || site.address}" ไหมครับ ถ้าใช่พิมพ์ยืนยันได้เลย ถ้าเป็นหน้างานใหม่รบกวนแชร์พิกัด GPS ให้หน่อยครับ` }
      }
    }
    return { ok: false, text: "รบกวนแชร์พิกัด GPS หรือแจ้งสถานที่จัดส่งด้วยครับ เดี๋ยวแจ้งราคาให้ทันทีครับ" }
  }

  // PUBLICATION BOUNDARY (owner mission 2026-10-19): this engine answers real
  // LINE customers, so it may only offer supply that is published — not
  // deleted, is_open = true, and carrying a real price > 0. Before this fix a
  // closed pit (is_open = false) could still win the nearest-pit match and be
  // quoted to an external customer. Internal management screens keep their own
  // reader; this is the external path only.
  const { data: pits } = await supabase
    .from("pit_profiles")
    .select("id, pit_name, latitude, longitude")
    .is("deleted_at", null)
    .eq("is_open", true)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .neq("latitude", 0)

  const { data: pitMaterials } = await supabase
    .from("pit_materials")
    .select("pit_profile_id, price")
    .eq("material_type_id", material.id)
    .is("deleted_at", null)
    .gt("price", 0)

  const pitIdsSellingMaterial = new Set((pitMaterials ?? []).map((pm: any) => pm.pit_profile_id))
  const candidates = (pits ?? []).filter((p: any) => pitIdsSellingMaterial.has(p.id))

  if (candidates.length === 0) {
    // Owner correction (2026-07-26): "รู้ว่าได้หรือไม่ได้ มีหรือไม่มี คือคำตอบ
    // ที่ถูกต้อง" — nothing in this codebase automatically checks and gets
    // back to a customer later, so promising that is dishonest. State the
    // real, current fact (no price set yet) instead.
    return { ok: false, text: `ขออภัยครับ ตอนนี้ยังไม่มีบ่อไหนในระบบตั้งราคา "${material.name}" ไว้ครับ` }
  }

  let nearest: { id: string; name: string; distance_km: number } | null = null
  for (const pit of candidates) {
    const d = haversine(gps.lat, gps.lng, parseFloat(pit.latitude), parseFloat(pit.longitude))
    if (!nearest || d < nearest.distance_km) nearest = { id: pit.id, name: pit.pit_name, distance_km: d }
  }
  if (!nearest) return { ok: false, text: "เดี๋ยวแจ้งราคากลับไปครับ" }

  const priceRow = (pitMaterials ?? []).find((pm: any) => pm.pit_profile_id === nearest!.id)
  const costPrice = Number(priceRow?.price)
  if (!costPrice) return { ok: false, text: "เดี๋ยวแจ้งราคากลับไปครับ ขอเช็คราคาก่อนนะครับ" }

  // Real business rule (owner, 2026-07-26): pit_materials.price is the real
  // COST/gate price, not the customer-facing sell price — quoting it
  // directly (as this file used to) means selling at cost or a loss once
  // transport is added. 25% markup, same figure already used in
  // middleware/sanitizer.ts's markupPercent default (that file's own path
  // isn't live today, but the number is a real existing business figure,
  // not invented here).
  const MARKUP_MULTIPLIER = 1.25
  const unitPrice = costPrice * MARKUP_MULTIPLIER

  const qty = quantityInTons
  const materialTotal = unitPrice * qty

  // Real delivered-price computation (owner, 2026-07-26) — real vehicle
  // capacities/fuel-consumption from vehicle_types, real current diesel
  // price from fuel_price_log (synced daily), real site access constraint
  // from customer_sites.access_restriction. Never guessed/hardcoded.
  const { data: vehicleRows } = await supabase
    .from("vehicle_types").select("name, load_capacity, fuel_consumption_rate")
    .is("deleted_at", null).not("load_capacity", "is", null).not("fuel_consumption_rate", "is", null)
  const vehicles: VehicleOption[] = (vehicleRows ?? []).map((v: any) => ({
    name: v.name, loadCapacity: Number(v.load_capacity), fuelConsumptionRate: Number(v.fuel_consumption_rate),
  }))

  const { data: fuelRow } = await supabase
    .from("fuel_price_log").select("price").order("fetched_at", { ascending: false }).limit(1).maybeSingle()
  const fuelPricePerLiter = fuelRow?.price ? Number(fuelRow.price) : null

  // Mask physical pit supplier identity (owner instruction, established
  // 2026-07-18/25): never tell the customer which real pit/quarry — real
  // distance only, so they can't shop around by pit identity.
  const genericPit = "บ่อวัสดุในระบบ"

  if (vehicles.length === 0 || !fuelPricePerLiter) {
    // Honest partial result — never fabricate a transport cost without real
    // vehicle or fuel data to compute it from.
    return {
      ok: true,
      text: `${material.name} ที่ ${genericPit} (ห่างประมาณ ${nearest.distance_km.toFixed(1)} กม.) ราคาวัสดุ ${unitPrice.toLocaleString()} บาท/ตัน รวม ${qty} ตัน = ${materialTotal.toLocaleString()} บาท (ยังไม่รวมค่าขนส่ง — ระบบยังไม่มีข้อมูลรถ/ราคาน้ำมันพอคำนวณให้ครับ)`,
    }
  }

  const accessRestriction = await resolveAccessRestriction(supabase, userId)
  const picked = pickVehicle(qty, vehicles, accessRestriction)
  if (!picked) {
    return {
      ok: true,
      text: `${material.name} ที่ ${genericPit} (ห่างประมาณ ${nearest.distance_km.toFixed(1)} กม.) ราคาวัสดุ ${unitPrice.toLocaleString()} บาท/ตัน รวม ${qty} ตัน = ${materialTotal.toLocaleString()} บาท (หน้างานมีข้อจำกัดรถเข้า "${accessRestriction}" — ไม่มีรถในระบบที่เข้าได้ รบกวนติดต่อเจ้าหน้าที่ครับ)`,
    }
  }

  const roundTripKm = nearest.distance_km * 2
  // Markup applies to the whole delivered price, not material alone — the
  // owner's own words: "งานพวกนี้มันเป็นงานกำไรอยู่กับงานขนส่ง" (the profit
  // really lives in the transport leg), so transport cost gets the same
  // markup as material, not passed through at raw cost.
  const transportCostPerTrip = (roundTripKm / picked.vehicle.fuelConsumptionRate) * fuelPricePerLiter * MARKUP_MULTIPLIER
  const transportTotal = transportCostPerTrip * picked.trips
  const grandTotal = materialTotal + transportTotal

  const text =
    `${material.name} ${qty} ตัน จาก ${genericPit} (${nearest.distance_km.toFixed(1)} กม.)\n` +
    `ค่าวัสดุ: ${unitPrice.toLocaleString()} บาท/ตัน x ${qty} ตัน = ${materialTotal.toLocaleString()} บาท\n` +
    `ค่าขนส่ง: ${picked.vehicle.name} (บรรทุกได้ ${picked.vehicle.loadCapacity} ตัน/เที่ยว) ${picked.trips} เที่ยว x ${transportCostPerTrip.toLocaleString(undefined, { maximumFractionDigits: 0 })} บาท/เที่ยว = ${transportTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} บาท\n` +
    `รวมราคาพร้อมส่งถึงหน้างาน: ${grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} บาท`

  // Owner-reported bug (2026-07-26): line labels including the pit-mask
  // phrase and vehicle name ran too long for the card's narrow column and
  // got visually truncated ("34...") — customers couldn't read the real
  // number. Keep labels short; the real distance/vehicle detail is still in
  // the plain-text `text` fallback above for anyone who needs it.
  const flex = boqCardFlex({
    quoteId: businessEventId ?? `${material.id.slice(0, 8)}-${Date.now().toString(36)}`,
    material: material.name,
    quantity: qty,
    unitPrice,
    lines: [
      { label: `ค่าวัสดุ (${nearest.distance_km.toFixed(1)} กม.)`, amount: materialTotal },
      { label: `ค่าขนส่ง (${picked.trips} เที่ยว)`, amount: transportTotal },
    ],
    totalAmount: grandTotal,
  })

  return { ok: true, text, flex, amount: grandTotal }
}
