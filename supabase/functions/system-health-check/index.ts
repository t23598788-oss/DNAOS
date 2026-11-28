// System Health Check — Runtime Verification (owner, 2026-07-29, extended
// 2026-08-04): real Supabase Auth slowdown caused a real 504 on /admin, then
// a real "Failed to fetch" on login — the owner had to notice both himself.
// Owner's own instruction: "เขียนซอฟต์แวร์...เพื่อจะเช็คตรงนี้เอง...ทำงานแบบ
// เงียบๆอยู่หลังบ้าน" — this checks the real Supabase Auth + REST endpoints.
//
// Extended 2026-08-04 (owner directive: "Add Runtime Verification. Do not
// trust configuration. Verify periodically.") to real per-service checks,
// not just Supabase — reusing the SAME consecutive-failure/alert-once
// pattern (system_health_status, now per-service via service_key, migration
// 20260804000001) instead of a second health mechanism. Every check below
// is a real network call or a real DB query against pg_cron's own execution
// history (get_cron_job_status(), migration 20260804000002) — never a
// guess, never a "should be fine" assumption.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4"
import { alertOwnerAnomaly } from "../line-webhook-v2/engines/owner-dispatcher.ts"
import { getGmailAccessToken } from "../_shared/gmail-client.ts"
import { getLineChannelAccessToken } from "../_shared/line-client.ts"
import { describeDenoAiReadiness } from "../_shared/ai/runtime.ts"

const CONSECUTIVE_FAILURES_BEFORE_ALERT = 2

type CheckResult = {
  service_key: string
  check_kind: "http_reachability" | "oauth_token" | "cron_execution" | "config_presence"
  ok: boolean
  detail: Record<string, unknown>
}

async function checkReachable(url: string, headers: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    if (res.status >= 500) return `HTTP ${res.status} จาก ${url}`
    return null
  } catch (e) {
    return `เชื่อมต่อ ${url} ไม่ได้: ${(e as Error).message}`
  }
}

async function checkSupabase(supabaseUrl: string, anonKey: string): Promise<CheckResult> {
  const authError = await checkReachable(`${supabaseUrl}/auth/v1/health`, { apikey: anonKey })
  const restError = authError ? null : await checkReachable(`${supabaseUrl}/rest/v1/`, { apikey: anonKey })
  const error = authError ?? restError
  return { service_key: "supabase", check_kind: "http_reachability", ok: !error, detail: { error } }
}

// A7.8 — AI health is adapter READINESS from the canonical registry, not "some
// provider answered". Each declared adapter is reported separately, and the
// dimensions stay separated on purpose: runtime-compatible / enabled /
// credential-present / capability-ready. A single provider responding is NOT
// evidence that the AI system is healthy, so no provider ping happens here.
async function checkAiAdapters(): Promise<CheckResult[]> {
  const readiness = describeDenoAiReadiness();
  return readiness.map((r) => ({
    service_key: `ai_adapter_${r.id}`,
    check_kind: "config_presence",
    ok: r.enabled && r.runtimeCompatible && r.credentialPresent,
    detail: {
      enabled: r.enabled,
      runtime_compatible: r.runtimeCompatible,
      credential_present: r.credentialPresent,
      capability_ready: r.capabilityReady,
      reason: r.reason,
    },
  }));
}

