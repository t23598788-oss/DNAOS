// Automatic Supabase billing detection (owner, 2026-07-31): "ตอนไหนที่มี
// อีเมลแจ้งเตือนเข้ามาเกี่ยวกับค่าใช้จ่ายซูเปอร์เบสให้ระบบไปจับตรวจอีเมล
// แจ้งเตือนค่าใช้จ่ายแล้วเอามาบอกว่าต้องจ่าย ให้แปลเงินดอลล่าร์เป็นเงินบาท"
// then "แจ้งเข้ามาบอกเฮียในแอปหรือแชท LINE ส่วนตัวเฮีย...เฮียโอนแล้วจะส่ง
// สลิป...นำค่าใช้จ่ายเข้าไปลงบันทึก" — real email format confirmed live
// against the owner's own inbox (2026-07-31): a genuine overdue-invoice
// email from Supabase ("your outstanding invoice STUIEQ-00006 with $39.51
// due since July 15") — this is the exact real trigger, not guessed.
// Same Gmail OAuth (read-only) + per-function cron-secret pattern as
// bank-email-sync/fuel-price-sync (Rule 108) — dedup via
// supabase_billing_events.gmail_message_id (same real pattern as
// bank_notifications). Notification + approve/pay/record flow all reuses
// the EXISTING partner-payable cascade (engines/owner-dispatcher.ts,
// capability #18) rather than building a second parallel notify system —
// partner_company_id/partner_line_user_id are both nullable there
// specifically because not every payable has a real LINE-reachable partner
// on the other end (verified by reading the migration before reusing it).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { requestPartnerPayableApproval } from "../line-webhook-v2/engines/owner-dispatcher.ts"

function base64UrlDecode(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (data.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder("utf-8").decode(bytes)
}

function findPart(payload: any, mimeType: string): string | null {
  if (payload?.mimeType === mimeType && payload?.body?.data) return base64UrlDecode(payload.body.data)
  for (const part of payload?.parts ?? []) {
    const found = findPart(part, mimeType)
    if (found) return found
  }
  return null
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
}

function extractBodyText(payload: any): string {
  const plain = findPart(payload, "text/plain")
  if (plain) return plain
  const html = findPart(payload, "text/html") ?? (payload?.body?.data ? base64UrlDecode(payload.body.data) : "")
  return html ? htmlToPlainText(html) : ""
}

// Real format confirmed live: "outstanding invoice STUIEQ-00006 with
// $39.51 due since July 15" — invoice number and $ amount both appear on
// the same real sentence, no separate line-label pair like K BIZ's emails.
function parseSupabaseBillingEmail(body: string): { invoiceNumber: string | null; amountUsd: number | null } {
  const invoiceMatch = body.match(/invoice\s+([A-Z0-9-]+)/i)
  const amountMatch = body.match(/\$\s*([\d,]+\.?\d*)/)
  return {
    invoiceNumber: invoiceMatch ? invoiceMatch[1] : null,
    amountUsd: amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : null,
  }
}

// Deno-side mirror of engines/bot-exchange-rate.ts's getExchangeRateFor()
// (Node/Next.js runtime — cannot be imported directly here, same real
// network-topology reason documented in external-facts.ts). Same real BOT
// API, same key (now also set as a Supabase secret).
async function getUsdToThbRate(): Promise<number | null> {
  const apiKey = Deno.env.get("BOT_API_KEY")
  if (!apiKey) return null
  const end = new Date().toISOString().slice(0, 10)
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 4)
  const start = startDate.toISOString().slice(0, 10)
  try {
    const res = await fetch(
      `https://gateway.api.bot.or.th/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/?start_period=${start}&end_period=${end}`,
      { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(6000) },
    )
    if (!res.ok) return null
    const data = await res.json()
    const detail: any[] = data?.result?.data?.data_detail ?? []
    if (detail.length === 0) return null
    const latestPeriod = detail[0].period
    const usdRow = detail.find((r) => r.period === latestPeriod && r.currency_id === "USD")
    return usdRow ? Number(usdRow.mid_rate) : null
  } catch {
    return null // honest failure — never fabricate a rate
  }
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("BILLING_SYNC_CRON_SECRET")
  const got = req.headers.get("x-cron-secret")
  if (!expected || got !== expected) return new Response("unauthorized", { status: 401 })

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  const clientId = Deno.env.get("GMAIL_CLIENT_ID")
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")
  const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN")
  if (!clientId || !clientSecret || !refreshToken) {
    return Response.json({ error: "Gmail credentials not configured" }, { status: 500 })
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  })
  if (!tokenRes.ok) return Response.json({ error: "Gmail token refresh failed" }, { status: 502 })
  const { access_token: accessToken } = await tokenRes.json()

  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=" +
      encodeURIComponent("from:supabase.com subject:(invoice OR overdue OR payment) newer_than:14d") +
      "&maxResults=20",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!listRes.ok) return Response.json({ error: `Gmail list API HTTP ${listRes.status}` }, { status: 502 })
  const listData = await listRes.json()
  const messageIds: string[] = (listData.messages ?? []).map((m: any) => m.id)

  let notified = 0
  let skipped = 0
  const errors: string[] = []

  for (const id of messageIds) {
    const { data: existing } = await supabase.from("supabase_billing_events").select("id").eq("gmail_message_id", id).maybeSingle()
    if (existing) { skipped++; continue }

    const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!msgRes.ok) { errors.push(`message ${id}: HTTP ${msgRes.status}`); continue }
    const msg = await msgRes.json()
    const headers = Object.fromEntries((msg.payload?.headers ?? []).map((h: any) => [h.name, h.value]))
    const body = extractBodyText(msg.payload)
    const { invoiceNumber, amountUsd } = parseSupabaseBillingEmail(body)

    if (!amountUsd) { skipped++; continue } // no real $ amount found — not a billing-due email, e.g. a security-advisor notice

    const rate = await getUsdToThbRate()
    const amountThb = rate ? Math.round(amountUsd * rate * 100) / 100 : null

    const { data: eventRow } = await supabase.from("supabase_billing_events").insert({
      gmail_message_id: id,
      invoice_number: invoiceNumber,
      amount_usd: amountUsd,
      amount_thb: amountThb,
      exchange_rate: rate,
      email_subject: headers.Subject ?? null,
      email_received_at: headers.Date ? new Date(headers.Date).toISOString() : null,
      status: "pending",
    }).select("id").single()

    if (amountThb && eventRow) {
      const payable = await requestPartnerPayableApproval(supabase, {
        partnerCompanyId: null,
        partnerName: "Supabase (ค่าบริการรายเดือน)",
        partnerLineUserId: null,
        amount: amountThb,
        description: `ใบแจ้งหนี้ ${invoiceNumber ?? "-"} — $${amountUsd.toFixed(2)} (อัตราแลกเปลี่ยน ${rate?.toFixed(4)})`,
        businessEventId: null,
      })
      if (payable) {
        await supabase.from("supabase_billing_events")
          .update({ status: "owner_notified", partner_payable_request_id: payable.id })
          .eq("id", eventRow.id)
      }
    }
    notified++
  }

  return Response.json({ notified, skipped, errors })
})
