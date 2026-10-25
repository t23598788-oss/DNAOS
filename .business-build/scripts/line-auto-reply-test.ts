/**
 * LINE auto-reply restoration test (owner mission 2026-10-10).
 *
 * Static (wiring locks):
 *   A1 the outbound choke point is CENTRAL POLICY (app_configs), fail-closed,
 *      owner always allowed — the hardcoded gate function is gone
 *   A2 delivery evidence: provider message id captured into line_message_id
 *   A3 deterministic engine exists, is wired BEFORE the ai_tasks enqueue, and
 *      has zero AI imports (cloud/Mac-independent replies)
 *   A4 AI stays optional: ai_tasks enqueue + human-takeover gate unchanged
 *   A5 signature verification still first in index.ts; ResponseGateway is
 *      still the single send path (no parallel pipeline)
 *   A6 no live Ollama/local-AI endpoint call in edge code (comments excluded)
 *   A7 migration writes the policy row on-conflict-do-nothing (re-apply safe)
 *   A8 conversation screen: detail API selects delivery fields; UI shows
 *      sender + delivery state + refreshes the open thread from real rows
 *   A9 registry truth: FCR-016 RESOLVED and runtime blocker is status-aware
 * Live (production, read-only):
 *   L1 policy row exists = allow_all
 *   L2 central LINE connector still connected + enabled (Run gate healthy)
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ""): void {
  checks += 1
  if (ok) { console.log(`PASS  ${name}`); return }
  failures += 1
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
}
function read(p: string): string { return readFileSync(p, "utf8") }

const resp = read("supabase/functions/line-webhook-v2/engines/response.ts")

// A1 — central policy gate
check("A1a policy read from central app_configs row", resp.includes('.eq("title", "line-auto-reply-policy")') && resp.includes('"allow_all"'))
check("A1b fail-closed default is owner_only (missing/unreadable row)", resp.includes('let value: AutoReplyPolicy = "owner_only"'))
check("A1c owner always allowed regardless of policy", resp.includes("ownerId && userId === ownerId"))
check("A1d single gate funnels reply/push/loading", resp.includes("await canSendTo(targetUserId)") && resp.includes("await canSendTo(to)") && resp.includes("await canSendTo(userId)"))
check("A1e hardcoded owner-only gate function removed", !resp.includes("function isOwnerLineUserId"))
check("A1f blocked sends still log honestly (never silent)", resp.includes("[LINE Reply BLOCKED — auto-reply policy denies recipient]") && resp.includes("[LINE Push BLOCKED — auto-reply policy denies recipient]"))

// A2 — delivery evidence
check("A2a provider message id extracted from LINE response", resp.includes("extractProviderMessageId") && resp.includes("sentMessages?.[0]?.id"))
check("A2b stored on the out row (line_message_id + provider shape)", resp.includes("line_message_id: providerMessageId ?? null") && resp.includes("provider_message_id: providerMessageId"))
check("A2c both reply and push paths capture it", resp.includes("logOutboundToDb(targetUserId, messages, await extractProviderMessageId(res))") && resp.includes("logOutboundToDb(to, messages, await extractProviderMessageId(res))"))

// A3 — deterministic engine
const det = read("supabase/functions/line-webhook-v2/engines/deterministic-response.ts")
check("A3a engine exports answerDeterministic", det.includes("export function answerDeterministic"))
const detNoComments = det.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
check("A3b engine has zero AI/network imports (pure sync)", !/claude|ollama|anthropic|openai|fetch\(|ai_tasks/i.test(detNoComments))
const text = read("supabase/functions/line-webhook-v2/handlers/text.ts")
const detIdx = text.indexOf("answerDeterministic(")
const aiIdx = text.indexOf('from("ai_tasks")')
check("A3c wired in handlers/text.ts", detIdx !== -1)
check("A3d deterministic reply runs BEFORE the ai_tasks enqueue", detIdx !== -1 && aiIdx !== -1 && detIdx < aiIdx)

// A4 — AI stays optional, security gates stay
check("A4a ai_tasks enqueue kept (AI path not deleted)", aiIdx !== -1 && text.includes('kind: "handle_text"'))
check("A4b human-takeover gate still first", text.includes('mode === "human_takeover"') && text.indexOf("getConversationMode") < detIdx)
check("A4c loading indicator still shown while optional AI works", text.includes("showLoading(ctx.userId, 60)"))

// A5 — canonical path unchanged
const idx = read("supabase/functions/line-webhook-v2/index.ts")
check("A5a signature verification still before any processing", idx.indexOf("verifyLineSignature") !== -1 && idx.indexOf("verifyLineSignature") < idx.indexOf("function processEvent"))
check("A5b inbound still forwards to the central gateway observe ingress", idx.includes("forwardLineInbound(rawBody, signature)"))
check("A5c ResponseGateway remains the only send gateway in text handler", text.includes("ResponseGateway.replyText") && !text.includes("api.line.me"))

// A6 — no local AI binding in reply path (comments stripped)
const edgeFiles = [
  "supabase/functions/line-webhook-v2/index.ts",
  "supabase/functions/line-webhook-v2/handlers/text.ts",
  "supabase/functions/line-webhook-v2/engines/response.ts",
  "supabase/functions/line-webhook-v2/engines/deterministic-response.ts",
]
let localAiCall = false
for (const f of edgeFiles) {
  const src = read(f).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
  if (/localhost:11434|127\.0\.0\.1:11434|Ollama/.test(src)) localAiCall = true
}
check("A6 no live local-AI endpoint call in reply path", !localAiCall)

// A7 — migration shape
const mig = read("supabase/migrations/20261010000001_line_auto_reply_policy.sql")
check("A7a policy row insert allow_all", mig.includes("'line-auto-reply-policy', 'allow_all'"))
check("A7b on conflict do nothing (re-apply never clobbers Owner flip)", mig.includes("on conflict (title) do nothing"))

// A8 — conversation screen
const detailApi = read("app/api/admin/line-customers/[lineUserId]/route.ts")
check("A8a detail API selects delivery fields", detailApi.includes("line_message_id, status"))
const page = read("app/admin/line-customers/page.tsx")
check("A8b UI shows sender identity per bubble", page.includes('"ระบบ"') && page.includes('m.line_name ?? "ลูกค้า"'))
check("A8c UI shows delivery state for out rows", page.includes("ส่งแล้ว ✓") && page.includes("ส่งไม่สำเร็จ ✗"))
check("A8d open thread auto-refreshes from the same read API", page.includes("setInterval") && page.includes("loadDetail(activeId)"))

// A9 — registry truth
const fcr = read("registry/FACTORY_CENTRAL_REGISTRY.json")
const fcr016 = fcr.slice(fcr.indexOf('"FCR-016"'), fcr.indexOf('"FCR-017"'))
check("A9a FCR-016 status RESOLVED", fcr016.includes('"status": "RESOLVED"'))
const runtime = read("app/api/admin/ide/_lib/systemRealityRuntime.ts")
check("A9b runtime blocker is status-aware (hidden when resolved)", runtime.includes("fcr016Open") && runtime.includes("current_blocker: fcr016Open ?"))

console.log(`\nline-auto-reply static: checks=${checks} passed=${checks - failures} failed=${failures}`)

// ── live (production, read-only) ──────────────────────────────────────────────
async function live(): Promise<void> {
  try {
    const env: Record<string, string> = {}
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
      const i = line.indexOf("=")
      if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
    const base = env.NEXT_PUBLIC_SUPABASE_URL

    const polRes = await fetch(`${base}/rest/v1/app_configs?title=eq.line-auto-reply-policy&select=data`, { headers: H })
    const pol = (await polRes.json()) as { data: string }[]
    check("L1 live policy row exists = allow_all", pol[0]?.data === "allow_all", JSON.stringify(pol))

    const connRes = await fetch(`${base}/rest/v1/connectors?slug=eq.line&select=status,enabled`, { headers: H })
    const conn = (await connRes.json()) as { status: string; enabled: boolean }[]
    check("L2 central LINE connector connected + enabled", conn[0]?.status === "connected" && conn[0]?.enabled === true, JSON.stringify(conn))
  } catch (e) {
    check("live phase ran", false, String(e).slice(0, 160))
  }
  console.log(`line-auto-reply: checks=${checks} passed=${checks - failures} failed=${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}

void live()

