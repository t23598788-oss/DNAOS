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
// M023: one shared orchestration + one composer for automated reminders. The
// Edge function used to be a second, hand-copied debt send path; orchestration
// now lives in engines/debt/reminder-runner.ts and this function supplies the
// runtime pieces (db client, connector token, push, business-event transport).
import { planDebtReminder } from "../../../engines/debt/reminder-message.ts"
import { planReminderTick } from "../../../engines/debt/send-window.ts"
import { isDebtPreviewMode } from "../../../engines/debt/preview-mode.ts"
import { resolveHolidayCalendar } from "../../../engines/debt/holiday-calendar.ts"
import { compareSnapshotToLedger } from "../../../engines/debt/snapshot-parity.ts"
import {
  runDebtReminders,
  selectDebtRecipient,
  businessDateIn,
  type SendResult,
} from "../../../engines/debt/reminder-runner.ts"

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

  // SAFE PREVIEW MODE (M026) — staging must never push a real message, even by
  // accident. Checked before config, balances and any provider call.
  if (isDebtPreviewMode({ DEBT_REMINDER_PREVIEW_MODE: Deno.env.get('DEBT_REMINDER_PREVIEW_MODE') ?? undefined })) {
    return Response.json({
      skipped: 'SAFE PREVIEW MODE — no LINE message is sent',
      reason: 'PREVIEW_MODE_ACTIVE',
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: configRows, error: configErr } = await supabase
    .from('app_configs')
    .select('title, data')
    .in('title', [
      'debt-reminder-auto-enabled', 'debt-reminder-hour',
      'debt-reminder-contact-channel', 'debt-reminder-holiday-calendar',
      'company-name', 'company-tax-id', 'document-terms', 'document-footer-note',
    ])
  if (configErr) return Response.json({ error: configErr.message }, { status: 500 })

  const config = Object.fromEntries((configRows ?? []).map((r) => [r.title, r.data]))
  if (config['debt-reminder-auto-enabled'] !== 'true') {
    return Response.json({ skipped: 'auto-send disabled' })
  }

  const configuredHour = Number(config['debt-reminder-hour'] ?? '9')
  const now = new Date()

  // Holiday gate BEFORE the clock gate: the 18:00 close on public holidays is
  // only enforceable if the calendar is verified for the CURRENT year. A missing
  // or unverified calendar is a refusal, never an assumption — sending at 19:00
  // on a holiday would breach §8, and silently treating the day as a weekday is
  // exactly how that happens.
  const businessYear = Number(businessDateIn(now).slice(0, 4))
  const calendar = resolveHolidayCalendar({ raw: config['debt-reminder-holiday-calendar'], year: businessYear })
  if (calendar.status !== 'VERIFIED') {
    return Response.json(
      {
        skipped: `holiday calendar not verified for ${businessYear} (${calendar.status})`,
        reason: 'HOLIDAY_CALENDAR_UNVERIFIED',
        calendar: {
          year: calendar.year,
          status: calendar.status,
          problems: calendar.problems,
          source_url: calendar.sourceUrl,
        },
      },
      { status: 200 },
    )
  }

  // Thai Debt Collection Act B.E. 2558 §8 — no collection contact outside the
  // statutory window (Mon–Fri 08:00–20:00, public holidays 08:00–18:00), checked
  // BEFORE any balance is read, let alone sent. The same helper implements the
  // catch-up rule (a missed configured hour still runs later the same day).
  const tick = planReminderTick({ now, configuredHour, holidays: calendar.dates })
  const window = tick.window
  if (!tick.run) {
    return Response.json(
      {
        skipped:
          tick.reason === "OUTSIDE_ALLOWED_HOURS"
            ? `outside the allowed collection window (${window.hour}:${String(window.minute).padStart(2, '0')} ${window.dayKind})`
            : `before the configured hour (now ${window.hour}, configured ${configuredHour})`,
        reason: tick.reason,
        window,
      },
      { status: 200 },
    )
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

  // The single outbound writer for this function: both the invoice reminder
  // path and the legacy collection card go through this one push helper.
  const pushLine = async (to: string, messages: unknown[]): Promise<SendResult> => {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineToken}` },
      body: JSON.stringify({ to, messages }),
    })
    if (!res.ok) {
      return { ok: false, error: `LINE push failed: ${res.status} ${(await res.text()).slice(0, 200)}` }
    }
    const body = (await res.json().catch(() => ({}))) as {
      messageId?: unknown
      sentMessages?: Array<{ id?: unknown }>
    }
    const sentId = Array.isArray(body.sentMessages) ? body.sentMessages[0]?.id : undefined
    const messageId =
      typeof body.messageId === "string" && body.messageId
        ? body.messageId
        : typeof sentId === "string"
          ? sentId
          : null
    return { ok: true, messageId }
  }

  const todayStr = window.businessDate

  // Invoice receivables first (M023): these are the documents the ledger-only
  // path could never see. Company-level position is read from the canonical
  // projection; the runner re-reads each invoice before sending.
  const invoiceRun = await runDebtReminders(null, {
    db: supabase,
    send: pushLine,
    compose: planDebtReminder,
    creditorName: branding.ourCompanyName || 'DNA OS',
    contactChannel: config['debt-reminder-contact-channel'] || 'LINE OA ของบริษัท',
    windowDays: 7,
    now: new Date(),
  })
  const invoiceByCompany = new Map(invoiceRun.results.map((r) => [r.companyId, r]))

  const { data: links, error: linkErr } = await supabase
    .from('company_line_links')
    .select('line_user_id, companies(id, name)')
  if (linkErr) return Response.json({ error: linkErr.message }, { status: 500 })

  const results: Record<string, string> = {}

  for (const link of links ?? []) {
    const company = (link as any).companies
    const lineUserId = (link as any).line_user_id as string
    if (!company || !lineUserId) continue

    // Recipient authorization applies to the legacy collection card too. Before
    // this, that path pushed the debtor's balance to every linked contact —
    // including suppliers and unverified identities. Same gate as the invoice
    // path, resolved once per company so a multi-contact company is answered
    // with the same reason on every row.
    const authorized = await selectDebtRecipient(supabase, company.id)
    if (!authorized.ok) {
      results[company.name] = `skipped — ${authorized.reason}`
      continue
    }
    if (authorized.lineUserId !== lineUserId) continue

    // One organization gets one debt channel per run: if it has invoice
    // receivables, that (document-referenced, 3-state) message is the one
    // that goes out — never the card as well.
    const invoiceResult = invoiceByCompany.get(String(company.id))
    if (invoiceResult && invoiceResult.reason !== 'NO_INVOICE_DEBT') {
      results[company.name] =
        invoiceResult.outcome === 'SENT'
          ? `invoice reminder sent: ${invoiceResult.documentNo} (${invoiceResult.state})`
          : `${invoiceResult.outcome.toLowerCase()} — ${invoiceResult.reason}`

      if (invoiceResult.outcome === 'SENT') {
        const yy = new Date().getFullYear().toString().slice(-2)
        const mm = String(new Date().getMonth() + 1).padStart(2, '0')
        const dd = String(new Date().getDate()).padStart(2, '0')
        const { count } = await supabase
          .from('business_events').select('id', { count: 'exact', head: true })
          .gte('created_at', todayStr)
        const eventCode = `EV${yy}${mm}${dd}-${String((count ?? 0) + 1).padStart(4, '0')}`
        const wrote = await sendConnectEventCommand('business_event.create', {
          event_code: eventCode,
          event_type: 'แจ้งชำระเงิน',
          event_date: todayStr,
          title: `แจ้งเตือนชำระเงิน ${invoiceResult.documentNo} ${Number(invoiceResult.outstanding ?? 0).toLocaleString('th-TH')} บาท (${invoiceResult.state})`,
          status: 'awaiting_payment_date',
          confidence: 1,
          partner_id: company.id,
          source_provider: CONNECT_PROVIDER,
          source_external_subject_id: invoiceResult.lineUserId ?? lineUserId,
        }, `system:${CONNECT_PROVIDER}:debt-reminder-cron`)
        if (!wrote.ok) results[company.name] += ` / event write rejected: ${wrote.error}`
      }
      continue
    }

    const { data: debt } = await supabase
      .from('debt_snapshots')
      .select('total_outstanding, debt_start_at, created_at, freeze_from, freeze_until, document_type')
      .eq('customer_company_id', company.id)
      .maybeSingle()
    if (!debt || !debt.total_outstanding || Number(debt.total_outstanding) <= 0) continue

    // Snapshot freshness gate. `debt_snapshots` is a projection of the ledger and
    // does not see invoice payments, so it can be stale while looking valid. The
    // legacy card must never present a balance the canonical ledger cannot
    // confirm — suppress it and say why instead.
    const { data: ledgerRow } = await supabase
      .from('company_debt_current')
      .select('ledger_outstanding, ledger_event_count, snapshot_total_outstanding')
      .eq('company_id', company.id)
      .maybeSingle()
    const parity = compareSnapshotToLedger({
      snapshot: Number(debt.total_outstanding),
      ledger: ledgerRow ? Number(ledgerRow.ledger_outstanding ?? 0) : null,
      ledgerEventCount: ledgerRow ? Number(ledgerRow.ledger_event_count ?? 0) : null,
    })
    if (!parity.verified) {
      results[company.name] =
        `skipped — SNAPSHOT_UNVERIFIED: ${parity.reason} (${parity.status})`
      continue
    }

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

    // Queue the audit row BEFORE the push, exactly like the invoice path. The
    // partial unique index on extracted->>reminder_key then makes two
    // overlapping cron invocations impossible to double-send — the old order
    // (push, then record) had a window where both runs pushed.
    const flexKey = `${company.id}|legacy-flex|${todayStr}`
    const { data: flexQueued, error: flexQueueErr } = await supabase
      .from('line_events')
      .insert({
        line_user_id: lineUserId,
        raw_type: 'flex',
        raw_text: `💰 แจ้งยอดค้างชำระ ${totalDue.toLocaleString('th-TH')} บาท`,
        status: 'queued',
        direction: 'out',
        // Owner request 2026-07-24: admin control room must show the EXACT
        // card the customer received — the real Flex JSON, same as the manual
        // send-debt/route.ts path, not a paraphrased summary.
        extracted: {
          flex,
          reminder_key: flexKey,
          reminder_state: 'OVERDUE',
          template: 'legacy-collection-card/1',
          company_id: company.id,
          document_no: null,
          amount_read: totalDue,
          outstanding_read_at: new Date().toISOString(),
          recipient_role: authorized.role,
          recipient_trust: authorized.trust,
          channel: 'line',
          sent_semantics: 'PROVIDER_ACCEPTED',
        },
      })
      .select('id')
      .single()

    if (flexQueueErr || !flexQueued) {
      const duplicate =
        flexQueueErr?.code === '23505' || /duplicate key/i.test(flexQueueErr?.message ?? '')
      results[company.name] = duplicate
        ? 'already sent or queued today (concurrent run)'
        : `audit queue failed: ${flexQueueErr?.message ?? 'unknown'}`
      continue
    }

    const lineRes = await pushLine(
      lineUserId,
      [{ type: "flex", altText: "แจ้งยอดค้างชำระ", contents: flex }],
    )

    // Delivery evidence completeness (mission 2026-10-10 §4): the provider id
    // from the push response is carried on this out row, like every other out
    // writer (BATCH 38 shape). `sent` = provider accepted the request only.
    const providerMessageId = lineRes.messageId ?? null
    await supabase
      .from('line_events')
      .update({
        status: lineRes.ok ? 'sent' : 'failed',
        line_message_id: lineRes.ok ? providerMessageId : null,
        raw_text: lineRes.ok
          ? `💰 แจ้งยอดค้างชำระ ${totalDue.toLocaleString('th-TH')} บาท ส่งอัตโนมัติแล้ว`
          : `💰 แจ้งยอดค้างชำระ ${totalDue.toLocaleString('th-TH')} บาท (ส่งไม่สำเร็จ)`,
        admin_note: lineRes.ok
          ? 'provider accepted the request (PROVIDER_ACCEPTED); no delivery receipt exists'
          : (lineRes.error ?? 'unknown error').slice(0, 500),
      })
      .eq('id', flexQueued.id)

    if (!lineRes.ok) {
      results[company.name] = lineRes.error ?? 'LINE push failed'
      continue
    }

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

  return Response.json({
    hour: window.hour,
    window,
    catch_up: tick.catchUp,
    invoice_reminders: invoiceRun.summary,
    results,
  })
})
