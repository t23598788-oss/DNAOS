import { NextResponse } from "next/server"
import { authenticate } from "../_lib/auth"

export async function POST(req: Request) {
  // Body first (owner_verification_artifact travels with the privileged
  // mutation), then the authority chain: token scope (permission) -> owner
  // verification. Nothing below touches the database before both pass.
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const auth = await authenticate(req, "governance:propose", body?.owner_verification_artifact)
  if (!auth.ok) return auth.response
  const sessionId = typeof body?.session_id === "string" ? body.session_id : ""
  const evidenceId = typeof body?.evidence_event_id === "string" ? body.evidence_event_id : ""
  const checkId = typeof body?.check_result_id === "string" ? body.check_result_id : ""
  const path = typeof body?.path === "string" ? body.path : ""
  const patch = body?.patch
  if (!sessionId || !evidenceId || !checkId || !path || typeof patch !== "object" || patch === null) return NextResponse.json({ error: "session_id, evidence_event_id, check_result_id, path and patch are required" }, { status: 400 })
  if (path.startsWith("registry/") && path !== "registry/module-registry.json") return NextResponse.json({ error: "only module-registry.json proposals are allowed" }, { status: 400 })

  const session = await auth.db.from("dev_loop_sessions").select("id, owner, status").eq("id", sessionId).single()
  const evidence = await auth.db.from("dev_loop_evidence_events").select("id, session_id, path").eq("id", evidenceId).single()
  const check = await auth.db.from("dev_loop_check_results").select("id, evidence_event_id, session_id, result").eq("id", checkId).single()
  if (session.error || evidence.error || check.error || !session.data || !evidence.data || !check.data) return NextResponse.json({ error: "session/evidence/check not found" }, { status: 404 })
  if (session.data.owner !== auth.token.user_email || session.data.status !== "open" || evidence.data.session_id !== sessionId || check.data.session_id !== sessionId || check.data.evidence_event_id !== evidenceId) return NextResponse.json({ error: "session ownership or evidence linkage failed" }, { status: 403 })
  if (check.data.result === "pass") return NextResponse.json({ error: "a passing impact result cannot create a registry proposal" }, { status: 409 })

  const inserted = await auth.db.from("dev_loop_registry_proposals").insert({ check_result_id: checkId, session_id: sessionId, target_registry: "registry/module-registry.json", path, patch, status: "pending" }).select("id, check_result_id, session_id, target_registry, path, patch, status, proposed_at").single()
  if (inserted.error || !inserted.data) return NextResponse.json({ error: inserted.error?.message ?? "proposal failed" }, { status: 503 })
  return NextResponse.json({ data: inserted.data, mode: "proposal", session_id: sessionId, evidence_ids: [evidenceId], approval_required: true, decided: false }, { status: 201 })
}
