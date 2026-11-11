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
import { ResponseGateway } from "./response.ts"
import { requestCanonicalJob } from "../../_shared/canonicalTransport.ts"
// Type-only import (erased at runtime, so no import cycle with
// build-event-from-extraction.ts, which imports THIS file).
import type { ExtractedEvent } from "./build-event-from-extraction.ts"

// Deterministic, not an LLM guess (owner instruction 2026-07-10: "อย่าให้ AI
// เข้ามามั่วเยอะ") — a reply containing these words is almost certainly a
// question, not an address, so it should never get stored as a destination.
function looksLikeAQuestion(text: string): boolean {
  return /เท่าไหร่|เท่าไร|ราคา|กี่|ไหม|หรือเปล่า|มั้ย|\?/.test(text)
}

// Same State-Specific Guard Rail class as debt-followup.ts's KM-006
// (registry/existence.json known_mistakes, found 2026-07-24 from a real
// screenshot: "งง"/"ไลน์ อะไรงั้นนี้" while an event was open). Without this,
// the destination fallback below would happily store those as the delivery
// address — and since it only fills destination when currently empty, a
// REAL address sent afterward would never overwrite the garbage, silently
// stalling the order forever. A real Thai address is either reasonably long
// or contains a plausible address/location word; short reactions and
// generic interrogatives ("อะไร", "ยังไง", "ทำไม") are neither.
function looksLikeConfusionOrFiller(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length <= 3) return true
  // Real bug, live 2026-07-26: "ส่งไปแล้วไง" (frustrated "I already sent it")
  // slipped through and got stored as the delivery address, because "ไง" on
  // its own (not "ยังไง") wasn't in this list — added "ไง$" and "ส่งไปแล้ว"
  // as its own signal (a claim about a past action, never a location).
  return /อะไร|ยังไง|ทำไม|งง|หา\?|ไม่เข้าใจ|ไงๆ?$|ส่งไปแล้ว|บอกว่า.*แล้ว/.test(trimmed)
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

// Real bug, live 2026-07-26: material_types.name can hold multiple aliases
// in one field ("ทรายหยาบ หรือ ทรายถม") — a customer who types just
// "ทรายหยาบ" doesn't substring-match that combined string at all
// (mn.includes(norm) fails since "ทรายหยาบหรือทรายถม" doesn't contain
// "ทรายหยาบรวมส่ง", norm.includes(mn) fails the same way), so a real,
// obviously-valid material name got treated as unrecognized. Split on
// "หรือ" and match against each alias separately — deterministic, not a
// guess, since "หรือ" inside a material_types.name is always an alias
// separator in how this table is actually populated, never part of a real
// material's own name.
// Audit finding 2026-07-26 (architecture-audit-report.txt §5): this looks
// like the same function as quote-price.ts's nameAliases/resolveOne, but
// isn't safely mergeable — real contract differences, not laziness: this
// version normalizes via normalizeMaterialText() (handles suffix noise like
// "รวมส่ง") and resolveOne() here returns { matched, candidates } so callers
// can ask the customer to disambiguate, whereas quote-price.ts's resolveOne
// takes an already-disambiguated single name and returns a match or null.
// Unifying would mean changing one side's return contract and normalization,
// a real behavior-risk to live order/quote flow for no functional gain —
// left duplicated on purpose, now documented instead of silently repeated.
function nameAliases(name: string): string[] {
  return name.split("หรือ").map((a) => normalizeMaterialText(a)).filter(Boolean)
}

function resolveOne(input: string, materialTypes: { id: string; name: string }[]) {
  const norm = normalizeMaterialText(input)
  const exact = materialTypes.find((m) => nameAliases(m.name).includes(norm))
  if (exact) return { matched: exact, candidates: [] as typeof materialTypes }
  const candidates = materialTypes.filter((m) => {
    return nameAliases(m.name).some((mn) => mn.includes(norm) || norm.includes(mn))
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
    return nameAliases(m.name).some((mn) => stripped.includes(mn) || mn.includes(stripped))
  })
  if (candidates.length === 1) return { matched: candidates[0], candidates: [] as typeof materialTypes }
  return { matched: null, candidates }
}

