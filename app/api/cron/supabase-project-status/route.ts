import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/services/supabase/queries"
import { sendLineMessage } from "@/registry/communication"

// Real incident (owner, 2026-07-29): the dna-os-deadboard Supabase project
// was suspended by a failed Pro-plan invoice on 2026-07-15 — nobody knew
// until the owner happened to click into /admin two weeks later and hit a
// 504. Runs on Vercel, deliberately NOT on Supabase itself (via pg_cron/an
// edge function) — if Supabase pauses again, anything hosted there pauses
// with it, so the one thing checking "is Supabase okay" cannot itself live
// inside Supabase. Uses the Supabase Management API (account-level, not
// project-level — SUPABASE_MANAGEMENT_API_TOKEN, a personal access token
// from supabase.com/dashboard/account/tokens) to check the real status of
// every project across every organization this account has, catching not
// just this one project but the "อีกองค์กรอื่น" (another org) with its own
// outstanding invoice the owner noticed live in the dashboard the same day.
//
// Deliberately narrow: reports project.status !== ACTIVE_HEALTHY. Does not
// attempt to read exact billing/invoice amounts — the Management API does
// not reliably expose those, and guessing at a dollar figure would violate
// the same "never guess, state only what's confirmed" principle as every
// other alert in this system (see engines/owner-dispatcher.ts).
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get("authorization")
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const mgmtToken = process.env.SUPABASE_MANAGEMENT_API_TOKEN
  if (!mgmtToken) {
    return NextResponse.json({ error: "SUPABASE_MANAGEMENT_API_TOKEN not configured" }, { status: 500 })
  }

  let projects: Array<{ id: string; name: string; status: string; organization_id: string }> = []
  try {
    const res = await fetch("https://api.supabase.com/v1/projects", {
      headers: { Authorization: `Bearer ${mgmtToken}` },
    })
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Management API returned HTTP ${res.status}` }, { status: 502 })
    }
    projects = await res.json()
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Management API unreachable: ${(e as Error).message}` }, { status: 502 })
  }

  const unhealthy = projects.filter((p) => p.status !== "ACTIVE_HEALTHY")

  if (unhealthy.length > 0) {
    // Real gap caught before shipping: looking the owner's LINE id up from
    // line_profiles depends on the very Supabase project this route exists
    // to check — if THAT project is the unhealthy one, the lookup fails
    // right when the alert matters most. OWNER_LINE_USER_ID is a plain env
    // var fallback so this alert never depends on Supabase being reachable.
    let ownerLineUserId = process.env.OWNER_LINE_USER_ID ?? null
    if (!ownerLineUserId) {
      try {
        const { data: owner } = await supabaseAdmin()
          .from("line_profiles").select("line_user_id").eq("role", "owner").limit(1).maybeSingle()
        ownerLineUserId = owner?.line_user_id ?? null
      } catch {
        ownerLineUserId = null
      }
    }

    if (ownerLineUserId) {
      const lines = unhealthy.map((p) => `- ${p.name}: ${p.status}`).join("\n")
      await sendLineMessage(supabaseAdmin(), ownerLineUserId, [{
        type: "text",
        text: `🚨 พบโปรเจกต์ Supabase ที่ไม่ปกติ:\n${lines}\n\nเช็คที่ supabase.com/dashboard — อาจเกิดจากใบแจ้งหนี้ค้างชำระหรือ project ถูกพัก`,
      }])
    }
  }

  return NextResponse.json({ ok: true, checked: projects.length, unhealthy: unhealthy.length, projects: unhealthy })
}