// Real LINE Messaging API token-validity check — /v2/bot/info is the real,
// documented lightweight endpoint LINE provides specifically for this
// (returns the bot's own profile if the channel access token is valid).
async function checkLineMessaging(): Promise<CheckResult> {
  // Canonical credential path (LINE cutover): token comes only through the
  // internal bridge → connector lifecycle Run gate — fail-closed, no env fallback.
  const token = await getLineChannelAccessToken()
  if (!token) return { service_key: "line_messaging", check_kind: "config_presence", ok: false, detail: { reason: "LINE connector ยังไม่พร้อม (Register/Test/Enable ที่ /admin/connectors) — bridge คืน token ไม่ได้" } }
  try {
    const res = await fetch("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 401) return { service_key: "line_messaging", check_kind: "oauth_token", ok: false, detail: { status: 401, reason: "Channel access token หมดอายุหรือไม่ถูกต้อง" } }
    if (res.status >= 500) return { service_key: "line_messaging", check_kind: "http_reachability", ok: false, detail: { status: res.status } }
    return { service_key: "line_messaging", check_kind: "http_reachability", ok: true, detail: { status: res.status } }
  } catch (e) {
    return { service_key: "line_messaging", check_kind: "http_reachability", ok: false, detail: { error: (e as Error).message } }
  }
}

// Real Gmail OAuth refresh-token validity check — reuses the exact same
// token-fetch every real Gmail-reading function already depends on
// (bank-email-sync/supabase-billing-sync/subscription-email-sync); a null
// return here means those 3 functions' next cron run will also fail.
async function checkGmail(): Promise<CheckResult> {
  const token = await getGmailAccessToken()
  return {
    service_key: "gmail",
    check_kind: "oauth_token",
    ok: !!token,
    detail: token ? { reason: "connector ให้ access token ได้" } : { reason: "ขอ access token ไม่สำเร็จ — เช็ค Gmail connector lifecycle ที่ /admin/connectors" },
  }
}

// Real pg_cron execution check via get_cron_job_status() (migration
// 20260804000002) — reads cron.job_run_details, pg_cron's own real
// execution log, not a guess. "succeeded" means the scheduling statement
// (net.http_post, fire-and-forget/async) ran without throwing — it does
// NOT prove the called Edge Function's business logic succeeded, only that
// the trigger itself fired. Stated honestly in detail.note, not overclaimed.
async function checkCronJobs(supabase: any): Promise<CheckResult[]> {
  const { data: jobs } = await supabase.rpc("get_cron_job_status")
  if (!jobs) return []
  return jobs.map((j: any) => ({
    service_key: `cron:${j.jobname}`,
    check_kind: "cron_execution" as const,
    ok: j.ok,
    detail: {
      last_status: j.last_status,
      last_run_at: j.last_run_at,
      schedule: j.schedule,
      note: "\"succeeded\" หมายถึง pg_cron ยิง trigger ออกไปสำเร็จ ไม่ได้แปลว่าฟังก์ชันปลายทางทำงานถูกต้อง 100%",
    },
  }))
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

  const checks: CheckResult[] = [
    await checkSupabase(supabaseUrl, anonKey),
    ...(await checkAiAdapters()),
    await checkLineMessaging(),
    await checkGmail(),
    ...(await checkCronJobs(supabase)),
  ]

  const results: Array<{ service_key: string; status: string; consecutiveFailures: number }> = []

  for (const check of checks) {
    const { data: prev } = await supabase
      .from("system_health_status").select("*").eq("service_key", check.service_key).maybeSingle()

    const consecutiveFailures = check.ok ? 0 : (prev?.consecutive_failures ?? 0) + 1
    const wasDegraded = prev?.status === "degraded"
    const isDegraded = consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_ALERT

    await supabase.from("system_health_status").upsert({
      service_key: check.service_key,
      check_kind: check.check_kind,
      status: isDegraded ? "degraded" : "healthy",
      consecutive_failures: consecutiveFailures,
      last_check_at: new Date().toISOString(),
      last_error: check.ok ? null : JSON.stringify(check.detail),
      detail: check.detail,
      last_alert_at: (isDegraded && !wasDegraded) || (!isDegraded && wasDegraded)
        ? new Date().toISOString()
        : prev?.last_alert_at,
    }, { onConflict: "service_key" })

    // Alert once when crossing INTO degraded, and once when recovering — not
    // on every run while the state is unchanged either way (same discipline
    // as the original single-service version).
    if (isDegraded && !wasDegraded) {
      await alertOwnerAnomaly(
        supabase,
        `ระบบตรวจพบว่า ${check.service_key} มีปัญหาต่อเนื่อง ${consecutiveFailures} ครั้ง (${check.check_kind}) — ${JSON.stringify(check.detail)}`,
      )
    } else if (!isDegraded && wasDegraded) {
      await alertOwnerAnomaly(supabase, `${check.service_key} กลับมาปกติแล้วครับ`)
    }

    results.push({ service_key: check.service_key, status: isDegraded ? "degraded" : "healthy", consecutiveFailures })
  }

  return Response.json({ ok: true, results })
})
