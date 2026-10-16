/**
 * POST /api/internal/ai/ollama/poll — ฝั่ง Mac (worker เป็นฝ่ายเชื่อมออกเสมอ;
 * Railway ไม่เรียกหา Mac เลย — ห้าม assume ว่าเข้าถึง Tailnet ได้)
 *
 * Auth: header x-dna-ai-relay-token (timing-safe เทียบกับ DNA_AI_RELAY_SHARED_SECRET)
 * ตอบ: { ok: true, job: { request_id, model, system, prompt, images? } } หรือ
 *      { ok: true, empty: true } เมื่อไม่มีงานในเวลาโพล
 * งานถูก "ถือออกจากคิว" ตอนมารับ — ผลเสียเวลาไม่ตอบกลับ → งานหมดอายุทิ้ง
 * เงียบ ๆ (ไม่มี waiter ค้าง — fail-closed ตามที่ runtime กำกับ)
 */
import { NextResponse } from "next/server";
import { relayEnabled, relayTokenMatches, takeJob } from "../../_lib/relayRuntime";

export async function POST(req: Request) {
  if (!relayEnabled()) {
    return NextResponse.json({ ok: false, error: "AI_RELAY_NOT_CONFIGURED" }, { status: 503 });
  }
  const token = req.headers.get("x-dna-ai-relay-token");
  if (!relayTokenMatches(token)) {
    return NextResponse.json({ ok: false, error: "AI_RELAY_UNAUTHORIZED" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({})) as { wait_ms?: unknown };
  const job = await takeJob(Number(body.wait_ms) || 20_000, true);
  if ("empty" in job) return NextResponse.json({ ok: true, empty: true });
  return NextResponse.json({ ok: true, job });
}
