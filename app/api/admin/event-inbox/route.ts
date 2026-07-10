import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// The center of the system per owner's direction 2026-07-10: not "LINE
// messages" but "events flowing in from the outside world" — a flat,
// chronological feed of every business_events row across every contact,
// counted by event (job), not by raw message count.

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()

  const { data: events, error } = await db
    .from("business_events")
    .select(`
      id, event_code, event_type, title, description, status, confidence,
      material_text, quantity, quantity_unit, destination, schedule_text,
      contact_name, contact_phone, partner_id, source_line_user_id, created_at,
      companies:partner_id ( name )
    `)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ events: events ?? [] })
}
