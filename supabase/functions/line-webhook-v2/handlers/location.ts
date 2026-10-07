import type { HandlerContext, LineMessageEvent, LineLocationMessage } from "../events/types.ts"
import { saveEvent, markEventError } from "../events/store.ts"
import { ResponseGateway } from "../engines/response.ts"
import { locationReceivedFlex } from "../templates/flex/location-received.ts"
import { tryCompleteAwaitingEvent } from "../engines/event-followup.ts"

// LINE's own location-share already geocodes into a Thai address string
// (ตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์) — no need for Google Maps at all for this
// case. Parsed here so a shared LINE pin becomes a real customer_sites row
// immediately, instead of sitting as a raw message the system asks about
// again later (owner-reported bug 2026-07-10: asked for GPS a contact had
// already sent 17 days earlier).
export function parseThaiAddress(raw: string): { subdistrict: string; district: string; province: string; postal_code: string } | null {
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

export async function handleLocation(ctx: HandlerContext): Promise<void> {
  const msgEvent = ctx.event as LineMessageEvent
  const msg = msgEvent.message as LineLocationMessage

  const address  = msg.address || msg.title || "พิกัดที่ส่งมา"
  const lat      = msg.latitude
  const lng      = msg.longitude

  const saved = await saveEvent(ctx.supabase, {
    event:     ctx.event,
    userId:    ctx.userId,
    groupId:   ctx.groupId,
    channelDestination: ctx.channelDestination,
    rawType:   "location",
    rawText:   address,
    extracted: { latitude: lat, longitude: lng, address },
  })

  if (!saved) {
    console.error("[location] saveEvent failed — skipping reply")
    return
  }

  // Redelivered webhook — already processed this exact pin, don't create a
  // second site / reply again.
  if (saved.duplicate) return

  // If we already know which company this contact is, turn the pin into a
  // real site right now — don't wait for a Job to need it later.
  if (ctx.userId) {
    const { data: link } = await ctx.supabase
      .from("company_line_links").select("company_id").eq("line_user_id", ctx.userId).maybeSingle()
    const parsed = parseThaiAddress(address)
    if (link && parsed) {
      const { data: existing } = await ctx.supabase
        .from("customer_sites").select("id").eq("customer_company_id", link.company_id).eq("is_active", true).limit(1).maybeSingle()
      if (!existing) {
        await ctx.supabase.from("customer_sites").insert({
          customer_company_id: link.company_id,
          site_name: "จากพิกัด LINE",
          address,
          province: parsed.province,
          district: parsed.district,
          subdistrict: parsed.subdistrict,
          postal_code: parsed.postal_code,
          gps_lat: lat,
          gps_lng: lng,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
      }
    }
  }

  const flex = locationReceivedFlex({ address, lat, lng })

  if (ctx.replyToken) {
    await ResponseGateway.replyFlex(ctx.replyToken, "พิกัดที่ได้รับ", flex)
  }

  // Real bug, live 2026-07-26: sending a GPS pin never advanced an open
  // awaiting_info event on its own — the customer had to send a SEPARATE
  // text message afterward before anything progressed, which is exactly
  // what led to "ก็กูบอกกูส่งไปแล้ว" (frustrated) getting typed and then
  // wrongly stored as the delivery address (see event-followup.ts's
  // looksLikeConfusionOrFiller fix, same incident). A location pin IS a
  // real answer — check for an open question right here. The reply token
  // is already spent on the flex card above, so this goes out as a push.
  if (ctx.userId) {
    const followup = await tryCompleteAwaitingEvent(ctx.supabase, ctx.userId, address, saved.id)
    if (followup) {
      if (followup.flex?.length === 1) {
        await ResponseGateway.pushFlex(ctx.userId, followup.text.slice(0, 100) || "ใบเสนอราคา", followup.flex[0])
      } else {
        await ResponseGateway.pushMessage(ctx.userId, followup.text)
      }
    }
  }
}
