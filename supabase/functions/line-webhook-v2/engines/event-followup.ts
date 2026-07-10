// Closes the loop the owner flagged 2026-07-10: a reply like "ทรายหยาบ" to
// an already-asked clarifying question was just getting echoed back
// ("รับข้อความแล้ว...") instead of actually being used. This checks whether
// the contact has an event sitting in "awaiting_info", tries to fill in
// whatever the new message answers, and either completes the Job for real
// or asks for the next missing piece — never a blind echo for these.
//
// Two intents need two different amounts of information (owner instruction
// 2026-07-10): ขอราคา (price question) only needs material + quantity + a
// delivery location in text — no phone number, no permanent site, no Job.
// A real order needs a CONFIRMED site — an existing site is never silently
// reused ("ไม่มีใครส่งหน้างานเดิมตลอด 24 ชั่วโมงหรือ 24 เดือน"), it's offered
// back for explicit yes/no instead.
//
// Duplicated (not imported) from engines/jobs/auto-create.ts and
// engines/material-resolver.ts on purpose — this Edge Function runs in Deno,
// those run in Next.js/Node, different runtimes in this repo (same pattern
// already used for quotation-queue-nudge).

import { tryQuoteMaterialPrice } from "./quote-price.ts"

// Deterministic, not an LLM guess (owner instruction 2026-07-10: "อย่าให้ AI
// เข้ามามั่วเยอะ") — a reply containing these words is almost certainly a
// question, not an address, so it should never get stored as a destination.
function looksLikeAQuestion(text: string): boolean {
  return /เท่าไหร่|เท่าไร|ราคา|กี่|ไหม|หรือเปล่า|มั้ย|\?/.test(text)
}

function normalizeMaterialText(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/ลูกลัง/g, "ลูกรัง")
    .replace(/ลูกล้ง/g, "ลูกรัง")
    .replace(/ลูกรังค์/g, "ลูกรัง")
    .replace(/ดินลูกรัง/g, "ลูกรัง")
    .replace(/ราคา|ขอ|ครับ|ค่ะ|คะ|หน่อย|เช็ค|ช่วย|คำนวณ|ให้/g, "")
}

function stripQuantityAndIntent(text: string): string {
  return normalizeMaterialText(text.replace(/\d[\d,]*\s*(คิว|ตัน|ลบ\.?ม\.?|ลูกบาศก์เมตร)?/g, ""))
}

function extractQuantity(text: string): { quantity: number; unit: string | null } | null {
  const withUnit = text.match(/(\d[\d,]*)\s*(คิว|ตัน|ลบ\.?ม\.?|ลูกบาศก์เมตร)/)
  if (withUnit) {
    const quantity = Number(withUnit[1].replace(/,/g, ""))
    return Number.isFinite(quantity) ? { quantity, unit: withUnit[2] } : null
  }
  const numberOnly = text.trim().match(/^(\d[\d,]*)$/)
  if (numberOnly) {
    const quantity = Number(numberOnly[1].replace(/,/g, ""))
    return Number.isFinite(quantity) ? { quantity, unit: null } : null
  }
  return null
}

function splitMaterialText(text: string): string[] {
  return text.split(/[,、]|(?:\bและ\b)|(?:\bกับ\b)/).map((s) => s.trim()).filter(Boolean)
}

function resolveOne(input: string, materialTypes: { id: string; name: string }[]) {
  const norm = normalizeMaterialText(input)
  const exact = materialTypes.find((m) => normalizeMaterialText(m.name) === norm)
  if (exact) return { matched: exact, candidates: [] as typeof materialTypes }
  const candidates = materialTypes.filter((m) => {
    const mn = normalizeMaterialText(m.name)
    return mn.includes(norm) || norm.includes(mn)
  })
  if (candidates.length === 1) return { matched: candidates[0], candidates: [] as typeof materialTypes }
  return { matched: null, candidates }
}

