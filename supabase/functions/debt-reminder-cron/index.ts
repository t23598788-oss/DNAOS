// Runs every 10 minutes (see migration 20260711000003) to send the debt
// reminder Flex card automatically, once a day, at the hour the owner
// configured in /admin (SettingsDrawer → debt-reminder-auto-enabled /
// debt-reminder-hour, stored in app_configs). Owner request 2026-07-11:
// "ให้มันมีการตั้งค่าของทวงถามเป็นออโต้... ให้ผู้ใช้สามารถตั้งค่าได้วันละหนึ่งรอบ
// ช่วงเวลากี่โมง".
//
// Deliberately duplicates the send logic from
// app/api/admin/line-customers/[lineUserId]/send-debt/route.ts and
// engines/documents/flex-template.ts's debtReminderFlex — this function runs
// on Deno (Supabase Edge Functions), the Next.js code runs on Node, so
// business logic is copied rather than imported across runtimes (same
// pattern as line-webhook-v2/engines/quote-price.ts).
//
// Guarded against double-sends within the same hour (cron fires every 10
// min): for each company, skip if a business_events row for that company
// already exists today — this also naturally skips a company an admin
// already sent to manually earlier the same day.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { getLineChannelAccessToken } from "../_shared/line-client.ts"
import { sendConnectEventCommand, CONNECT_PROVIDER } from "../_shared/connect-event.ts"
import { calcDebtTrackingSummary, deriveFreezeWindows } from "../../../engines/debt/tracking-calculator.ts"

function debtReminderFlex(opts: {
  companyName: string
  totalOutstanding: number
  daysOverdue: number
  principal?: number
  interest?: number
  penalty?: number
  branding: { ourCompanyName?: string; ourCompanyTaxId?: string; terms?: string; footerNote?: string }
}): object {
  const severe = opts.daysOverdue > 30
  const color = severe ? "#C62828" : "#EF6C00"
  const itemLine = (label: string, amount: number | undefined) =>
    (amount == null || amount <= 0) ? null : {
      type: "box", layout: "horizontal", margin: "xs",
      contents: [
        { type: "text", text: label, size: "xs", color: "#666666", flex: 3 },
        { type: "text", text: amount.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿", size: "xs", color: "#333333", align: "end", flex: 2 },
      ],
    }
  const itemLines = [itemLine("เงินต้น", opts.principal), itemLine("ดอกเบี้ย", opts.interest), itemLine("ค่าปรับ", opts.penalty)]
    .filter((l): l is NonNullable<typeof l> => l !== null)
  const footerLines: object[] = []
  if (opts.branding.ourCompanyName) {
    footerLines.push({ type: "separator", margin: "md" })
    footerLines.push({
      type: "text",
      text: opts.branding.ourCompanyTaxId ? `${opts.branding.ourCompanyName} • เลขผู้เสียภาษี ${opts.branding.ourCompanyTaxId}` : opts.branding.ourCompanyName,
      size: "xxs", color: "#999999", wrap: true, margin: "md",
    })
  }
  if (opts.branding.terms) footerLines.push({ type: "text", text: opts.branding.terms, size: "xxs", color: "#999999", wrap: true, margin: "sm" })
  if (opts.branding.footerNote) footerLines.push({ type: "text", text: opts.branding.footerNote, size: "xxs", color: "#999999", wrap: true, margin: "sm" })

  return {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box", layout: "vertical", backgroundColor: color, paddingAll: "16px",
      contents: [{ type: "text", text: "แจ้งยอดค้างชำระ", color: "#FFFFFF", weight: "bold", size: "md" }],
    },
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "text", text: opts.companyName, weight: "bold", size: "sm", wrap: true },
        { type: "separator", margin: "sm" },
        ...itemLines,
        ...(itemLines.length > 0 ? [{ type: "separator", margin: "sm" }] : []),
        {
          type: "box", layout: "horizontal", margin: "sm",
          contents: [
            { type: "text", text: "ยอดสุทธิ", weight: "bold", flex: 3 },
            { type: "text", text: opts.totalOutstanding.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿", weight: "bold", color, align: "end", flex: 2 },
          ],
        },
        { type: "text", text: `ผิดนัดชำระ ${opts.daysOverdue} วัน`, size: "xs", color: "#888888" },
        ...footerLines,
      ],
    },
  }
}

