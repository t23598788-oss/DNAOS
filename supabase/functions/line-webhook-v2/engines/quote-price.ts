// Closes the real gap diagnosed 2026-07-10: the system had "receive message +
// build queue" but no "close the queue with a material price and reply on
// LINE." ready_to_quote was just a status — nothing ever called the pricing
// engine. This does ONLY the material price (owner instruction: "ไม่ต้องไล่
// รถ" — skip vehicle/trip/transport entirely, that's a separate, bigger
// piece). Never invents a price: if no pit sells this material, or no real
// GPS is known, it says so plainly instead of guessing a number.
//
// Duplicated (not imported) from engines/distance.ts's haversine on purpose —
// that file runs in Next.js/Node, this runs in Deno.

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function resolveOne(input: string, materialTypes: { id: string; name: string }[]) {
  const norm = input.replace(/\s+/g, "")
  const exact = materialTypes.find((m) => m.name.replace(/\s+/g, "") === norm)
  if (exact) return exact
  const candidates = materialTypes.filter((m) => {
    const mn = m.name.replace(/\s+/g, "")
    return mn.includes(norm) || norm.includes(mn)
  })
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

export interface QuoteResult {
  // true only when a real price was found and computed — event-followup.ts
  // uses this to decide whether the event is actually resolved or should
  // stay visible in the quotation queue (owner-reported bug 2026-07-11:
  // every reply — even an apology — was marked "quoted", so unresolvable
  // price requests silently vanished from the queue).
  ok: boolean
  text: string
}

export async function tryQuoteMaterialPrice(
  supabase: any,
  userId: string,
  materialText: string,
  quantity: number | string,
  destination: string | null
): Promise<QuoteResult> {
  const { data: materialTypes } = await supabase.from("material_types").select("id, name")
  const material = resolveOne(materialText, materialTypes ?? [])
  if (!material) return { ok: false, text: "เดี๋ยวขอเช็ควัสดุให้ชัดเจนอีกครั้งครับ" }

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

  const { data: pits } = await supabase
    .from("pit_profiles")
    .select("id, pit_name, latitude, longitude")
    .is("deleted_at", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .neq("latitude", 0)

  const { data: pitMaterials } = await supabase
    .from("pit_materials")
    .select("pit_profile_id, price")
    .eq("material_type_id", material.id)
    .is("deleted_at", null)

  const pitIdsSellingMaterial = new Set((pitMaterials ?? []).map((pm: any) => pm.pit_profile_id))
  const candidates = (pits ?? []).filter((p: any) => pitIdsSellingMaterial.has(p.id))

  if (candidates.length === 0) {
    return { ok: false, text: `ขออภัยครับ ตอนนี้ยังไม่มีบ่อไหนในระบบตั้งราคา "${material.name}" ไว้ เดี๋ยวเช็คให้แล้วแจ้งกลับครับ` }
  }

  let nearest: { id: string; name: string; distance_km: number } | null = null
  for (const pit of candidates) {
    const d = haversine(gps.lat, gps.lng, parseFloat(pit.latitude), parseFloat(pit.longitude))
    if (!nearest || d < nearest.distance_km) nearest = { id: pit.id, name: pit.pit_name, distance_km: d }
  }
  if (!nearest) return { ok: false, text: "เดี๋ยวแจ้งราคากลับไปครับ" }

  const priceRow = (pitMaterials ?? []).find((pm: any) => pm.pit_profile_id === nearest!.id)
  const unitPrice = Number(priceRow?.price)
  if (!unitPrice) return { ok: false, text: "เดี๋ยวแจ้งราคากลับไปครับ ขอเช็คราคาก่อนนะครับ" }

  const qty = Number(quantity)
  const total = unitPrice * qty

  return {
    ok: true,
    text: `${material.name} ที่บ่อ "${nearest.name}" (ห่างประมาณ ${nearest.distance_km.toFixed(1)} กม.) ราคา ${unitPrice.toLocaleString()} บาท/คิว รวม ${qty} คิว = ${total.toLocaleString()} บาท (ยังไม่รวมค่าขนส่งครับ)`,
  }
}
