import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { debtReminderFlex } from "@/engines/documents/flex-template"
import { loadCompanySettings } from "@/core/config/company-settings"

type Params = { params: Promise<{ lineUserId: string }> }

// Owner request 2026-07-11: the debt figure shown in this page's header was
// only ever passive display — เฮีย wants a one-click "send" from the same
// screen. Re-reads debt_snapshots fresh from the DB server-side rather than
// trusting whatever the client had cached, since this is a real financial
// figure going out to a customer.

// Owner request 2026-07-11: "ให้เห็นภาพรายการก่อนที่จะกดส่งยืนยัน" — this route
// now takes an optional body { mode: "preview" | "execute" } (default
// "preview"). Preview builds and returns the real Flex card without pushing
// or writing anything; only "execute" actually sends and logs. The admin UI
// calls preview first, shows the card, then re-POSTs with mode:"execute".
export async function POST(req: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params
  const body = await req.json().catch(() => ({}))
  const mode = body?.mode === "execute" ? "execute" : "preview"
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

  const branding = await loadCompanySettings()
  const flex = debtReminderFlex({
    companyName: company.name,
    totalOutstanding: Number(debt.total_outstanding),
    daysOverdue: debt.days_overdue ?? 0,
    branding: {
      ourCompanyName: branding.companyName || undefined,
      ourCompanyTaxId: branding.companyTaxId || undefined,
      terms: branding.documentTerms || undefined,
      footerNote: branding.documentFooterNote || undefined,
    },
  })

  if (mode === "preview") {
    return NextResponse.json({ ok: true, flex_preview: flex })
  }

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

  // Owner-reported gap 2026-07-11: after this card goes out, a customer
  // reply like "รับทราบครับ" fell into the generic "เดี๋ยวเช็คให้นะครับ"
  // fallback, which makes no sense as a reply to an acknowledgment. This
  // row is what supabase/functions/line-webhook-v2/engines/debt-followup.ts
  // looks for to ask a real follow-up (the payment date) instead. A
  // dedicated status (not awaiting_info/ready_to_quote) keeps this out of
  // the quotation queue, which isn't relevant here.
  const { count } = await db
    .from("business_events").select("id", { count: "exact", head: true })
    .gte("created_at", new Date().toISOString().slice(0, 10))
  const yy = new Date().getFullYear().toString().slice(-2)
  const mm = String(new Date().getMonth() + 1).padStart(2, "0")
  const dd = String(new Date().getDate()).padStart(2, "0")
  const eventCode = `EV${yy}${mm}${dd}-${String((count ?? 0) + 1).padStart(4, "0")}`

  await db.from("business_events").insert({
    event_code: eventCode,
    event_type: "แจ้งชำระเงิน",
    event_date: new Date().toISOString().slice(0, 10),
    title: `แจ้งยอดค้างชำระ ${Number(debt.total_outstanding).toLocaleString("th-TH")} บาท`,
    source_line_user_id: lineUserId,
    partner_id: company.id,
    status: "awaiting_payment_date",
    confidence: 1,
    updated_at: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true })
}
