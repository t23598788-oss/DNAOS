import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// Every schema change (CREATE/ALTER/DROP TABLE etc.) logged by the Postgres
// event trigger in 20260710000009_schema_change_audit.sql — catches direct
// database connections too (psql, Prisma, anything with the DB password),
// not just changes made through this app. Owner instruction 2026-07-10,
// prompted by pit_profiles/pit_materials/vehicle_types being dropped by an
// external connection with no record anywhere in this repo.

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { data, error } = await supabase()
    .from("schema_change_log")
    .select("id, phase, command_tag, object_type, object_identity, executed_by, client_addr, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ log: data ?? [] })
}
