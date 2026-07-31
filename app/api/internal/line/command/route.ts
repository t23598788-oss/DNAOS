import { NextResponse } from "next/server"
import { runCognitivePipeline } from "@/cognitive/pipeline"
import { supabaseAdmin } from "@/services/supabase/queries"

type PipelineResult = Awaited<ReturnType<typeof runCognitivePipeline>>

/**
 * Edge-function bridge for the owner's own LINE chat acting as a remote
 * control for the admin dashboard (owner, 2026-07-31: "กูสั่งจาก LINE
 * โน้ตบุ๊กนี้ขยับตามได้เลยแหละ"). Supabase Edge Functions (Deno) cannot
 * import the Node cognitive pipeline directly, so
 * supabase/functions/line-webhook-v2/handlers/text.ts calls this
 * narrowly-scoped, secret-gated server route instead — same bridge pattern
 * as app/api/internal/openclaw/command and app/api/internal/line/document-artifact.
 *
 * Unlike the openclaw bridge, this one also writes a row to live_commands
 * so any admin dashboard tab already open (subscribed via Supabase
 * Realtime) can navigate/react live, not just get a LINE reply back.
 *
 * This does not bypass Rule 72 (no unconfirmed writes): runCognitivePipeline
 * only proposes/plans here; real mutations still require the owner's next
 * message to be an explicit "execute_pending" intent (ส่งเลย/ทำเลย), exactly
 * like every other channel.
 */
export async function POST(req: Request) {
  const secret = process.env.LINE_COMMAND_INTERNAL_SECRET
  if (!secret || req.headers.get("x-line-command-internal-secret") !== secret) {
    return NextResponse.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as { lineUserId?: string; commandText?: string } | null
  if (!body?.lineUserId || !body?.commandText) {
    return NextResponse.json({ error: "ไม่มี lineUserId หรือ commandText" }, { status: 400 })
  }

  try {
    const result = await runCognitivePipeline(body.commandText, body.lineUserId)
    const navigateUrl = "navigate_url" in result ? result.navigate_url ?? null : null
    const workspace = "workspace" in result ? result.workspace ?? null : null

    await supabaseAdmin().from("live_commands").insert({
      line_user_id: body.lineUserId,
      command_text: body.commandText,
      reply_text: toReplyText(result),
      navigate_url: navigateUrl,
      workspace,
    })

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
    return "เปิดข้อมูลในแดชบอร์ดให้แล้วครับ — ถ้ามีหน้าจอ DNA OS เปิดอยู่จะขยับตามให้เองครับ"
  }
  return String("text" in result ? result.text : "รับคำสั่งแล้วครับ")
}
