/**
 * POST /api/internal/ai/ollama/generate — transport FACE ที่ agent เดิมของ
 * AI Gateway (services/ai/adapters.ts#ollamaAdapter) จะโพสต์เมื่อ
 * AI_GATEWAY_OLLAMA_URL ถูกชี้มาที่ self loopback ของ container นี้
 *
 * Request/response SHAPE = ของ Ollama /api/generate จริง (เพื่อไม่ต้องแตะสัญญา
 * adapter เดิม):
 *   body: { model, system?, prompt, images?, stream:false, options? }
 *   ตอบ: { response: "<ข้อความ>" } หรือ { error: { message } }
 *
 * นี่ไม่ใช่ AI Gateway ตัวที่สอง: ไม่มี capability/selection/evidence —
 * เป็น transport ของ body adapter เท่านั้น เงื่อนไขยอมรับ (fail-closed):
 *   1) เรียกจาก loopback ของ container นี้เท่านั้น (Host = 127.0.0.1/localhost
 *      ที่ PORT จริงที่โปรเซสฟัง) — public host = 403 หรือต้องพิสูจน์ token
 *   2) model ต้องอยู่ใน allow-list (deny-by-default, ค่าเริ่มจากที่ registry
 *      ปักหมุด intent.classify = qwen3:8b)
 *   3) รอผลจาก Mac สูงสุด RELAY_INFER_WAIT_MS (น้อยกว่า adapter timeout
 *      60s — จบจากฝั่งของเราอย่างมีนัยสำคัญเสมอ)
 */
import { NextResponse } from "next/server";
import {
  enqueueAndWait, allowedRelayModels, isLoopbackHost, isLoopbackIpList,
  relayTokenMatches, relayEnabled, type OllamaRelayJob,
} from "../../_lib/relayRuntime";

function newRequestId(): string {
  return `olar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function POST(req: Request) {
  const host = req.headers.get("host");
  const tokenHeader = req.headers.get("x-dna-ai-relay-token");
  // ยอมรับได้เมื่อสายไห้มาเป็น loopback ของ container แท้ ๆ: ผู้ที่มาจาก proxy
  // สาธารณะถูกแนบ x-forwarded-for เป็น IP จริงของผู้เรียกเสมอ (หลอก Host แล้วยัง
  // โดนเพราะ IP ต่าง) ขณะที่การเรียกตัวเองในเครื่อง อาจแนบ "127.0.0.1" (Next dev
  // middleware/proxy ทำ) หรือไม่ส่งเลย — ทั้งสองแบบยอมเป็น loopback
  const forwarded = [
    req.headers.get("x-forwarded-for"),
    req.headers.get("cf-connecting-ip"),
    req.headers.get("x-real-ip"),
  ];
  if (forwarded.some((ip) => ip != null && !isLoopbackIpList(ip))) {
    return NextResponse.json({ error: { message: "AI_RELAY_FORBIDDEN_ORIGIN" } }, { status: 403 });
  }
  const loopback = isLoopbackHost(host);
  if (!loopback && !(relayEnabled() && relayTokenMatches(tokenHeader))) {
    // ต้องมาจาก container เอง — มาจากภายนอกโดยไม่มี token = ปฏิเสธเสมอ
    return NextResponse.json({ error: { message: "AI_RELAY_FORBIDDEN_ORIGIN" } }, { status: 403 });
  }
  if (!relayEnabled()) {
    // loopback ไม่พอหากยังไม่มี token ตั้ง — การเชื่อมต้องใช้คู่ secret เท่านั้น
    return NextResponse.json({ error: { message: "AI_RELAY_NOT_CONFIGURED: DNA_AI_RELAY_SHARED_SECRET ยังไม่ถูกตั้งบน service นี้" } }, { status: 503 });
  }

  const body = await req.json().catch(() => null) as {
    model?: unknown; system?: unknown; prompt?: unknown; images?: unknown; stream?: unknown; request_id?: unknown;
  } | null;
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json({ error: { message: "AI_RELAY_PROMPT_INVALID" } }, { status: 400 });
  }
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : null;
  if (!model || !allowedRelayModels().includes(model)) {
    return NextResponse.json(
      { error: { message: `AI_RELAY_MODEL_NOT_ALLOWED: ${model ?? "(none)"} (allowed: ${allowedRelayModels().join(", ")})` } },
      { status: 400 },
    );
  }
  const images: string[] | undefined = Array.isArray(body.images)
    ? body.images.filter((v): v is string => typeof v === "string").slice(0, 4)
    : undefined;

  const body_ = body as { request_id?: unknown };
  const transportId = typeof body_.request_id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body_.request_id.trim())
    ? body_.request_id.trim()
    : newRequestId();
  const job: OllamaRelayJob = {
    request_id: transportId,
    model,
    system: typeof body.system === "string" ? body.system : null,
    prompt: body.prompt,
    ...(images ? { images } : {}),
    created_at: new Date().toISOString(),
  };
  const outcome = await enqueueAndWait(job);
  if (outcome.ok) {
    return NextResponse.json({ model, response: outcome.response, stream: false, request_id: job.request_id });
  }
  const status = /NOT_CONFIGURED|MODEL_NOT_ALLOWED/.test(outcome.error) ? 503 : 504;
  return NextResponse.json({ error: { message: outcome.error }, request_id: job.request_id }, { status });
}
