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
import { getGmailAccessContext, extractBodyText, searchGmailMessageIds, fetchGmailMessage, getSubjectHeader } from "../_shared/gmail-client.ts"

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

  const gmail = await getGmailAccessContext()
  if (!gmail) {
    return Response.json({ error: "Gmail access token ล้มเหลว — เช็ค connector lifecycle ที่ /admin/connectors" }, { status: 502 })
  }
  const accessToken = gmail.accessToken
  const errors: string[] = []

  // Record which real mailbox/connector supplied the evidence. Do not infer
  // its human or organization owner from the shared OAuth login.
  let sourceAccountId: string | null = null
  if (gmail.mailboxEmail) {
    const systemDb = supabase.schema("system")
    const { data: existingMailbox, error: mailboxReadError } = await systemDb
      .from("responsibility_accounts")
      .select("id")
      .eq("provider_code", "google")
      .eq("account_kind", "mailbox")
      .eq("provider_account_ref", gmail.mailboxEmail)
      .maybeSingle()
    if (mailboxReadError) {
      errors.push(`Gmail mailbox provenance unavailable: ${mailboxReadError.message}`)
    } else if (existingMailbox) {
      sourceAccountId = existingMailbox.id
    } else {
      const { data: insertedMailbox, error: mailboxInsertError } = await systemDb
        .from("responsibility_accounts")
        .insert({
          provider_code: "google",
          account_kind: "mailbox",
          provider_account_ref: gmail.mailboxEmail,
          display_name: gmail.mailboxEmail,
          email_address: gmail.mailboxEmail,
          source_connector_id: gmail.connectorId,
          owner_kind: "unassigned",
          attribution_status: "unverified",
        })
        .select("id")
        .single()
      if (mailboxInsertError) {
        errors.push(`Gmail mailbox provenance insert failed: ${mailboxInsertError.message}`)
      } else {
        sourceAccountId = insertedMailbox.id
      }
    }
  }

  async function ensureSystemEvidence(legacyId: string, fields: Record<string, unknown>, messageId: string, confidence: string) {
    const systemDb = supabase.schema("system")
    let { data: canonical, error: canonicalReadError } = await systemDb
      .from("subscription_costs")
      .select("id, source_account_id")
      .eq("legacy_subscription_service_id", legacyId)
      .maybeSingle()
    if (canonicalReadError) return canonicalReadError.message
    if (!canonical) {
      const { data, error } = await systemDb.from("subscription_costs").insert({
        legacy_subscription_service_id: legacyId,
        provider_code: fields.provider,
        service_name: fields.service_name,
        cost_kind: "email_observation",
        amount: fields.amount,
        currency: fields.currency ?? "THB",
        billing_cycle: fields.billing_cycle,
        service_status: fields.status ?? "unknown",
        source_account_id: sourceAccountId,
        last_source_event_ref: messageId,
        last_evidence_at: new Date().toISOString(),
      }).select("id").single()
      if (error) return error.message
      canonical = data
    } else if (!canonical.source_account_id && sourceAccountId) {
      const { error } = await systemDb.from("subscription_costs")
        .update({ source_account_id: sourceAccountId, last_source_event_ref: messageId, last_evidence_at: new Date().toISOString() })
        .eq("id", canonical.id)
        .is("source_account_id", null)
      if (error) return error.message
    }

    const { data: existingEvidence, error: evidenceReadError } = await systemDb
      .from("subscription_evidence")
      .select("id")
      .eq("subscription_cost_id", canonical.id)
      .eq("source_kind", "gmail_message")
      .eq("source_reference", messageId)
      .maybeSingle()
    if (evidenceReadError) return evidenceReadError.message
    if (!existingEvidence) {
      const { error } = await systemDb.from("subscription_evidence").insert({
        subscription_cost_id: canonical.id,
        source_account_id: sourceAccountId,
        source_kind: "gmail_message",
        source_reference: messageId,
        source_connector_id: gmail.connectorId,
        parser_confidence: confidence,
        observed_at: new Date().toISOString(),
        sanitized_attributes: {
          provider: fields.provider,
          service_name: fields.service_name,
          amount: fields.amount,
          currency: fields.currency,
          billing_cycle: fields.billing_cycle,
          invoice_reference: fields.last_invoice,
        },
      })
      if (error) return error.message
    }
    return null
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

  for (const rule of PROVIDER_RULES) {
    const query = `${rule.senderQuery} newer_than:${days}d`
    const idsOrError = await searchGmailMessageIds(accessToken, query)
    if ("error" in idsOrError) { errors.push(`${rule.provider}: ${idsOrError.error}`); continue }

    for (const id of idsOrError) {
      const { data: existing } = await supabase
        .from("subscription_services").select("id, provider, service_name, amount, currency, billing_cycle, status, confidence, last_invoice").eq("email_source", id).maybeSingle()
      if (existing) {
        const provenanceError = await ensureSystemEvidence(existing.id, existing, id, existing.confidence ?? "low")
        if (provenanceError) errors.push(`${rule.provider} message ${id}: system provenance failed: ${provenanceError}`)
        skipped++
        continue
      }

      const msg = await fetchGmailMessage(accessToken, id)
      if (!msg) { errors.push(`${rule.provider} message ${id}: fetch failed`); continue }

      const subject = getSubjectHeader(msg) ?? ""
      const body = extractBodyText(msg.payload)
      const { amount, currency } = parseAmountAndCurrency(body)
      const serviceName = rule.serviceNameFromBody ? rule.serviceNameFromBody(body, subject) : rule.provider
      const confidence = amount !== null ? "high" : "low"

      const { data: insertedService, error } = await supabase.from("subscription_services").insert({
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

      const provenanceError = await ensureSystemEvidence(insertedService.id, {
        provider: rule.provider,
        service_name: serviceName,
        amount,
        currency,
        billing_cycle: parseBillingCycle(body),
        status: "active",
        last_invoice: parseInvoiceNumber(body),
      }, id, confidence)
      if (provenanceError) errors.push(`${rule.provider} message ${id}: system provenance failed: ${provenanceError}`)

      // Keep this as subscription observation only. A message in the shared
      // owner Gmail and a parsed payment method do not prove which person or
      // organization owes/pays the charge. company_expenses has no verified
      // company/organization owner field, so copying this row there would
      // misclassify a platform/user subscription as a business expense.
    }
  }

  return Response.json({ ok: true, inserted, skipped, errors })
})
