import { NextResponse } from "next/server"
import { runCognitivePipeline } from "@/cognitive/pipeline"

type PipelineResult = Awaited<ReturnType<typeof runCognitivePipeline>>

/**
 * Edge-function bridge for the OpenClaw + Pinto mobile channel. Supabase Edge
 * Functions (Deno) cannot import the Node cognitive pipeline directly, so the
 * `openclaw-webhook` edge function calls this narrowly-scoped server route
 * with a shared secret instead — same bridge pattern as
 * app/api/internal/line/document-artifact.
 *
 * This does not bypass Rule 72 (no unconfirmed writes): runCognitivePipeline
 * only proposes/plans here; real mutations still require the user's next
 * message to be an explicit "execute_pending" intent (ส่งเลย/ทำเลย), exactly
 * like the LINE channel today.
 */
export async function POST(req: Request) {
  const secret = process.env.OPENCLAW_INTERNAL_SECRET
  if (!secret || req.headers.get("x-openclaw-internal-secret") !== secret) {
    return NextResponse.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as { userCommand?: string; contactContext?: string | null; userId?: string } | null
  if (!body?.userCommand) {
    return NextResponse.json({ error: "ไม่มี userCommand" }, { status: 400 })
  }

  try {
    // Server-derived, channel-scoped memory key (owner 2026-10-08): this bridge
    // authenticates with a shared secret, so its identity is the CHANNEL (plus
    // userId when the edge function provides one) — never the shared
    // `__default__` bucket that other users could also land in.
    const result = await runCognitivePipeline(
      body.userCommand,
      body.contactContext ?? null,
      `channel:openclaw:${body.userId && body.userId.trim() ? body.userId.trim() : "shared"}`,
    )
    return NextResponse.json({ ok: true, reply: toReplyText(result) })
  } catch {
    return NextResponse.json(
      { ok: false, reply: "ขออภัยครับ ระบบประมวลผลคำสั่งไม่สำเร็จตอนนี้ ลองใหม่อีกครั้งครับ" },
      { status: 200 },
    )
  }
}

function toReplyText(result: PipelineResult): string {
  if ("command" in result && result.command === "CLEAR_SCREEN") {
    return "ล้างหน้าจอให้แล้วครับ"
  }
  if (result.type === "workspace" && "workspace" in result) {
    return "เปิดข้อมูลในแดชบอร์ดให้แล้วครับ — ดูรายละเอียดที่หน้าจอ DNA OS"
  }
  return String("text" in result ? result.text : "รับคำสั่งแล้วครับ")
}
