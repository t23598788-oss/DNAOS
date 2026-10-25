// Answers "เคยซื้อวัสดุอะไรบ้าง" — customer_orders has no material/quantity
// columns (it's not a financial line-items table), so purchase history comes
// from business_events instead, which carries material_text/quantity per
// real event (see engines/jobs/auto-create.ts, which sets transaction_id
// back onto the event once a job is actually created from it).

export async function tryPurchaseHistory(supabase: any, userId: string): Promise<string> {
  const { data: link } = await supabase
    .from("company_line_links").select("company_id").eq("line_user_id", userId).maybeSingle()
  if (!link?.company_id) return "ยังไม่พบข้อมูลบริษัทของท่านในระบบครับ รบกวนติดต่อแอดมินก่อนนะครับ"

  const { data: events } = await supabase
    .from("business_events")
    .select("material_text, quantity, quantity_unit, created_at")
    .eq("partner_id", link.company_id)
    .in("status", ["job_created", "quoted", "confirmed", "delivered"])
    .not("material_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(10)

  if (!events || events.length === 0) return "ยังไม่พบประวัติการสั่งซื้อครับ"

  const lines = events.map((e: any) => {
    const qty = e.quantity ? ` ${e.quantity} ${e.quantity_unit ?? ""}`.trim() : ""
    const date = e.created_at ? String(e.created_at).slice(0, 10) : ""
    return `${date} — ${e.material_text}${qty}`
  })

  return `ประวัติการสั่งซื้อล่าสุดครับ\n${lines.join("\n")}`
}
