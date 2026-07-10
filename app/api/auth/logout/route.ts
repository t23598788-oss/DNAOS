import { NextResponse } from "next/server"
import { createServerSupabase } from "@/services/supabase/server"

// TASK-001 (SSO): the one real logout for the whole system — signs out of
// the Supabase Auth session server-side (invalidates the refresh token, not
// just clearing a client-side cookie) so it's gone from every Portal at once.
export async function POST() {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  return NextResponse.json({ ok: true })
}