function resolveMaterialInText(text: string, materialTypes: { id: string; name: string }[]) {
  const direct = resolveOne(text, materialTypes)
  if (direct.matched || direct.candidates.length > 0) return direct

  const stripped = stripQuantityAndIntent(text)
  const strippedMatch = resolveOne(stripped, materialTypes)
  if (strippedMatch.matched || strippedMatch.candidates.length > 0) return strippedMatch

  const candidates = materialTypes.filter((m) => {
    const mn = normalizeMaterialText(m.name)
    return stripped.includes(mn) || mn.includes(stripped)
  })
  if (candidates.length === 1) return { matched: candidates[0], candidates: [] as typeof materialTypes }
  return { matched: null, candidates }
}

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

// Strict pattern, not an LLM guess (owner instruction 2026-07-10: "อย่าให้
// AI เข้ามามั่วเยอะ") — only accepts real Thai phone number shapes.
function extractPhone(text: string): string | null {
  const m = text.match(/0[689]\d[-\s]?\d{3}[-\s]?\d{4}|0\d[-\s]?\d{3,4}[-\s]?\d{3,4}/)
  return m ? m[0].replace(/[-\s]/g, "") : null
}

const MISSING_LABEL: Record<string, string> = {
  partner: "ขอชื่อบริษัทหรือชื่อที่ติดต่อด้วยครับ",
  material: "ส่งชนิดวัสดุที่ต้องการให้หน่อยครับ",
  quantity: "ขอจำนวนที่ต้องการด้วยครับ",
  destination: "ส่ง GPS หรือที่อยู่จัดส่งให้หน่อยครับ",
  contact: "ขอชื่อผู้ติดต่อหน้างานกับเบอร์โทรด้วยครับ",
}

const QUOTE_ONLY_TYPES = new Set(["ขอราคา", "สอบถามทั่วไป", "inquiry"])

