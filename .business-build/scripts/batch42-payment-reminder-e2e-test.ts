/**
 * Batch 42 — payment acknowledgement + reminder loop E2E proof.
 *
 * Static (wiring locks):
 *   S1 lifecycle Test validates THE SAME credential Run uses
 *      (channel_access_token first — regression lock for c8349a9)
 *   S2 manual reminder send-debt = ledger amounts, preview/execute,
 *      delivery evidence + canonical business event
 *   S3 cron reminder = bridge token (fail-closed) + same-day idempotency
 * Live (read-only, production data):
 *   L1 LINE connector is connected + enabled (lifecycle Test passed)
 *   L2 first real payment receipt 0722ae13 is confirmed
 *   L3 acknowledgement delivery evidence exists, recipient = canonical identity
 *   L4 canonical audit receipt.acknowledged recorded
 *   L5 reminder loop pairing: every แจ้งชำระเงิน business event on the latest
 *      reminder day has a matching line_events out-flex delivery row (same amount)
 *   L6 money truth: ledger_outstanding === snapshot for reminded companies
 */
import { readFileSync } from "fs"
import { join } from "path"

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ""): void {
  checks += 1
  if (ok) { console.log(`PASS  ${name}`); return }
  failures += 1
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
}
function read(p: string): string { return readFileSync(p, "utf8") }

// ── S: static wiring ─────────────────────────────────────────────────────────
const tester = read("engines/connectors/tester.ts")
const testerFn = tester.slice(tester.indexOf("function resolveBearerCredential"))
check(
  "S1 Test resolves channel_access_token before legacy keys (Test/Run parity)",
  testerFn.indexOf("secret.channel_access_token") !== -1 &&
    testerFn.indexOf("secret.channel_access_token") < testerFn.indexOf("secret.api_key"),
)
const comm = read("registry/communication.ts")
check(
  "S2 Run gateway still reads channel_access_token first",
  comm.indexOf("secret.channel_access_token") !== -1 &&
    comm.indexOf("secret.channel_access_token") < comm.indexOf("secret.token"),
)

const sendDebt = read("app/api/admin/line-customers/[lineUserId]/send-debt/route.ts")
check("S3a send-debt amount = canonical ledger projection", sendDebt.includes('from("company_debt_current")') && sendDebt.includes("ledger_outstanding"))
check("S3b send-debt keeps preview/execute gate", sendDebt.includes('mode === "preview"') && sendDebt.includes('body?.mode === "execute"'))
check("S3c send-debt writes delivery evidence (exact flex)", sendDebt.includes('from("line_events")') && sendDebt.includes("extracted: { flex }"))
check("S3d send-debt marker via canonical event writer", sendDebt.includes("createBusinessEvent(") && sendDebt.includes('"แจ้งชำระเงิน"'))

const cron = read("supabase/functions/debt-reminder-cron/index.ts")
check("S4a cron gets token from bridge, fail-closed", cron.includes("getLineChannelAccessToken()") && cron.includes("ยังไม่พร้อม"))
check("S4b cron same-day idempotency marker", cron.includes("'แจ้งชำระเงิน'") && cron.includes("already sent today"))

// ── live ─────────────────────────────────────────────────────────────────────
const env: Record<string, string> = {}
for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const i = line.indexOf("=")
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
}
const SU = env.NEXT_PUBLIC_SUPABASE_URL
const SK = env.SUPABASE_SERVICE_ROLE_KEY

