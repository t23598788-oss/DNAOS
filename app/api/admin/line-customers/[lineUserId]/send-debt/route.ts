import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { debtReminderFlex } from "@/engines/documents/flex-template"

type Params = { params: Promise<{ lineUserId: string }> }

// Owner request 2026-07-11: the debt figure shown in this page's header was
// only ever passive display — เฮีย wants a one-click "send" from the same
// screen. Re-reads debt_snapshots fresh from the DB server-side rather than
// trusting whatever the client had cached, since this is a real financial
// figure going out to a customer.

export async function POST(_req: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params
  const db = supabase()

  const { data: link } = await db
    .from("company_line_links").select("companies(id, name)").eq("line_user_id", lineUserId).maybeSingle()
  const company = (link as any)?.companies ?? null
  if (!company) return NextResponse.json({ error: "ยังไม่จับคู่บริษัทลูกค้า" }, { status: 400 })

  const { data: debt } = await db
    .from("debt_snapshots")
    .select("total_outstanding, days_overdue")
    .eq("customer_company_id", company.id)
    .maybeSingle()

  if (!debt || !debt.total_outstanding || Number(debt.total_outstanding) <= 0) {
    return NextResponse.json({ error: "ไม่มียอดหนี้ค้างชำระให้ส่ง" }, { status: 400 })
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return NextResponse.json({ error: "LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า" }, { status: 503 })

  const flex = debtReminderFlex({
    companyName: company.name,
    totalOutstanding: Number(debt.total_outstanding),
    daysOverdue: debt.days_overdue ?? 0,
  })

  const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: lineUserId, messages: [{ type: "flex", altText: "แจ้งยอดค้างชำระ", contents: flex }] }),
  })

  if (!lineRes.ok) {
    return NextResponse.json({ error: `ส่ง LINE ไม่สำเร็จ: ${(await lineRes.text()).slice(0, 200)}` }, { status: 502 })
  }

  await db.from("line_events").insert({
    line_user_id: lineUserId,
    raw_type: "flex",
    raw_text: `💰 แจ้งยอดค้างชำระ ${Number(debt.total_outstanding).toLocaleString("th-TH")} บาท ส่งให้ลูกค้าแล้ว`,
    status: "processed",
    direction: "out",
  })

  return NextResponse.json({ ok: true })
}
