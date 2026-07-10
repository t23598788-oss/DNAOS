// Answers real relationship questions ("เราเคยเป็นหนี้กันไหม") with real data —
// looked up by PERSON (line_user_id → companies), never by raw event id.
// Owner instruction 2026-07-10: "ระบบมองบุคคล ระบบไม่ได้มองเลขที่... เหตุการณ์มันคือคน"
// (the system should see the person, not the id — an event belongs to a person).
// Never guesses: if we don't know who this is, say so plainly instead of
// answering as if we knew (DNA OS rule — ห้ามเดาแล้วนำเสนอเป็นความจริง).

const DEBT_KEYWORDS = ["หนี้", "ค้างชำระ", "ค้างจ่าย", "ค้างเงิน", "ติดเงิน", "ค้างเท่าไหร่", "ค้างเท่าไร"]

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
    .select("total_outstanding, days_overdue, collection_state")
    .eq("customer_company_id", company.id)
    .maybeSingle()

  if (!debt || !debt.total_outstanding || Number(debt.total_outstanding) <= 0) {
    return `เช็คในระบบแล้วครับ — ${company.name} ไม่มียอดหนี้ค้างชำระอยู่เลยครับ`
  }

  const amount = Number(debt.total_outstanding).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const proposedText = `เช็คในระบบแล้วครับ — ${company.name} มียอดหนี้ค้างชำระ ${amount} บาท ผิดนัดชำระ ${debt.days_overdue} วันครับ`

  await supabase.from("line_outbound_drafts").insert({
    line_user_id:  userId,
    company_id:    company.id,
    reason:        "debt_inquiry",
    proposed_text: proposedText,
    context:       { total_outstanding: debt.total_outstanding, days_overdue: debt.days_overdue, collection_state: debt.collection_state },
  })

  return "เดี๋ยวขอเช็คยอดให้ละเอียดอีกครั้งแป๊บนึงนะครับ เดี๋ยวแจ้งกลับไปครับ"
}
