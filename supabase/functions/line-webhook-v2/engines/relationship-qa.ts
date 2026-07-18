// Answers real relationship questions ("เราเคยเป็นหนี้กันไหม") with real data —
// looked up by PERSON (line_user_id → companies), never by raw event id.
// Owner instruction 2026-07-10: "ระบบมองบุคคล ระบบไม่ได้มองเลขที่... เหตุการณ์มันคือคน"
// (the system should see the person, not the id — an event belongs to a person).
// Never guesses: if we don't know who this is, say so plainly instead of
// answering as if we knew (DNA OS rule — ห้ามเดาแล้วนำเสนอเป็นความจริง).

const DEBT_KEYWORDS = ["หนี้", "ค้างชำระ", "ค้างจ่าย", "ค้างเงิน", "ติดเงิน", "ค้างเท่าไหร่", "ค้างเท่าไร"]

// Mirrors engines/debt/tracking.ts's calcDebtTrackingSummary exactly (Node
// side, the canonical version) — 25%/yr simple interest, 100/day penalty
// after a 30-day grace period, feeRate always 0 (no fee_rate column exists
// in debt_snapshots yet). Any change to the real formula must be applied to
// BOTH copies — see that file's own comment for why they can't share code
// (Deno vs Node runtimes).
const INTEREST_RATE = 0.25
const PENALTY_PER_DAY = 100
const GRACE_DAYS = 30

// Debt Collection Freeze Window (owner, 2026-07-18) — mirrors the Node-side
// frozenOverlapDays() in engines/debt/tracking.ts (canonical version).
function frozenOverlapDays(rangeStart: Date, rangeEnd: Date, freezeFrom: Date | null, freezeUntil: Date | null): number {
  if (!freezeFrom) return 0
  const freezeEnd = freezeUntil ?? rangeEnd
  const overlapStart = freezeFrom > rangeStart ? freezeFrom : rangeStart
  const overlapEnd = freezeEnd < rangeEnd ? freezeEnd : rangeEnd
  const days = Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / 86_400_000)
  return Math.max(0, days)
}

// Phase B (owner, 2026-07-18) — mirrors engines/debt/tracking.ts's
// deriveFreezeWindows/FreezeWindow (Node canonical version), same as
// supabase/functions/debt-reminder-cron/index.ts's identical copy.
interface FreezeWindow { from: string; until: string | null }
function deriveFreezeWindows(events: { event_type: string; occurred_at: string }[]): FreezeWindow[] {
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
  const windows: FreezeWindow[] = []
  let openFrom: string | null = null
  for (const e of sorted) {
    if (e.event_type === "collection_paused" && !openFrom) openFrom = e.occurred_at
    else if (e.event_type === "collection_resumed" && openFrom) {
      windows.push({ from: openFrom, until: e.occurred_at })
      openFrom = null
    }
  }
  if (openFrom) windows.push({ from: openFrom, until: null })
  return windows
}

function totalFrozenDays(rangeStart: Date, rangeEnd: Date, windows: FreezeWindow[]): number {
  return windows.reduce(
    (sum, w) => sum + frozenOverlapDays(rangeStart, rangeEnd, new Date(w.from), w.until ? new Date(w.until) : null),
    0,
  )
}

function calcCurrentDebt(
  principal: number,
  interestStartAt: string,
  freezeFrom: string | null = null,
  freezeUntil: string | null = null,
  freezeWindows: FreezeWindow[] = [],
): { totalDue: number; daysOverdue: number } {
  const start = new Date(interestStartAt)
  const now = new Date()

  const windows: FreezeWindow[] = freezeWindows.length
    ? freezeWindows
    : freezeFrom ? [{ from: freezeFrom, until: freezeUntil }] : []

  const daysElapsedRaw = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000))
  const daysElapsed = Math.max(0, daysElapsedRaw - totalFrozenDays(start, now, windows))
  const interest = Math.round(principal * INTEREST_RATE * daysElapsed / 365 * 100) / 100

  const defaultDate = new Date(start)
  defaultDate.setDate(defaultDate.getDate() + GRACE_DAYS)
  const daysOverdueRaw = Math.max(0, Math.floor((now.getTime() - defaultDate.getTime()) / 86_400_000))
  const daysOverdue = Math.max(0, daysOverdueRaw - totalFrozenDays(defaultDate, now, windows))
  const penalty = daysOverdue * PENALTY_PER_DAY

  return { totalDue: Math.round((principal + interest + penalty) * 100) / 100, daysOverdue }
}

