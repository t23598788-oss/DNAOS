import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

type Params = { params: Promise<{ id: string }> }

// This partner's real LINE conversation, pulled in via company_line_links —
// a company can have more than one LINE account (owner instruction
// 2026-07-10), so this aggregates across all of them, not just one.

export async function GET(_req: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const db = supabase()

  const { data: links } = await db.from("company_line_links").select("line_user_id").eq("company_id", id)
  const lineUserIds = (links ?? []).map((l) => l.line_user_id)

  if (lineUserIds.length === 0) {
    return NextResponse.json({ contacts: [], messages: [] })
  }

  const { data: events, error } = await db
    .from("line_events")
    .select("id, line_user_id, line_name, line_picture, raw_type, raw_text, created_at")
    .in("line_user_id", lineUserIds)
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const messages = (events ?? []).map((m) => ({
    ...m,
    raw_text: m.raw_text || (m.raw_type === "sticker" ? "(ส่งสติกเกอร์)" : m.raw_type === "image" ? "(ส่งรูปภาพ)" : m.raw_type === "follow" ? "(กดเพิ่มเพื่อน)" : m.raw_text),
  }))

  const contactsByUser = new Map<string, { line_user_id: string; line_name: string | null; line_picture: string | null }>()
  for (const m of messages) {
    if (!contactsByUser.has(m.line_user_id)) {
      contactsByUser.set(m.line_user_id, { line_user_id: m.line_user_id, line_name: m.line_name, line_picture: m.line_picture })
    } else if (!contactsByUser.get(m.line_user_id)!.line_name && m.line_name) {
      contactsByUser.get(m.line_user_id)!.line_name = m.line_name
      contactsByUser.get(m.line_user_id)!.line_picture = m.line_picture
    }
  }

  return NextResponse.json({ contacts: Array.from(contactsByUser.values()), messages })
}