async function rest(path: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${SU}/rest/v1/${path}`, { headers: { apikey: SK, Authorization: `Bearer ${SK}` } })
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return (await res.json()) as Record<string, unknown>[]
}
const norm = (s: string): string => s.replace(/,/g, "").trim()
const amountOf = (title: string): string | null => {
  const m = title.match(/([\d,]+(?:\.\d{1,2})?)/)
  return m ? norm(m[1]) : null
}

async function live(): Promise<void> {
  try {
    // L1 connector lifecycle
    const conn = await rest("connectors?slug=eq.line&select=status,enabled")
    check("L1 LINE connector connected + enabled", conn[0]?.status === "connected" && conn[0]?.enabled === true,
      JSON.stringify(conn[0] ?? null))

    // L2 receipt confirmed (prefix lookup — id is the truth, no hardcoded uuid)
    const receipts = await rest("receipt_documents?select=id,status")
    const receipt = receipts.find(r => String(r.id).startsWith("0722ae13"))
    check("L2 first real receipt exists + confirmed", !!receipt && receipt.status === "confirmed",
      JSON.stringify(receipt ?? null))
    const receiptId = String(receipt?.id ?? "")

    const idents = await rest("connect_external_identities?select=provider,external_subject_id,company_id")
    const canonical = idents.filter(i => i.provider === "line").map(i => String(i.external_subject_id))

    // L3 ack delivery evidence + canonical recipient
    const outEvents = await rest("line_events?direction=eq.out&select=line_user_id,extracted,raw_text,created_at")
    const ackEv = outEvents.find(e => {
      const ex = (e.extracted ?? {}) as Record<string, unknown>
      return ex.receipt_document_id === receiptId
    })
    check("L3a ack delivery evidence row exists", !!ackEv)
    check("L3b ack recipient = canonical LINE identity", !!ackEv && canonical.includes(String(ackEv.line_user_id)),
      String(ackEv?.line_user_id ?? "none"))

    // L4 audit
    const audits = await rest("audit_logs?action=eq.receipt.acknowledged&select=entity_id,created_at")
    check("L4 canonical audit receipt.acknowledged recorded", audits.some(a => a.entity_id === receiptId))

    // L5 reminder pairing on latest reminder day
    // NOTE: encode in code — a hand-typed percent-encoding silently returns 0 rows
    const events = await rest(`business_events?event_type=eq.${encodeURIComponent("แจ้งชำระเงิน")}&select=event_date,title,status`)
    const dates = events.map(e => String(e.event_date)).sort()
    const latest = dates[dates.length - 1]
    const todays = events.filter(e => e.event_date === latest)
    check("L5a reminder events exist", todays.length > 0, `latest=${latest}`)
    let paired = 0
    for (const ev of todays) {
      const amt = amountOf(String(ev.title ?? ""))
      const hit = outEvents.some(oe =>
        String(oe.created_at ?? "").startsWith(latest) &&
        String(oe.raw_text ?? "").includes("แจ้งยอดค้างชำระ") &&
        amt !== null && norm(String(oe.raw_text ?? "")).includes(amt),
      )
      if (hit) paired += 1
    }
    check("L5b every reminder event has matching delivery evidence (same amount, same day)",
      todays.length > 0 && paired === todays.length, `paired=${paired}/${todays.length}`)

    // L6 money truth for companies reminded on that day: ledger === snapshot
    const debts = await rest("company_debt_current?select=company_id,ledger_outstanding,snapshot_total_outstanding")
    const links = await rest("company_line_links?select=company_id,line_user_id")
    const dayUsers = outEvents
      .filter(e => String(e.created_at ?? "").startsWith(latest) && String(e.raw_text ?? "").includes("แจ้งยอดค้างชำระ"))
      .map(e => String(e.line_user_id))
    const coIds = links.filter(l => dayUsers.includes(String(l.line_user_id))).map(l => l.company_id)
    const debtRows = debts.filter(d => coIds.includes(String(d.company_id)))
    const agree = debtRows.every(d => Math.abs(Number(d.ledger_outstanding) - Number(d.snapshot_total_outstanding)) < 0.01)
    check("L6 ledger === snapshot for every reminded company", coIds.length > 0 && agree,
      `companies=${coIds.length}`)
  } catch (e) {
    check("live phase ran", false, String(e).slice(0, 160))
  }
  console.log(`\nbatch42-e2e: checks=${checks} passed=${checks - failures} failed=${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}

void live()

