/**
 * Railway task-queue client (DNA-000218, RAILWAY NATIVE CLINE RUNTIME).
 * ใช้เมื่อไม่มี cline binary ในเครื่อง (Railway Business Core) — ส่งคำสั่ง owner
 * เข้า ai_tasks (kind=owner_cline_command, สัญญาเดิมของ LINE pipeline) →
 * dna-os-cline-worker (Railway Linux) รัน Cline → ผลกลับผ่าน ai-callback →
 * ที่นี่รอ (poll) แล้วแปลงเป็น ClineWorkerReply เดิม — ไม่มี queue ใหม่ ไม่มี
 * authority ใหม่ · duplicate ป้องกันด้วย: ถ้ามี pending/processing ของ session
 * เดียวกันอยู่แล้ว จะรออันนั้นแทนการสร้างใหม่ · session_cookie ถูกลบอัตโนมัติ
 * หลัง callback เขียนผลแล้ว (ฝั่ง worker + callback)
 */
import { createClient } from "@supabase/supabase-js"
import { sanitizeClineResult, type ClineWorkerReply, type ClineWorkerTransport } from "./clineWorker"

const POLL_MS = 2500
const MAX_WAIT_MS = Number(process.env.CLINE_TASK_WAIT_MS ?? 150_000)

let workerUnavailableUntil = 0
export function __resetClineQueueFailuresForTest() {
  workerUnavailableUntil = 0
}

export async function runOwnerRequestViaRailwayTaskQueue(
  message: string,
  opts: {
    sessionKey?: string | null
    transport: ClineWorkerTransport & { userId?: string | null }
    who?: string | null
    whoId?: string | null
  },
): Promise<ClineWorkerReply | null> {
  if (process.env.CLINE_QUEUE_ENABLED !== "true") return null
  // LOCAL AGENT BRIDGE KILL SWITCH (default OFF): no worker consumes ai_tasks in
  // this Railway project, so enqueueing only costs MAX_WAIT_MS of latency.
  if (process.env.LOCAL_AGENT_BRIDGE_ENABLED !== "true") return null
  if (Date.now() < workerUnavailableUntil) return null

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || !opts.transport.cookie || !opts.transport.userId) return null
  const db = createClient(url, key, { auth: { persistSession: false } })

  // duplicate protection + ownership: reuse in-flight task เฉพาะของ owner คน
  // เดียวกันและ session เดียวกัน (owner_user_id + session_key)
  const { data: existing } = await db
    .from("ai_tasks")
    .select("id")
    .eq("kind", "owner_cline_command")
    .eq("owner_user_id", opts.transport.userId)
    .eq("session_key", opts.sessionKey ?? "-")
    .in("status", ["pending", "processing"])
    .limit(1)

  let taskId: string | null = existing?.[0]?.id ?? null
  if (!taskId) {
    const { data: inserted, error } = await db
      .from("ai_tasks")
      .insert({
        kind: "owner_cline_command",
        line_user_id: String(opts.transport.userId),
        owner_user_id: opts.transport.userId,
        input_text: message.slice(0, 2000),
        session_key: opts.sessionKey ?? null,
        session_cookie: opts.transport.cookie,
        // company context propagation (DNA-000219): ใช้คอลัมน์ trace jsonb ที่มี
        // อยู่แล้ว (migration 20260804000003) เก็บบริบทคู่ค้าให้ worker เอามาใส่
        // prompt — ไม่สร้างคอลัมน์/คอลัมน์ claim_who ใหม่ (ไม่จำเป็นจริง)
        trace: { context: { who: opts.who ?? null, who_id: opts.whoId ?? null } },
        status: "pending",
        expires_at: new Date(Date.now() + MAX_WAIT_MS + 60_000).toISOString(),
      })
      .select("id")
      .single()
    if (error || !inserted?.id) {
      console.error("[clineTaskQueue] enqueue failed:", error?.message ?? "no id")
      return null
    }
    taskId = inserted.id
  }

  const deadline = Date.now() + MAX_WAIT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const { data: task } = await db.from("ai_tasks").select("status, result, error").eq("id", taskId).maybeSingle()
    if (!task) continue
    if (task.status === "done" && task.result) {
      const parsed = typeof task.result === "object" ? task.result : {}
      const r = parsed as Record<string, unknown>
      const answer = typeof r.answer === "string" ? r.answer : ""
      const ask = typeof r.ask === "string" && r.ask ? r.ask : null
      return {
        text: ask ? `${answer}\n\n❓ ${ask}` : answer || "ทำงานเสร็จแล้วครับ",
        result: sanitizeClineResult(r.result),
        evidence: { taskId, durationMs: Number(r.durationMs ?? 0), totalCost: null, totalOutputTokens: null, iterations: null },
      }
    }
    if (task.status === "failed") {
      const reason = String(task.error ?? "")
      if (/INTERPRETER_OUTPUT_INVALID|INSUFFICIENT_CREDITS|no run_result|^spawn:/.test(reason)) {
        workerUnavailableUntil = Date.now() + 10 * 60_000
      }
      console.error("[clineTaskQueue] task failed:", reason.slice(0, 200))
      return null
    }
  }
  console.error("[clineTaskQueue] timeout waiting for task", taskId)
  return null
}
