import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { resolveMaterial, type MaterialTypeRow } from "@/engines/material-resolver"
import { tryQuoteMaterialPrice } from "@/engines/quote-price"
import { runCognitivePipeline } from "@/cognitive/pipeline"

type Params = { params: Promise<{ lineUserId: string }> }

// Owner-reported gap 2026-07-11: "ถาม AI" in this page couldn't answer real
// material-price questions — it only talked to the generic cognitive
// pipeline (view customer/debt/create document intents), which has no idea
// about pit_materials at all. This route checks deterministically (not via
// AI judgment — ห้ามเดา) whether the question names a real material first;
// if so it answers with the real engine using this specific contact's last
// known GPS. Anything else falls through to the existing pipeline unchanged.

function extractQuantity(text: string): number {
  const match = text.match(/\d+(\.\d+)?/)
  return match ? Number(match[0]) : 1
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params
  const body = await req.json().catch(() => ({}))
  const question = typeof body?.question === "string" ? body.question.trim() : ""
  if (!question) return NextResponse.json({ error: "คำถามว่างเปล่า" }, { status: 400 })

  const db = supabase()

  const { data: materialTypes } = await db.from("material_types").select("id, name")
  const match = resolveMaterial(question, (materialTypes ?? []) as MaterialTypeRow[])

  if (match.matched || match.candidates.length > 0) {
    const { data: locationMsg } = await db
      .from("line_events")
      .select("extracted")
      .eq("line_user_id", lineUserId)
      .eq("raw_type", "location")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    const gps = locationMsg?.extracted?.latitude != null && locationMsg?.extracted?.longitude != null
      ? { lat: Number(locationMsg.extracted.latitude), lng: Number(locationMsg.extracted.longitude) }
      : null

    const quantity = extractQuantity(question)
    const { text } = await tryQuoteMaterialPrice(question, quantity, gps)
    return NextResponse.json({ sender: "ai", type: "text", text })
  }

  // Not a price question — fall through to the existing chat pipeline
  // (create documents, view debt/jobs, general Q&A) unchanged.
  //
  // Real gap, owner-reported 2026-07-30: asking "พี่หนุ่มมีหน้าที่อะไร เป็นใคร
  // ในระบบบริษัท DNA OS" (who is this contact / what's their role) got
  // answered with zero real identity — this route never looked up who the
  // contact actually IS before asking the AI about them; `line_profiles`
  // (role/trust_level), `company_line_links` (which company), and
  // `driver_equipment_permissions` (which vehicles they're responsible for)
  // all already exist as real per-contact data and were simply never read
  // here. Gathered as plain facts and handed to the AI as context — never
  // as something the AI reasons about or guesses beyond (ห้ามเดา).
  const [{ data: profile }, { data: link }, { data: equipmentLinks }] = await Promise.all([
    db.from("line_profiles").select("display_name, role, trust_level").eq("line_user_id", lineUserId).maybeSingle(),
    db.from("company_line_links").select("company_id, companies(name)").eq("line_user_id", lineUserId).maybeSingle(),
    db.from("driver_equipment_permissions").select("equipment_assets(name, asset_code)").eq("line_user_id", lineUserId).eq("is_active", true),
  ])
  const companyName = (link as any)?.companies?.name ?? null
  const equipmentNames = (equipmentLinks ?? []).map((r: any) => r.equipment_assets?.name).filter(Boolean)

  const contextLines: string[] = []
  if (profile?.display_name) contextLines.push(`ชื่อที่แสดงใน LINE: ${profile.display_name}`)
  if (profile?.role) contextLines.push(`บทบาทในระบบ: ${profile.role}${profile.trust_level ? ` (${profile.trust_level})` : ""}`)
  if (companyName) contextLines.push(`บริษัท/คู่ค้าที่ผูกไว้: ${companyName}`)
  if (equipmentNames.length > 0) contextLines.push(`รถ/เครื่องจักรที่รับผิดชอบ: ${equipmentNames.join(", ")}`)
  if (contextLines.length === 0) contextLines.push("ไม่มีข้อมูลบทบาท/บริษัท/เครื่องจักรที่ผูกไว้กับผู้ติดต่อนี้ในระบบ")

  // sessionKey = lineUserId (owner, 2026-07-31 fix): this route always
  // asks on behalf of one specific contact (it's in the URL), but never
  // told cognitive/memory/session.ts that — the singleton it used to be
  // could pick up whatever customer's session was last resolved anywhere
  // in the process. Distinct from the second arg (contactContext, the
  // free-text facts above), which stays as AI-prompt context, not an id.
  // knownCustomer (owner, 2026-08-01): "เรื่องการเงินเอกสารไม่ต้องให้ ai
  // เข้ามา" — company_line_links already gave us the real, code-resolved
  // company_id above; pass it through so identity.resolve is skipped
  // entirely for this contact's financial documents instead of relying on
  // AI name-matching against whatever the question text says.
  const companyId = (link as any)?.company_id ?? null
  const result = await runCognitivePipeline(
    question,
    contextLines.join("\n"),
    lineUserId,
    companyId ? { id: String(companyId), name: companyName ?? "" } : null,
  )
  return NextResponse.json(result)
}
