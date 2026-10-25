/**
 * POST /api/internal/ai/ollama/result — worker ฝั่ง Mac ส่งผล Ollama กลับมา
 * Auth: header เดียวกัน (timing-safe) · จับคู่ request_id กับ waiter ที่รอจริง
 * เท่านั้น (ไม่ match = ทิ้งเงียบ ๆ, ไม่มีสิทธิ์หลงเหลือ) — fail-closed
 */
import { NextResponse } from "next/server";
import { relayEnabled, relayTokenMatches, completeJob } from "../../_lib/relayRuntime";

export async function POST(req: Request) {
  if (!relayEnabled()) {
    return NextResponse.json({ ok: false, error: "AI_RELAY_NOT_CONFIGURED" }, { status: 503 });
  }
  const token = req.headers.get("x-dna-ai-relay-token");
  if (!relayTokenMatches(token)) {
    return NextResponse.json({ ok: false, error: "AI_RELAY_UNAUTHORIZED" }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as {
    request_id?: unknown; ok?: unknown; response_text?: unknown; error?: unknown;
  } | null;
  if (!body || typeof body.request_id !== "string" || !body.request_id.trim()) {
    return NextResponse.json({ ok: false, error: "AI_RELAY_REQUEST_ID_REQUIRED" }, { status: 400 });
  }
  const matched = completeJob({
    request_id: body.request_id.trim(),
    ok: body.ok === true,
    response_text: typeof body.response_text === "string" ? body.response_text : null,
    error: typeof body.error === "string" ? body.error : null,
  });
  return NextResponse.json(matched ? { ok: true, matched: true } : { ok: true, matched: false });
}