// Resumes an awaiting_info event once ai-task-watcher.mjs's local Ollama
// model has resolved a material name the deterministic matcher above
// couldn't (see the "resolve_material" ai_tasks kind). Reruns the same
// missing-field + quoting logic as tryCompleteAwaitingEvent's tail — no new
// business rule, just re-entering the same completeness check now that the
// blocking field is filled.
// Owner instruction (2026-07-26): "จัดระเบียบเป็นการ์ดที่ LINE มีไว้ให้" — a
// real price quote carries an optional Flex card alongside the plain text
// (plain text stays as the record/fallback; `flex` is what actually gets
// sent when present — see call sites in handlers/text.ts and ai-callback).
export interface FollowupReply {
  text: string
  flex?: object[]
}

import { sendConnectEventCommand, CONNECT_PROVIDER } from "../../_shared/connect-event.ts"
import { createCustomerSiteViaConnect } from "../../_shared/connect-customer-site.ts"

export async function completeAfterMaterialResolved(
  supabase: any,
  userId: string,
  businessEventId: string,
  resolvedMaterialName: string,
): Promise<FollowupReply | null> {
  const { data: ev } = await supabase
    .from("business_events")
    .select("id, event_type, partner_id, material_text, quantity, quantity_unit, destination")
    .eq("id", businessEventId)
    .maybeSingle()
  if (!ev) return null

  // Capability D: BUSINESS METADATA through the Connect transport.
  await sendConnectEventCommand("business_event.enrich", {
    event_id: ev.id,
    fields: { material_text: resolvedMaterialName },
  }, `system:${CONNECT_PROVIDER}:event-followup`)
  const merged = { ...ev, material_text: resolvedMaterialName }

  const isQuoteOnly = QUOTE_ONLY_TYPES.has(ev.event_type ?? "")
  if (!isQuoteOnly) return null // real orders go through the full synchronous flow only, unchanged

  if (!merged.quantity) return { text: MISSING_LABEL.quantity }

  if (!merged.destination) {
    const { data: recentLocation } = await supabase
      .from("line_events").select("raw_text").eq("line_user_id", userId).eq("raw_type", "location")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (recentLocation) {
      merged.destination = recentLocation.raw_text
      await sendConnectEventCommand("business_event.enrich", {
        event_id: ev.id,
        fields: { destination: recentLocation.raw_text },
      }, `system:${CONNECT_PROVIDER}:event-followup`)
    } else {
      return { text: MISSING_LABEL.destination }
    }
  }

  const priceResult = await tryQuoteMaterialPrice(supabase, userId, merged.material_text, merged.quantity, merged.destination, merged.quantity_unit, ev.id)
  if (priceResult.ok) {
    // Capability D — composite, preserving the original business effect:
    //   ENRICH quoted_amount (EVENT DATA ONLY — no payment/allocation/ledger/debt
    //   arithmetic happens here or anywhere in the event writer) then
    //   TRANSITION → quoted (target-only: this function never proved the from-state).
    await sendConnectEventCommand("business_event.enrich", {
      event_id: ev.id,
      fields: { quoted_amount: priceResult.amount ?? null },
    }, `system:${CONNECT_PROVIDER}:event-followup`)
    await sendConnectEventCommand("business_event.transition", {
      event_id: ev.id,
      status: "quoted",
    }, `system:${CONNECT_PROVIDER}:event-followup`)
  }
  return { text: priceResult.text, flex: priceResult.flex ? [priceResult.flex] : undefined }
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
): Promise<FollowupReply | null> {
  const { data: ev } = await supabase
    .from("business_events")
    .select("id, event_type, partner_id, material_text, quantity, quantity_unit, destination, contact_name, contact_phone, source_message_ids, created_at")
    .eq("source_line_user_id", userId)
    .eq("status", "awaiting_info")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!ev) return null // no open question — caller falls back to normal handling

  // Real bug, owner-reported 2026-07-30 (live, real customer harm — a
  // debtor's message describing genuine financial hardship, replying to a
  // debt-collection event, got hijacked into re-asking for material/
  // quantity/GPS/contact info from an old, unrelated, forgotten quote
  // request): this query only ever looked within status="awaiting_info"
  // rows, completely blind to whether a NEWER event of a DIFFERENT status
  // (e.g. "awaiting_payment_date" from the debt-follow-up flow) exists for
  // the same contact — meaning a stale awaiting_info quote from long ago
  // permanently hijacked every future message from that contact, no matter
  // what the conversation had actually moved on to. Guard: if this contact
  // has ANY business_events row created more recently than this awaiting_info
  // one, the conversation has moved on — don't hijack, let the caller's
  // other handlers (tryFollowUpDebtAck etc.) resolve the ACTUAL current
  // context instead of reviving a dead one.
  const { data: newerEvent } = await supabase
    .from("business_events")
    .select("id, created_at")
    .eq("source_line_user_id", userId)
    .neq("id", ev.id)
    .gt("created_at", ev.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (newerEvent) return null // a newer, different event exists — this one is stale, don't revive it

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

  if (!ev.destination && !materialInReply.matched && !quantityInReply && !looksLikeAQuestion(replyText) && !looksLikeConfusionOrFiller(replyText)) {
    // Not a material/quantity answer, not a question, not obvious filler/
    // confusion, and destination is still open — treat this reply as the
    // location (own words like "เหมือนเดิม" pass through as-is).
    updates.destination = replyText.trim()
  }

  if (currentLineEventId) {
    updates.source_message_ids = [...new Set([...(ev.source_message_ids ?? []), currentLineEventId])]
  }

  if (Object.keys(updates).length > 0) {
    // Capability D — FIELD CENSUS of `updates` (all seven properties are
    // business metadata, none is a state or a transaction link):
    //   quantity · quantity_unit · material_text · contact_phone · contact_name
    //   · destination · source_message_ids  →  ENRICH (explicit fields only).
    // The object is NOT forwarded: each property is mapped explicitly below.
    await sendConnectEventCommand("business_event.enrich", {
      event_id: ev.id,
      fields: {
        ...(updates.quantity !== undefined ? { quantity: updates.quantity } : {}),
        ...(updates.quantity_unit !== undefined ? { quantity_unit: updates.quantity_unit } : {}),
        ...(updates.material_text !== undefined ? { material_text: updates.material_text } : {}),
        ...(updates.contact_phone !== undefined ? { contact_phone: updates.contact_phone } : {}),
        ...(updates.contact_name !== undefined ? { contact_name: updates.contact_name } : {}),
        ...(updates.destination !== undefined ? { destination: updates.destination } : {}),
        ...(updates.source_message_ids !== undefined ? { source_message_ids: updates.source_message_ids } : {}),
      },
    }, `system:${CONNECT_PROVIDER}:event-followup`)
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
        await sendConnectEventCommand("business_event.enrich", {
          event_id: ev.id,
          fields: { destination: recentLocation.raw_text },
        }, `system:${CONNECT_PROVIDER}:event-followup`)
      } else {
        missing.push("destination")
      }
    }
    if (missing.length > 0) {
      if (ambiguous) return { text: `"${ambiguous.input}" เอาชนิดไหนครับ ${ambiguous.candidates.join(" / ")}` }

      // Owner instruction (2026-07-26): deterministic substring matching
      // can't keep up with every phrasing a customer might use for a real
      // material — hand-patching normalizeMaterialText per case forever
      // doesn't scale. Before telling the customer "material?" (which is
      // simply wrong when they DID name a real one, just phrased
      // differently — see EV260725 "ทรายหยาบ" vs the DB's "ทรายหยาบ หรือ
      // ทรายถม"), let the local Ollama model try a closed-set match against
      // the real material_types list first. Only genuinely material-missing
      // (empty reply, pure question, etc.) skips this — no point asking an
      // LLM to match nothing.
      if (missing.includes("material") && missing.length === 1 && replyText.trim().length > 1) {
        await supabase.from("ai_tasks").insert({
          kind: "resolve_material",
          line_user_id: userId,
          business_event_id: ev.id,
          input_text: replyText,
          status: "pending",
        })
        // Real "..." typing indicator (owner-reported bug, 2026-07-26) —
        // same fix as handlers/text.ts, applied here too.
        await ResponseGateway.showLoading(userId, 30)
        // Owner correction (2026-07-26): "ต้องรออีกนานไหม...เค้าอยากรู้
        // ข้อจำกัดของข้อความนี้" — an open-ended "checking" leaves a real
        // customer hanging exactly like the earlier "เดี๋ยวเช็คให้นะครับ"
        // problem. State the real, measured bound instead of a vague
        // promise: the local watcher polls every 20s (see com.dnaos.ai-
        // task-watcher.plist's StartInterval), so give a concrete window.
        return { text: "รับทราบครับ กำลังตรวจสอบรายการวัสดุให้ครับ รอประมาณ 30 วินาทีนะครับ" }
      }

      // Real bug, live 2026-07-26: a genuinely unrelated question ("ราคา 10
      // คิวที่สั่งไว้จะได้ตอนไหน", "ส่งได้เลยไหมพรุ่งนี้") kept getting force-
      // fit as "still no destination" and re-answered with the same canned
      // "ส่ง GPS..." prompt — nonsensical and repetitive when the customer
      // is clearly asking something else, not answering a location
      // question. Owner correction (2026-07-26, audit finding): the first
      // fix only covered "destination" — generalized to ANY single missing
      // field (material/quantity/destination/contact/partner), since the
      // same false-hijack risk exists for all of them, not just location.
      // Only when there's exactly one missing thing AND the reply reads as
      // a real question: don't nag, let it fall through to whatever engine
      // can actually answer instead of hijacking it as bad data.
      // Real bug, live 2026-07-30 (audit widening): this guard used to only
      // fire when exactly one field was missing — a customer whose open
      // event was missing TWO fields (e.g. material + destination) who then
      // asked something totally unrelated ("เชื้อเพลิง", "ขอเลขบชคับ") still
      // got force-fed the same canned two-field nag on every message, since
      // `missing.length === 1` never held. A message that reads as a
      // question is never a legitimate answer to a missing-field prompt
      // regardless of how many fields are still open — drop the
      // missing.length gate entirely.
      if (looksLikeAQuestion(replyText)) {
        return null
      }

      return { text: missing.map((m) => MISSING_LABEL[m]).filter(Boolean).join(" ") }
    }
    // Real gap diagnosed 2026-07-10: "ready_to_quote" used to be just a
    // status with nothing ever actually calling the pricing engine — this
    // closes it for real, material price only (no vehicle/trip/transport,
    // that's a separate piece per owner instruction "ไม่ต้องไล่รถ").
    //
    // Real bug, live 2026-07-26: merged.material_text can hold multiple
    // materials joined by comma ("หินคลุก, ทรายหยาบ หรือ ทรายถม") when a
    // customer asks for several at once — passing that whole joined string
    // to tryQuoteMaterialPrice as if it were one material name never
    // matched anything, so a request that WAS fully understood (both
    // materials real, quantity/destination known) still failed with a
    // generic "not found" reply. Quote each material in the list
    // separately and combine the real answers into one reply instead.
    const priceResults = await Promise.all(
      splitMaterialText(merged.material_text).map((part) =>
        tryQuoteMaterialPrice(supabase, userId, part, merged.quantity, merged.destination, merged.quantity_unit, ev.id)
      )
    )
    // Owner-reported bug 2026-07-11: this used to mark every reply "quoted"
    // even an apology ("ยังไม่มีบ่อไหนตั้งราคาไว้") — the request silently
    // vanished from the quotation queue as if it were resolved. Only a real
    // computed price counts as quoted; anything else stays ready_to_quote so
    // it keeps showing up as needing attention (set a real price at
    // /admin/pits).
    if (priceResults.every((r) => r.ok)) {
      const totalAmount = priceResults.reduce((sum, r) => sum + (r.amount ?? 0), 0)
      // Capability D — composite: ENRICH quoted_amount (EVENT DATA ONLY; the sum is
      // the pre-existing price aggregation, not new financial authority) then
      // TRANSITION → quoted (target-only, from-state not proven here).
      await sendConnectEventCommand("business_event.enrich", {
        event_id: ev.id,
        fields: { quoted_amount: totalAmount },
      }, `system:${CONNECT_PROVIDER}:event-followup`)
      await sendConnectEventCommand("business_event.transition", {
        event_id: ev.id,
        status: "quoted",
      }, `system:${CONNECT_PROVIDER}:event-followup`)
    }
    const flexCards = priceResults.flatMap((r) => (r.flex ? [r.flex] : []))
    return { text: priceResults.map((r) => r.text).join("\n\n"), flex: flexCards.length ? flexCards : undefined }
  }

  // Real order — a site is never silently reused.
  //
  // Real bug, live 2026-07-26: a customer sent a REAL GPS pin (LINE location
  // share, real lat/lng in line_events.extracted) and the system kept
  // asking "ส่ง GPS หรือที่อยู่จัดส่งให้หน่อยครับ" in a loop, ignoring the pin
  // entirely. Two separate causes:
  // 1) The "site already exists" branch below never checked for a recent
  //    location share at all (only the "no site yet" branch did) — fixed by
  //    checking it in both.
  // 2) Even where it was checked, parseThaiAddress() requires the text to
  //    literally contain "ตำบล"/"อำเภอ" + a 5-digit postal code — a real
  //    LINE location share's raw_text ("บ้านท่อน, เมืองขอนแก่น, จังหวัด
  //    ขอนแก่น") almost never matches that shape. A real GPS pin carries
  //    real lat/lng directly (line_events.extracted) — use that as the
  //    site's real coordinates instead of trying to regex-parse an address
  //    string that was never meant to satisfy that pattern.
  let siteId: string | null = null
  if (merged.partner_id) {
    const { data: recentLocation } = await supabase
      .from("line_events").select("raw_text, extracted").eq("line_user_id", userId).eq("raw_type", "location")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    const gpsLat = recentLocation?.extracted?.latitude ?? null
    const gpsLng = recentLocation?.extracted?.longitude ?? null
    const gpsText = recentLocation?.raw_text ?? null

    const { data: sites } = await supabase
      .from("customer_sites").select("id, site_name").eq("customer_company_id", merged.partner_id).eq("is_active", true)
      .order("created_at", { ascending: false }).limit(1)
    const site = sites?.[0]

    const destText = (merged.destination ?? "").trim()
    const confirmedBySameWord = /เหมือนเดิม|ที่เดิม|เดิม|เหมือนครั้งก่อน/.test(destText)
    const confirmedByName = Boolean(destText && site?.site_name && destText.includes(site.site_name))

    if (site && (confirmedBySameWord || confirmedByName)) {
      siteId = site.id
    } else if (gpsLat && gpsLng) {
      // A real GPS pin always wins over trying to regex-parse address text.
      const createdSite = await createCustomerSiteViaConnect(
        {
          customer_company_id: merged.partner_id,
          site_name: (gpsText ?? "หน้างานใหม่").slice(0, 40),
          address: gpsText,
          gps_lat: gpsLat,
          gps_lng: gpsLng,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        `system:${CONNECT_PROVIDER}:event-followup`,
      )
      if (createdSite.ok && createdSite.data?.site_id) {
        siteId = createdSite.data.site_id
        await sendConnectEventCommand("business_event.enrich", {
          event_id: ev.id,
          fields: { destination: gpsText },
        }, `system:${CONNECT_PROVIDER}:event-followup`)
      }
      else missing.push("destination")
    } else if (merged.destination) {
      const parsed = parseThaiAddress(merged.destination)
      if (parsed) {
        const createdSite = await createCustomerSiteViaConnect(
          {
            customer_company_id: merged.partner_id,
            site_name: merged.destination.slice(0, 40),
            address: merged.destination,
            province: parsed.province,
            district: parsed.district,
            subdistrict: parsed.subdistrict,
            postal_code: parsed.postal_code,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          `system:${CONNECT_PROVIDER}:event-followup`,
        )
        if (createdSite.ok && createdSite.data?.site_id) siteId = createdSite.data.site_id
        else missing.push("destination")
      } else if (site) {
        return { text: `ส่งที่ "${site.site_name}" เหมือนเดิมไหมครับ หรือที่ใหม่ (ถ้าที่ใหม่ ส่ง GPS หรือที่อยู่มาได้เลยครับ)` }
      } else {
        missing.push("destination")
      }
    } else {
      missing.push("destination")
    }
  }

  // A truck can't be dispatched without someone to call at the site — real
  // working flow already needed this before today (seen in real chat
  // history: "ชื่อผู้ติดต่อ...เบอร์โทรศัพท์..."), just never enforced here.
  if (!merged.contact_phone) missing.push("contact")

  // Same guard as the quote-only branch above (real bug, 2026-07-26,
  // generalized per audit finding to any single missing field, not just
  // destination): don't nag about a missing field with a canned prompt
  // when the message is clearly an unrelated question.
  if (missing.length === 1 && looksLikeAQuestion(replyText)) {
    return null
  }

  if (missing.length > 0) {
    return {
      text: ambiguous
        ? `"${ambiguous.input}" เอาชนิดไหนครับ ${ambiguous.candidates.join(" / ")}`
        : missing.map((m) => MISSING_LABEL[m]).filter(Boolean).join(" ")
    }
  }

  // IntegrPASS 6 (G2) — CROSS-RUNTIME: the chain is no longer written here.
  // Same chain, same semantics, but the write now goes through the canonical transport:
  //   LINE/Deno (CHANNEL) → transport envelope → canonical job → canonical executor → result
  // The Edge never writes projects/document_groups/customer_orders directly any more.
  const title = [merged.material_text, merged.quantity ? `${merged.quantity} ${merged.quantity_unit ?? ""}`.trim() : null]
    .filter(Boolean).join(" ") || "งานใหม่จาก LINE"
  const orderAttempt = await requestCanonicalJob({
    capability: "transaction.create",
    source_channel: "LINE",
    intent: "open_job_from_line_request",
    identity_refs: { line_user_id: userId ?? undefined, partner_id: merged.partner_id ?? null, event_id: ev.id },
    source_event_id: String(ev.id),
    correlation_id: String(ev.id),
    evidence_refs: [`line_event:${currentLineEventId ?? "-"}`],
    data_write: ["projects", "document_groups", "customer_orders"],
    exec_args: {
      customer_company_id: merged.partner_id,
      customer_site_id: siteId,
      title,
      contact_name: merged.contact_name ?? null,
      contact_phone: merged.contact_phone ?? null,
    },
  })

  const orderRef = orderAttempt.business_refs.find((r) => r.table === "customer_orders")
  if (orderAttempt.status === "ALREADY_EXECUTED" && orderRef) {
    // idempotent replay: the same source event already opened a job — never write twice
    return { text: "งานนี้เปิดไว้แล้วครับ เดี๋ยวทีมงานติดต่อกลับไปนะครับ" }
  }
  if (!orderRef || !orderAttempt.wrote) {
    // canonical side unavailable / blocked / needs approval: keep the channel reply honest and
    // do NOT fall back to a direct write (that is the bypass we are removing).
    return { text: "รับทราบครับ เดี๋ยวเปิดงานให้ครับ" }
  }

  // Capability D — split into its two real meanings, in the original effect order:
  //   LINK (canonical transaction identity) then TRANSITION (state). Neither the
  //   link nor the transition touches financial state; the transaction itself is
  //   owned by the canonical transaction writer / B-04.
  await sendConnectEventCommand("business_event.link_transaction", {
    event_id: ev.id,
    transaction_id: orderRef.id,
  }, `system:${CONNECT_PROVIDER}:event-followup`)
  await sendConnectEventCommand("business_event.transition", {
    event_id: ev.id,
    status: "job_created",
  }, `system:${CONNECT_PROVIDER}:event-followup`)

  return { text: `เปิดงานให้แล้วครับ เดี๋ยวทีมงานติดต่อกลับไปนะครับ` }
}

// ── Deterministic first pass (owner, 2026-09-20, item #5) ────────────────────
// Before this, the ONLY way a brand-new free-text message became a
// business_events row was the async local-AI pipeline: handlers/text.ts
// enqueues ai_tasks kind="handle_text" → ~/dna-os-ollama/ai-task-watcher.mjs on
// the owner's Mac → ai-callback → build-event-from-extraction.ts. Real
// consequence (REALITY_INVENTORY_STEP1.md headline #3 / FCR-015): when that one
// watcher process stopped, EVERY free-text request stalled — 29 tasks stuck
// since 2026-08-05 — because the Mac was a single point of failure for the
// whole channel. This is the in-repo, no-AI, no-Mac fallback that runs first.
//
// It fires only on signals that are already real and closed-set:
//   - the material matches a row in material_types (the same deterministic
//     matcher the rest of this file uses), AND
//   - either a real quantity ("10 คิว" / "5 ตัน") or an explicit price/order
//     phrase is present.
// Anything ambiguous still falls through to the same ai_tasks queue as before
// — that queue remains the deeper path for free text, it is simply no longer
// the ONLY path. Never guesses a material name (owner's standing rule:
// "ห้ามเดา") and never invents a destination — an empty destination produces
// the existing "ขอ GPS/ที่อยู่" question through the normal awaiting_info flow.
const PRICE_OR_ORDER_INTENT = /ราคา|ขอ|เท่าไหร่|เท่าไร|สั่ง|จัดส่ง|ส่งของ|ส่งให้|เอา|รับ|คิดเงิน|ประเมิน/
// The intent regex above is deliberately broad ("เอา"/"รับ"), so a clear
// cancellation is checked first — "ไม่เอาหินคลุกแล้ว" must never be read as a
// new price request.
const NEGATED_REQUEST = /ยกเลิก|ไม่ต้อง|ไม่เอา|เลิกเอา|ยังไม่(?:ต้อง|เอา)/

export function extractEventDeterministically(
  text: string,
  materialTypes: { id: string; name: string }[],
): ExtractedEvent | null {
  const trimmed = text.trim()
  if (!trimmed || looksLikeConfusionOrFiller(trimmed)) return null
  if (NEGATED_REQUEST.test(trimmed)) return null

  const material = resolveMaterialInText(trimmed, materialTypes)
  if (!material.matched) return null // not a material in the closed set — nothing real to assert

  const quantity = extractQuantity(trimmed)
  if (!quantity && !PRICE_OR_ORDER_INTENT.test(trimmed)) return null // a material word alone isn't a request

  return {
    event_type: "ขอราคา",
    material_text: material.matched.name,
    quantity: quantity?.quantity ?? null,
    quantity_unit: quantity?.unit ?? null,
    destination: null,
    schedule_text: null,
    contact_name: null,
    contact_phone: extractPhone(trimmed),
    status: "quotation_pending",
    // 1 = deterministic closed-set match, deliberately not an AI confidence score.
    confidence: 1,
  }
}
