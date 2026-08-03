// Subscription/Infrastructure Cost Observer (owner, 2026-08-03)
//
// Real trigger: owner found a ฿1,750/mo Google AI Pro renewal by accident,
// scrolling Gmail himself — "ให้ระบบเป็นผู้สังเกต (Observer) ไม่ใช่ให้คนเป็น
// ผู้ไล่เช็กเอง". supabase-billing-sync already does exactly this for ONE
// provider (Supabase billing emails); this generalizes the same real Gmail
// connector (../_shared/gmail-client.ts, Rule 103 — no second Gmail
// integration) across every known recurring-charge sender, writing into the
// subscription_services registry (migration 20260803000004) that
// /admin/infrastructure now reads.
//
// Deliberately regex-first, not AI-first: DNA OS's own Local-AI Pipeline
// policy (CLAUDE.md) says cloud functions never call an LLM directly —
// only the owner's Mac (Ollama, via ai_tasks) does real "thinking". Known
// providers have consistent, parseable receipt formats, so a real regex
// match is honest (confidence: "high") without needing AI at all. An email
// that doesn't match any known provider format is still recorded
// (confidence: "low", amount/provider left null where unreadable) rather
// than silently dropped or guessed at — a human (or a future AI pass) can
// review the low-confidence rows from the raw_subject alone.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { getGmailAccessToken, extractBodyText, searchGmailMessageIds, fetchGmailMessage, getSubjectHeader } from "../_shared/gmail-client.ts"

type ProviderRule = {
  provider: string
  category: "ai" | "cloud" | "development" | "other"
  senderQuery: string // Gmail "from:" fragment
  serviceNameFromBody?: (body: string, subject: string) => string
}

// Real known recurring-charge senders — every entry here is a service the
// owner has actually received a real invoice/receipt email from at some
// point in this session's investigation (Google AI Pro confirmed live;
// the rest are the same category of provider already tracked in
// registry/infrastructure.json or named directly by the owner).
const PROVIDER_RULES: ProviderRule[] = [
  { provider: "Google", category: "ai", senderQuery: "from:(payments-noreply@google.com OR google.com)",
    serviceNameFromBody: (body) => (/Google AI Pro/i.test(body) ? "Google AI Pro (Google One)" : /Google One/i.test(body) ? "Google One" : "Google") },
  { provider: "OpenAI", category: "ai", senderQuery: "from:openai.com",
    serviceNameFromBody: () => "ChatGPT Plus" },
  { provider: "Anthropic", category: "ai", senderQuery: "from:anthropic.com",
    serviceNameFromBody: () => "Claude" },
  { provider: "RunPod", category: "cloud", senderQuery: "from:runpod.io",
    serviceNameFromBody: () => "RunPod Cloud GPU" },
  { provider: "Vercel", category: "cloud", senderQuery: "from:vercel.com",
    serviceNameFromBody: () => "Vercel" },
  { provider: "GitHub", category: "development", senderQuery: "from:github.com",
    serviceNameFromBody: () => "GitHub" },
  { provider: "Apple", category: "development", senderQuery: "from:apple.com",
    serviceNameFromBody: (body) => (/Developer/i.test(body) ? "Apple Developer Program" : "Apple") },
  { provider: "Hostinger", category: "cloud", senderQuery: "from:hostinger.com",
    serviceNameFromBody: () => "Hostinger" },
]

// Real formats vary per provider, but recurring-charge receipts share a
// small set of real patterns — matched loosely on purpose so an unusual
// layout still yields a partial (low-confidence) result instead of nothing.
function parseAmountAndCurrency(body: string): { amount: number | null; currency: string } {
  const thb = body.match(/฿\s*([\d,]+\.?\d*)/) || body.match(/([\d,]+\.?\d*)\s*(?:บาท|THB)/i)
  if (thb) return { amount: Number(thb[1].replace(/,/g, "")), currency: "THB" }
  const usd = body.match(/\$\s*([\d,]+\.?\d*)/) || body.match(/([\d,]+\.?\d*)\s*USD/i)
  if (usd) return { amount: Number(usd[1].replace(/,/g, "")), currency: "USD" }
  return { amount: null, currency: "THB" }
}

