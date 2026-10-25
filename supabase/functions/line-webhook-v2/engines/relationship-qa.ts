// Answers real relationship questions ("เราเคยเป็นหนี้กันไหม") with real data —
// looked up by PERSON (line_user_id → companies), never by raw event id.
// Owner instruction 2026-07-10: "ระบบมองบุคคล ระบบไม่ได้มองเลขที่... เหตุการณ์มันคือคน"
// (the system should see the person, not the id — an event belongs to a person).
// Never guesses: if we don't know who this is, say so plainly instead of
// answering as if we knew (DNA OS rule — ห้ามเดาแล้วนำเสนอเป็นความจริง).

import { calcDebtTrackingSummary, deriveFreezeWindows as deriveSharedFreezeWindows } from "../../../../engines/debt/tracking-calculator.ts"

const DEBT_KEYWORDS = ["หนี้", "ค้างชำระ", "ค้างจ่าย", "ค้างเงิน", "ติดเงิน", "ค้างเท่าไหร่", "ค้างเท่าไร"]

function calcCurrentDebt(
  principal: number,
  interestStartAt: string,
  freezeFrom: string | null = null,
  freezeUntil: string | null = null,
  freezeWindows: FreezeWindow[] = [],
): { totalDue: number; daysOverdue: number } {
  const summary = calcDebtTrackingSummary({
    principalAmount: principal,
    feeRate: 0,
    interestStartAt,
    freezeFrom,
    freezeUntil,
    freezeWindows,
  })
  return { totalDue: summary.totalAmount, daysOverdue: summary.daysOverdue }
}

// Deno-side adapter for engines/debt/tracking.ts#getCurrentDebt. All LINE
// answers that contain a financial amount use the shared pure formula; callers must not
// read debt_snapshots.total_outstanding as a customer-facing balance.
export async function getCanonicalDebtForCompany(supabase: any, companyId: string): Promise<{ totalDue: number; daysOverdue: number } | null> {
  const { data: debt } = await supabase
    .from("debt_snapshots")
    .select("total_outstanding, debt_start_at, created_at, freeze_from, freeze_until")
    .eq("customer_company_id", companyId).maybeSingle()
  if (!debt || !debt.total_outstanding || Number(debt.total_outstanding) <= 0) return null
  const { data: freezeEvents } = await supabase
    .from("debt_events").select("event_type, occurred_at")
    .eq("customer_company_id", companyId)
    .in("event_type", ["collection_paused", "collection_resumed"])
  return calcCurrentDebt(
    Number(debt.total_outstanding), debt.debt_start_at ?? debt.created_at,
    debt.freeze_from ?? null, debt.freeze_until ?? null, deriveSharedFreezeWindows(freezeEvents ?? []),
  )
}

export function isDebtInquiry(text: string): boolean {
  return DEBT_KEYWORDS.some((k) => text.includes(k))
}

// STEP 2 (owner directive 2026-10-25): company identity comes ONLY from a
// VERIFIED relationship (`connect_external_identities.trust_level = verified`).
// The old fallback matched `companies.name` against the LINE display name — a
// customer could set their display name to another company's name and receive
// that company's debt answer. Name equality is not identity; it is removed.
async function findMatchedCompany(supabase: any, userId: string): Promise<{ id: string; name: string } | null> {
  const { data: identities } = await supabase
    .from("connect_external_identities")
    .select("company_id")
    .eq("provider", "line")
    .eq("external_subject_id", userId)
    .eq("trust_level", "verified")
    .not("company_id", "is", null)
    .limit(2)

  // Missing OR ambiguous (two verified companies) ⇒ no match. Never guess.
  if (!Array.isArray(identities) || identities.length !== 1) return null
  const companyId = identities[0]?.company_id
  if (!companyId) return null

  const { data: company } = await supabase
    .from("companies").select("id, name").eq("id", companyId).maybeSingle()
  return company ?? null
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
    .from("debt_snapshots").select("collection_state").eq("customer_company_id", company.id).maybeSingle()
  const currentDebt = await getCanonicalDebtForCompany(supabase, company.id)
  if (!currentDebt) {
    return `เช็คในระบบแล้วครับ — ${company.name} ไม่มียอดหนี้ค้างชำระอยู่เลยครับ`
  }

  // Debt Single Source of Truth (owner, 2026-07-17, PRIORITY task) — was
  // quoting raw total_outstanding to a customer, the stale never-recomputed
  // principal (see engines/debt/tracking.ts's getCurrentDebt for the full
  // root cause — that's the Node-side canonical version of this exact
  // formula). Mirrored here, not imported, because this runs on Deno and
  // the Next.js app runs on Node — same deliberate cross-runtime-duplication
  // pattern already documented in this file's own directory (e.g.
  // supabase/functions/line-webhook-v2/engines/quote-price.ts).
  const { totalDue, daysOverdue } = currentDebt

  const amount = totalDue.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const proposedText = `เช็คในระบบแล้วครับ — ${company.name} มียอดหนี้ค้างชำระ ${amount} บาท ผิดนัดชำระ ${daysOverdue} วันครับ`

  await supabase.from("line_outbound_drafts").insert({
    line_user_id:  userId,
    company_id:    company.id,
    reason:        "debt_inquiry",
    proposed_text: proposedText,
    context:       { total_outstanding: totalDue, days_overdue: daysOverdue, collection_state: debt.collection_state },
  })

  // Owner correction (2026-07-26): a vague "เดี๋ยว...แป๊บนึง" with no real
  // bound is the same broken-promise pattern already fixed elsewhere today.
  // This one genuinely does wait on a human (Rule 72 — AI can't push
  // financial figures out on its own; a real staff member reviews the draft
  // in line_outbound_drafts above) — say that honestly instead of implying
  // an automatic instant follow-up.
  return "เช็คให้แล้วครับ ยอดหนี้กำลังรอเจ้าหน้าที่ยืนยันก่อนแจ้งกลับนะครับ"
}