Deno.serve(async (req) => {
  const expected = Deno.env.get('DEBT_REMINDER_CRON_SECRET')
  const got = req.headers.get('x-reconcile-secret')
  if (!expected || got !== expected) {
    return new Response('unauthorized', { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: configRows, error: configErr } = await supabase
    .from('app_configs')
    .select('title, data')
    .in('title', [
      'debt-reminder-auto-enabled', 'debt-reminder-hour',
      'company-name', 'company-tax-id', 'document-terms', 'document-footer-note',
    ])
  if (configErr) return Response.json({ error: configErr.message }, { status: 500 })

  const config = Object.fromEntries((configRows ?? []).map((r) => [r.title, r.data]))
  if (config['debt-reminder-auto-enabled'] !== 'true') {
    return Response.json({ skipped: 'auto-send disabled' })
  }

  const configuredHour = Number(config['debt-reminder-hour'] ?? '9')
  // Bangkok is UTC+7, no DST — safe fixed offset.
  const bangkokHour = (new Date().getUTCHours() + 7) % 24
  if (bangkokHour !== configuredHour) {
    return Response.json({ skipped: `not the configured hour (now ${bangkokHour}, configured ${configuredHour})` })
  }

  // Canonical credential path (LINE cutover): bridge → Run gate — fail-closed.
  const lineToken = await getLineChannelAccessToken()
  if (!lineToken) return Response.json({ error: 'LINE connector ยังไม่พร้อม — bridge คืน token ไม่ได้ (เช็ค lifecycle ที่ /admin/connectors)' }, { status: 500 })

  const branding = {
    ourCompanyName: config['company-name'] || undefined,
    ourCompanyTaxId: config['company-tax-id'] || undefined,
    terms: config['document-terms'] || undefined,
    footerNote: config['document-footer-note'] || undefined,
  }

  const todayStr = new Date().toISOString().slice(0, 10)

  const { data: links, error: linkErr } = await supabase
    .from('company_line_links')
    .select('line_user_id, companies(id, name)')
  if (linkErr) return Response.json({ error: linkErr.message }, { status: 500 })

  const results: Record<string, string> = {}

  for (const link of links ?? []) {
    const company = (link as any).companies
    const lineUserId = (link as any).line_user_id as string
    if (!company || !lineUserId) continue

    const { data: debt } = await supabase
      .from('debt_snapshots')
      .select('total_outstanding, debt_start_at, created_at, freeze_from, freeze_until, document_type')
      .eq('customer_company_id', company.id)
      .maybeSingle()
    if (!debt || !debt.total_outstanding || Number(debt.total_outstanding) <= 0) continue

    // Debt Tracking Model — Phase B (owner, 2026-07-18): only debt rows
    // classified as collection_reminder may be sent through THIS card. A
    // trade_receivable belongs to the Invoice module instead (this cron never
    // issues invoices); null means not yet classified (pre-migration data) —
    // skip rather than guess, per the ban on presenting an unverified state
    // as fact.
    if (debt.document_type && debt.document_type !== 'collection_reminder_notice') {
      results[company.name] = `skipped — document_type is ${debt.document_type}, not collection_reminder_notice`
      continue
    }

    const { data: freezeEvents } = await supabase
      .from('debt_events')
      .select('event_type, occurred_at')
      .eq('customer_company_id', company.id)
      .in('event_type', ['collection_paused', 'collection_resumed'])
    const freezeWindows = deriveFreezeWindows(freezeEvents ?? [])

    // Debt Single Source of Truth (owner, 2026-07-17, PRIORITY task) — was
    // sending the raw total_outstanding (stale principal, never recomputed).
    // Same mirrored formula as engines/line-webhook-v2/engines/relationship-qa.ts
    // and the Node-side canonical engines/debt/tracking.ts#getCurrentDebt.
    // NOTE: this cron still only sends a reminder card, not a generated
    // invoice/debt-notice document — that remains an explicit open decision
    // (auto-send of a real financial document without human confirmation
    // conflicts with Rule 72) pending the owner's answer, not built here.
    const summary = calcDebtTrackingSummary({
      principalAmount: Number(debt.total_outstanding),
      feeRate: 0,
      interestStartAt: debt.debt_start_at ?? debt.created_at,
      freezeFrom: debt.freeze_from ?? null,
      freezeUntil: debt.freeze_until ?? null,
      freezeWindows,
    })
    const principal = summary.principalAmount
    const interest = summary.interestAmount
    const penalty = summary.penaltyAmount
    const totalDue = summary.totalAmount
    const daysOverdue = summary.daysOverdue

    const { count: sentToday } = await supabase
      .from('business_events')
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', company.id)
      .eq('event_type', 'แจ้งชำระเงิน')
      .eq('event_date', todayStr)
    if ((sentToday ?? 0) > 0) {
      results[company.name] = 'already sent today'
      continue
    }

    const flex = debtReminderFlex({
      companyName: company.name,
      totalOutstanding: totalDue,
      daysOverdue,
      principal,
      interest,
      penalty,
      branding,
    })

    const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineToken}` },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: "flex", altText: "แจ้งยอดค้างชำระ", contents: flex }] }),
    })

    if (!lineRes.ok) {
      results[company.name] = `LINE push failed: ${(await lineRes.text()).slice(0, 200)}`
      continue
    }

    await supabase.from('line_events').insert({
      line_user_id: lineUserId,
      raw_type: 'flex',
      raw_text: `💰 แจ้งยอดค้างชำระ ${totalDue.toLocaleString('th-TH')} บาท ส่งอัตโนมัติแล้ว`,
      status: 'processed',
      direction: 'out',
      // Owner request 2026-07-24: admin control room must show the EXACT
      // card the customer received — the real Flex JSON, same as the manual
      // send-debt/route.ts path, not a paraphrased summary.
      extracted: { flex },
    })

    const { count } = await supabase
      .from('business_events').select('id', { count: 'exact', head: true })
      .gte('created_at', todayStr)
    const yy = new Date().getFullYear().toString().slice(-2)
    const mm = String(new Date().getMonth() + 1).padStart(2, '0')
    const dd = String(new Date().getDate()).padStart(2, '0')
    const eventCode = `EV${yy}${mm}${dd}-${String((count ?? 0) + 1).padStart(4, '0')}`

    // BLOCK-1 cutover (2026-09-23): this used to be a direct single-quoted
    // `supabase.from('business_events').insert(...)` — invisible to the old
    // double-quote-only census, so the canonical authority claim was wrong.
    // It now goes through the Connect transport → canonical event writer, the
    // only path allowed to mutate business_events. Same business fields, same
    // status; timestamps are the writer's business (no `updated_at` here).
    // Fail-closed: a transport failure marks this company and moves on — there
    // is deliberately NO local fallback write.
    const wrote = await sendConnectEventCommand('business_event.create', {
      event_code: eventCode,
      event_type: 'แจ้งชำระเงิน',
      event_date: todayStr,
      title: `แจ้งยอดค้างชำระ ${totalDue.toLocaleString('th-TH')} บาท (อัตโนมัติ)`,
      status: 'awaiting_payment_date',
      confidence: 1,
      partner_id: company.id,
      source_provider: CONNECT_PROVIDER,
      source_external_subject_id: lineUserId,
    }, `system:${CONNECT_PROVIDER}:debt-reminder-cron`)
    if (!wrote.ok) {
      results[company.name] = `event write rejected: ${wrote.error}`
      continue
    }

    results[company.name] = 'sent'
  }

  return Response.json({ hour: bangkokHour, results })
})