export function isDebtInquiry(text: string): boolean {
  return DEBT_KEYWORDS.some((k) => text.includes(k))
}

async function findMatchedCompany(supabase: any, userId: string): Promise<{ id: string; name: string } | null> {
  // Direct link first — a real person can have more than one LINE account
  // (e.g. ช่างมิก added a second LINE account 2026-07-10, same company เคที),
  // so this looks up via company_line_links, not a single companies column.
  const { data: link } = await supabase
    .from("company_line_links").select("companies(id, name)").eq("line_user_id", userId).maybeSingle()
  const linked = (link as any)?.companies ?? null
  if (linked) return linked

  // Fall back to exact name match against whatever LINE display name we've
  // captured for this contact.
  const { data: known } = await supabase
    .from("line_events").select("line_name").eq("line_user_id", userId)
    .not("line_name", "is", null).limit(1).maybeSingle()
  if (!known?.line_name) return null

  const { data: byName } = await supabase
    .from("companies").select("id, name").eq("name", known.line_name).maybeSingle()
  return byName ?? null
}

// Zero/no debt is safe to say immediately — it's a negative claim, nothing to
// get wrong. A real outstanding AMOUNT is a different risk class (owner
// instruction 2026-07-10: "ยอดการเงินต้องละเอียดอ่อน...ต้องผ่านการตรวจสอบเฮีย
// ก่อน" — data isn't fully settled yet, so a real number goes to a human
// review queue instead of straight to the customer; Rule 72).
export async function answerDebtInquiry(supabase: any, userId: string): Promise<string> {
  const company = await findMatchedCompany(supabase, userId)
  if (!company) {
    return "ระบบยังไม่พบข้อมูลบริษัทของท่านในระบบครับ รบกวนแจ้งชื่อบริษัทหรือชื่อที่ใช้ติดต่อกันได้ไหมครับ จะได้เช็คให้ถูกต้อง"
  }

  const { data: debt } = await supabase
    .from("debt_snapshots")
    .select("total_outstanding, debt_start_at, created_at, collection_state, freeze_from, freeze_until")
    .eq("customer_company_id", company.id)
    .maybeSingle()

  if (!debt || !debt.total_outstanding || Number(debt.total_outstanding) <= 0) {
    return `เช็คในระบบแล้วครับ — ${company.name} ไม่มียอดหนี้ค้างชำระอยู่เลยครับ`
  }

  const { data: freezeEvents } = await supabase
    .from("debt_events")
    .select("event_type, occurred_at")
    .eq("customer_company_id", company.id)
    .in("event_type", ["collection_paused", "collection_resumed"])
  const freezeWindows = deriveFreezeWindows(freezeEvents ?? [])

  // Debt Single Source of Truth (owner, 2026-07-17, PRIORITY task) — was
  // quoting raw total_outstanding to a customer, the stale never-recomputed
  // principal (see engines/debt/tracking.ts's getCurrentDebt for the full
  // root cause — that's the Node-side canonical version of this exact
  // formula). Mirrored here, not imported, because this runs on Deno and
  // the Next.js app runs on Node — same deliberate cross-runtime-duplication
  // pattern already documented in this file's own directory (e.g.
  // supabase/functions/line-webhook-v2/engines/quote-price.ts).
  const { totalDue, daysOverdue } = calcCurrentDebt(
    Number(debt.total_outstanding), debt.debt_start_at ?? debt.created_at,
    debt.freeze_from ?? null, debt.freeze_until ?? null, freezeWindows,
  )

  const amount = totalDue.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const proposedText = `เช็คในระบบแล้วครับ — ${company.name} มียอดหนี้ค้างชำระ ${amount} บาท ผิดนัดชำระ ${daysOverdue} วันครับ`

  await supabase.from("line_outbound_drafts").insert({
    line_user_id:  userId,
    company_id:    company.id,
    reason:        "debt_inquiry",
    proposed_text: proposedText,
    context:       { total_outstanding: totalDue, days_overdue: daysOverdue, collection_state: debt.collection_state },
  })

  return "เดี๋ยวขอเช็คยอดให้ละเอียดอีกครั้งแป๊บนึงนะครับ เดี๋ยวแจ้งกลับไปครับ"
}