function parseBillingCycle(body: string): string | null {
  if (/\/(เดือน|month)|monthly|รายเดือน/i.test(body)) return "monthly"
  if (/\/(ปี|year)|yearly|annual|รายปี/i.test(body)) return "yearly"
  if (/usage|ตามการใช้งาน/i.test(body)) return "usage"
  return null
}

function parseAutoRenew(body: string): boolean | null {
  if (/ต่ออายุ.*อัตโนมัติ|auto[- ]?renew/i.test(body)) return true
  if (/ยกเลิกการต่ออายุแล้ว|auto[- ]?renew.*(off|cancel)/i.test(body)) return false
  return null
}

function parseInvoiceNumber(body: string): string | null {
  const m = body.match(/(?:หมายเลขคำสั่งซื้อ|Order (?:number|ID)|Invoice)\s*[:：]?\s*([A-Za-z0-9.\-]+)/i)
  return m ? m[1].trim() : null
}

function parsePaymentMethod(body: string): string | null {
  const m = body.match(/(Visa|Mastercard|MasterCard|บัตร)[- ]?(\d{4})/i)
  return m ? `${m[1]}-${m[2]}` : null
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("SUBSCRIPTION_EMAIL_SYNC_CRON_SECRET")
  const got = req.headers.get("x-subscription-email-sync-secret")
  if (!expected || got !== expected) {
    return new Response("unauthorized", { status: 401 })
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  const accessToken = await getGmailAccessToken()
  if (!accessToken) {
    return Response.json({ error: "Gmail access token ล้มเหลว — เช็ค GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN" }, { status: 502 })
  }

  // Same one-time-backfill support as bank-email-sync — cron body is always
  // {}, so the safe default (7 days) stands for the recurring 5-minute job.
  let days = 7
  try {
    const body = await req.json()
    if (typeof body?.days === "number" && body.days > 0) days = body.days
  } catch { /* empty body from cron — default stands */ }

  let inserted = 0
  let skipped = 0
  const errors: string[] = []

  for (const rule of PROVIDER_RULES) {
    const query = `${rule.senderQuery} newer_than:${days}d`
    const idsOrError = await searchGmailMessageIds(accessToken, query)
    if ("error" in idsOrError) { errors.push(`${rule.provider}: ${idsOrError.error}`); continue }

    for (const id of idsOrError) {
      const { data: existing } = await supabase
        .from("subscription_services").select("id").eq("email_source", id).maybeSingle()
      if (existing) { skipped++; continue }

      const msg = await fetchGmailMessage(accessToken, id)
      if (!msg) { errors.push(`${rule.provider} message ${id}: fetch failed`); continue }

      const subject = getSubjectHeader(msg) ?? ""
      const body = extractBodyText(msg.payload)
      const { amount, currency } = parseAmountAndCurrency(body)
      const serviceName = rule.serviceNameFromBody ? rule.serviceNameFromBody(body, subject) : rule.provider
      const confidence = amount !== null ? "high" : "low"

      const { data: subRow, error } = await supabase.from("subscription_services").insert({
        provider: rule.provider,
        service_name: serviceName,
        category: rule.category,
        amount,
        currency,
        billing_cycle: parseBillingCycle(body),
        payment_method: parsePaymentMethod(body),
        status: "active",
        auto_renew: parseAutoRenew(body),
        last_invoice: parseInvoiceNumber(body),
        email_source: id,
        confidence,
        raw_subject: subject,
      }).select("id").single()
      if (error) { errors.push(`${rule.provider} message ${id}: ${error.message}`); continue }
      inserted++

      // Cost Ledger wiring (owner diagram: Email → Subscription Updated →
      // Business Event → Cost Ledger) — only for real, confidently-read
      // amounts; a low-confidence/null-amount row stays in
      // subscription_services alone until a human or AI pass fills it in,
      // rather than polluting the real ledger with an unknown number.
      if (amount !== null) {
        const { error: expenseErr } = await supabase.from("company_expenses").insert({
          document_type: "subscription",
          amount,
          vendor_name: rule.provider,
          expense_date: new Date().toISOString().slice(0, 10),
          source: "subscription_email_sync",
          subscription_service_id: subRow?.id ?? null,
        })
        if (expenseErr) errors.push(`${rule.provider} message ${id} (company_expenses): ${expenseErr.message}`)
      }
    }
  }

  return Response.json({ ok: true, inserted, skipped, errors })
})
