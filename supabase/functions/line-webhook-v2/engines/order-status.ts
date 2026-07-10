// Answers "สถานะงาน" — real status pulled from customer_orders, not guessed.
// Duplicated (not imported) from engines/transactions/workflows.ts's sale
// step labels on purpose — that file runs in Next.js/Node, this runs in Deno.

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "เปิดงาน",
  SUBMITTED: "ส่งคำขอแล้ว",
  PRICING: "กำลังตั้งราคา",
  QUOTED: "เสนอราคาแล้ว",
  CONFIRMED: "ยืนยันแล้ว",
  PROCUREMENT: "กำลังจัดหาสินค้า",
  DISPATCHING: "กำลังจัดส่ง",
  PARTIALLY_DELIVERED: "ส่งของบางส่วนแล้ว",
  DELIVERED: "ส่งของแล้ว",
  INVOICED: "ออกบิลแล้ว",
  PAID: "รับเงินแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
}

export async function tryOrderStatus(supabase: any, userId: string): Promise<string> {
  const { data: link } = await supabase
    .from("company_line_links").select("company_id").eq("line_user_id", userId).maybeSingle()
  if (!link?.company_id) return "ยังไม่พบข้อมูลบริษัทของท่านในระบบครับ รบกวนติดต่อแอดมินก่อนนะครับ"

  const { data: orders } = await supabase
    .from("customer_orders")
    .select("order_no, status, requested_delivery_at, updated_at")
    .eq("customer_company_id", link.company_id)
    .order("updated_at", { ascending: false })
    .limit(3)

  if (!orders || orders.length === 0) return "ยังไม่พบงานในระบบครับ"

  const lines = orders.map((o: any) => {
    const label = STATUS_LABEL[o.status] ?? o.status
    const eta = o.requested_delivery_at ? ` (กำหนดส่ง ${o.requested_delivery_at})` : ""
    return `${o.order_no ?? "-"}: ${label}${eta}`
  })

  return `สถานะงานล่าสุดครับ\n${lines.join("\n")}`
}
