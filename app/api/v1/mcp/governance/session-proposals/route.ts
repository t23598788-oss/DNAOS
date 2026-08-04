import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { authenticate } from "../_lib/auth"

export async function POST(req: Request) {
  const auth = await authenticate(req, "governance:propose")
  if (!auth.ok) return auth.response
  const body = await req.json().catch(() => null) as { goal?: unknown; file_scope?: unknown } | null
  const goal = typeof body?.goal === "string" ? body.goal.trim() : ""
  const fileScope = Array.isArray(body?.file_scope) && body.file_scope.every((x) => typeof x === "string") ? body.file_scope : null
  if (!goal || !fileScope || fileScope.length === 0 || fileScope.length > 100) {
    return NextResponse.json({ error: "goal and file_scope[1..100] are required" }, { status: 400 })
  }

  const sessionId = `mcp-${randomUUID()}`
  const { data, error } = await auth.db.from("dev_loop_sessions").insert({ id: sessionId, owner: auth.token.user_email, goal, file_scope: fileScope, status: "open" }).select("id, owner, goal, file_scope, status, started_at").single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? "session proposal failed" }, { status: 503 })

  return NextResponse.json({
    data,
    mode: "proposal",
    session_id: sessionId,
    evidence_ids: [],
    approval_required: true,
    note: "Session proposal created; evidence is required before a registry proposal.",
  }, { status: 201 })
}
