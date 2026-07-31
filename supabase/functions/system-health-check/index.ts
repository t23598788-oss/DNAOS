// System Health Check (owner, 2026-07-29): a real Supabase Auth slowdown
// caused a real 504 on /admin, then a real "Failed to fetch" on login — the
// owner had to notice both himself and come report them. Owner's own
// instruction: "เขียนซอฟต์แวร์...เพื่อจะเช็คตรงนี้เอง...ทำงานแบบเงียบๆอยู่
// หลังบ้าน" — this checks the real Supabase Auth + REST endpoints on a cron
// schedule (see migration 20260729000001) and pushes a real LINE alert to
// the owner via the Owner Dispatcher (engines/owner-dispatcher.ts, built
// 2026-07-27) only on a genuinely sustained problem — never on one
// transient blip, never more than once per incident.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { alertOwnerAnomaly } from "../line-webhook-v2/engines/owner-dispatcher.ts"

const CONSECUTIVE_FAILURES_BEFORE_ALERT = 2

async function checkReachable(url: string, headers: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    // Auth/REST health endpoints reply with a real HTTP status even when the
    // request itself is "wrong" (e.g. 401) — only a genuine network failure
    // (thrown exception) or a 5xx means the service itself is unreachable/down.
    if (res.status >= 500) return `HTTP ${res.status} จาก ${url}`
    return null
  } catch (e) {
    return `เชื่อมต่อ ${url} ไม่ได้: ${(e as Error).message}`
  }
}

Deno.serve(async (req) => {
  const expected = Deno.env.get("SYSTEM_HEALTH_CHECK_SECRET")
  const got = req.headers.get("x-system-health-check-secret")
  if (!expected || got !== expected) {
    return new Response("unauthorized", { status: 401 })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(supabaseUrl, serviceKey)

  const authError = await checkReachable(`${supabaseUrl}/auth/v1/health`, { apikey: anonKey })
  const restError = authError ? null : await checkReachable(`${supabaseUrl}/rest/v1/`, { apikey: anonKey })
  const error = authError ?? restError

  const { data: prev } = await supabase
    .from("system_health_status").select("*").eq("id", 1).maybeSingle()

  const consecutiveFailures = error ? (prev?.consecutive_failures ?? 0) + 1 : 0
  const wasDegraded = prev?.status === "degraded"
  const isDegraded = consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_ALERT

  await supabase.from("system_health_status").upsert({
    id: 1,
    status: isDegraded ? "degraded" : "healthy",
    consecutive_failures: consecutiveFailures,
    last_check_at: new Date().toISOString(),
    last_error: error,
    last_alert_at: (isDegraded && !wasDegraded) || (!isDegraded && wasDegraded)
      ? new Date().toISOString()
      : prev?.last_alert_at,
  })

  // Alert once when crossing INTO degraded, and once when recovering — not
  // on every run while the state is unchanged either way.
  if (isDegraded && !wasDegraded) {
    await alertOwnerAnomaly(
      supabase,
      `ระบบตรวจพบว่า Supabase เชื่อมต่อไม่ได้ต่อเนื่อง ${consecutiveFailures} ครั้ง (${error}) — อาจกระทบหน้า login/admin ทั้งหมดชั่วคราว`,
    )
  } else if (!isDegraded && wasDegraded) {
    await alertOwnerAnomaly(supabase, `Supabase กลับมาเชื่อมต่อได้ปกติแล้วครับ`)
  }

  return Response.json({ ok: true, healthy: !error, error, consecutiveFailures })
})
