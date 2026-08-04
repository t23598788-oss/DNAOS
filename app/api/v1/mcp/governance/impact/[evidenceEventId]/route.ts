import { NextResponse } from "next/server"
import { mcpEnvelope, mcpCorsHeaders } from "../../../../_lib/envelope"
import { authenticate } from "../../_lib/auth"

export async function GET(req: Request, context: { params: Promise<{ evidenceEventId: string }> }) {
  const auth = await authenticate(req, "read")
  if (!auth.ok) return auth.response
  const { evidenceEventId } = await context.params
  const event = await auth.db.from("dev_loop_evidence_events").select("id, session_id, path, event_type, content_hash, diff_summary, occurred_at").eq("id", evidenceEventId).single()
  if (event.error || !event.data) return NextResponse.json({ error: event.error?.message ?? "evidence event not found" }, { status: 404 })
  const checks = await auth.db.from("dev_loop_check_results").select("id, evidence_event_id, session_id, path, result, reason, dependents, checked_at").eq("evidence_event_id", evidenceEventId).order("checked_at", { ascending: false })
  if (checks.error) return NextResponse.json({ error: checks.error.message }, { status: 503 })

  return NextResponse.json(mcpEnvelope({ event: event.data, checks: checks.data ?? [], human_approval_required: true }, {
    source_files: ["supabase/migrations/20260805000001_dev_loop_pipeline.sql", "scripts/impact-analyzer.ts"], registry_version: {}, confidence: "high",
  }), { headers: mcpCorsHeaders() })
}