export async function tryCompleteAwaitingEvent(
  supabase: any,
  userId: string,
  replyText: string,
  currentLineEventId: string | null = null
): Promise<string | null> {
  const { data: ev } = await supabase
    .from("business_events")
    .select("id, event_type, partner_id, material_text, quantity, quantity_unit, destination, contact_name, contact_phone, source_message_ids")
    .eq("source_line_user_id", userId)
    .eq("status", "awaiting_info")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!ev) return null // no open question — caller falls back to normal handling

  const { data: materialTypes } = await supabase.from("material_types").select("id, name")
  const updates: Record<string, unknown> = {}
  const isQuoteOnly = QUOTE_ONLY_TYPES.has(ev.event_type ?? "")

  // Try the reply as the answer to whichever thing is still missing.
  const phoneInReply = extractPhone(replyText)
  const quantityInReply = extractQuantity(replyText)
  if (!ev.quantity && quantityInReply) {
    updates.quantity = quantityInReply.quantity
    if (quantityInReply.unit && !ev.quantity_unit) updates.quantity_unit = quantityInReply.unit
  }

  const materialInReply = resolveMaterialInText(replyText, materialTypes ?? [])
  const stillAmbiguousMaterial = ev.material_text
    ? splitMaterialText(ev.material_text).find((p) => !resolveOne(p, materialTypes ?? []).matched)
    : true
  if (materialInReply.matched && stillAmbiguousMaterial) {
    const parts = splitMaterialText(ev.material_text ?? "")
    updates.material_text = parts.length
      ? parts.map((p) => (p === stillAmbiguousMaterial ? materialInReply.matched!.name : p)).join(", ")
      : materialInReply.matched.name
  }

  if (!ev.contact_phone && phoneInReply) {
    // A real phone number is unambiguous — take it, and whatever's left
    // (after stripping the number) as the name, if there's real text there.
    updates.contact_phone = phoneInReply
    const nameLeftover = replyText.replace(phoneInReply, "").replace(/[-\s,]+/g, " ").trim()
    if (nameLeftover) updates.contact_name = nameLeftover
  }

  if (!ev.destination && !materialInReply.matched && !quantityInReply && !looksLikeAQuestion(replyText)) {
    // Not a material/quantity answer and destination is still open — treat this
    // reply as the location (own words like "เหมือนเดิม" pass through as-is).
    updates.destination = replyText.trim()
  }

  if (currentLineEventId) {
    updates.source_message_ids = [...new Set([...(ev.source_message_ids ?? []), currentLineEventId])]
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from("business_events").update(updates).eq("id", ev.id)
  }
  if (currentLineEventId) {
    await supabase.from("line_events").update({ status: "processed", admin_note: `used_by_business_event:${ev.id}` }).eq("id", currentLineEventId)
  }

  const merged = { ...ev, ...updates }

  const missing: string[] = []
  let ambiguous: { input: string; candidates: string[] } | null = null

  if (!isQuoteOnly && !merged.partner_id) missing.push("partner")

  if (!merged.material_text) {
    missing.push("material")
  } else {
    for (const part of splitMaterialText(merged.material_text)) {
      const r = resolveOne(part, materialTypes ?? [])
      if (!r.matched) {
        missing.push("material")
        if (r.candidates.length > 0) ambiguous = { input: part, candidates: r.candidates.map((c) => c.name) }
        break
      }
    }
  }

  if (!merged.quantity) missing.push("quantity")

  if (isQuoteOnly) {
    // Real gap diagnosed 2026-07-10: a GPS pin lands in line_events but was
    // never checked here — this used to demand the text field even when a
    // real location share already answered the question.
    if (!merged.destination) {
      const { data: recentLocation } = await supabase
        .from("line_events").select("raw_text").eq("line_user_id", userId).eq("raw_type", "location")
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
      if (recentLocation) {
        merged.destination = recentLocation.raw_text
        await supabase.from("business_events").update({ destination: recentLocation.raw_text }).eq("id", ev.id)
      } else {
        missing.push("destination")
      }
    }
    if (missing.length > 0) {
      return ambiguous
        ? `"${ambiguous.input}" เอาชนิดไหนครับ ${ambiguous.candidates.join(" / ")}`
        : missing.map((m) => MISSING_LABEL[m]).filter(Boolean).join(" ")
    }
    // Real gap diagnosed 2026-07-10: "ready_to_quote" used to be just a
    // status with nothing ever actually calling the pricing engine — this
    // closes it for real, material price only (no vehicle/trip/transport,
    // that's a separate piece per owner instruction "ไม่ต้องไล่รถ").
    const priceReply = await tryQuoteMaterialPrice(supabase, userId, merged.material_text, merged.quantity, merged.destination)
    await supabase.from("business_events").update({ status: "quoted" }).eq("id", ev.id)
    return priceReply
  }

  // Real order — a site is never silently reused.
  let siteId: string | null = null
  if (merged.partner_id) {
    const { data: sites } = await supabase
      .from("customer_sites").select("id, site_name").eq("customer_company_id", merged.partner_id).eq("is_active", true)
      .order("created_at", { ascending: false }).limit(1)
    const site = sites?.[0]
    if (site) {
      const destText = (merged.destination ?? "").trim()
      const confirmedBySameWord = /เหมือนเดิม|ที่เดิม|เดิม|เหมือนครั้งก่อน/.test(destText)
      const confirmedByName = destText && site.site_name && destText.includes(site.site_name)
      if (confirmedBySameWord || confirmedByName) {
        siteId = site.id
      } else if (merged.destination) {
        const parsed = parseThaiAddress(merged.destination)
        if (parsed) {
          const { data: newSite, error } = await supabase.from("customer_sites").insert({
            customer_company_id: merged.partner_id, site_name: merged.destination.slice(0, 40), address: merged.destination,
            province: parsed.province, district: parsed.district, subdistrict: parsed.subdistrict, postal_code: parsed.postal_code,
            is_active: true, updated_at: new Date().toISOString(),
          }).select("id").single()
          if (!error) siteId = newSite.id
          else missing.push("destination")
        } else {
          missing.push("destination")
        }
      } else {
        missing.push("destination")
      }
      if (!siteId && !missing.includes("destination")) {
        return `ส่งที่ "${site.site_name}" เหมือนเดิมไหมครับ หรือที่ใหม่ (ถ้าที่ใหม่ ส่ง GPS หรือที่อยู่มาได้เลยครับ)`
      }
    } else {
      // No site on file yet and no destination text — same gap as above,
      // check for a real location share before giving up.
      let destText = merged.destination
      if (!destText) {
        const { data: recentLocation } = await supabase
          .from("line_events").select("raw_text").eq("line_user_id", userId).eq("raw_type", "location")
          .order("created_at", { ascending: false }).limit(1).maybeSingle()
        destText = recentLocation?.raw_text ?? null
      }
      const parsed = destText ? parseThaiAddress(destText) : null
      if (parsed) {
        const { data: newSite, error } = await supabase.from("customer_sites").insert({
          customer_company_id: merged.partner_id, site_name: destText!.slice(0, 40), address: destText,
          province: parsed.province, district: parsed.district, subdistrict: parsed.subdistrict, postal_code: parsed.postal_code,
          is_active: true, updated_at: new Date().toISOString(),
        }).select("id").single()
        if (!error) { siteId = newSite.id; await supabase.from("business_events").update({ destination: destText }).eq("id", ev.id) }
        else missing.push("destination")
      } else {
        missing.push("destination")
      }
    }
  }

  // A truck can't be dispatched without someone to call at the site — real
  // working flow already needed this before today (seen in real chat
  // history: "ชื่อผู้ติดต่อ...เบอร์โทรศัพท์..."), just never enforced here.
  if (!merged.contact_phone) missing.push("contact")

  if (missing.length > 0) {
    return ambiguous
      ? `"${ambiguous.input}" เอาชนิดไหนครับ ${ambiguous.candidates.join(" / ")}`
      : missing.map((m) => MISSING_LABEL[m]).filter(Boolean).join(" ")
  }

  // Everything needed is here now — actually open the Job, same chain as
  // engines/jobs/auto-create.ts / app/api/admin/transactions/route.ts.
  const stamp = Date.now().toString().slice(-6)
  const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, "")
  const title = [merged.material_text, merged.quantity ? `${merged.quantity} ${merged.quantity_unit ?? ""}`.trim() : null]
    .filter(Boolean).join(" ") || "งานใหม่จาก LINE"

  const { data: project, error: pErr } = await supabase.from("projects").insert({
    project_no: `PRJ-${dateStr}-${stamp}`, customer_company_id: merged.partner_id, customer_site_id: siteId,
    title, status: "ACTIVE", updated_at: new Date().toISOString(),
  }).select("id, project_no").single()
  if (pErr) return "รับทราบครับ เดี๋ยวเปิดงานให้ครับ" // save what we have, don't block the reply on an internal error

  const { data: dg, error: dgErr } = await supabase.from("document_groups").insert({
    group_no: `DG-${dateStr}-${stamp}`, project_id: project.id, project_no: project.project_no,
    customer_company_id: merged.partner_id, title, status: "OPEN", updated_at: new Date().toISOString(),
  }).select("id").single()
  if (dgErr) return "รับทราบครับ เดี๋ยวเปิดงานให้ครับ"

  const { data: order, error: oErr } = await supabase.from("customer_orders").insert({
    order_no: `ORD-${dateStr}-${stamp}`, project_id: project.id, document_group_id: dg.id,
    customer_company_id: merged.partner_id, customer_site_id: siteId, status: "DRAFT",
    delivery_note: `ผู้ติดต่อหน้างาน: ${merged.contact_name ?? "-"} โทร ${merged.contact_phone}`,
    updated_at: new Date().toISOString(),
  }).select("id, order_no").single()
  if (oErr) return "รับทราบครับ เดี๋ยวเปิดงานให้ครับ"

  await supabase.from("business_events").update({ transaction_id: order.id, status: "job_created" }).eq("id", ev.id)

  return `เปิดงานให้แล้วครับ (${order.order_no}) เดี๋ยวทีมงานติดต่อกลับไปนะครับ`
}
