import { NextResponse } from "next/server"
import { mcpCorsHeaders, mcpEnvelope } from "../../_lib/envelope"
import { authenticate } from "../_lib/auth"

export async function GET(req: Request) {
  const auth = await authenticate(req, "read")
  if (!auth.ok) return auth.response

  const [sessions, evidence, checks, proposals] = await Promise.all([
    auth.db.from("dev_loop_sessions").select("id, owner, goal, file_scope, status, started_at, closed_at").order("started_at", { ascending: false }).limit(20),
    auth.db.from("dev_loop_evidence_events").select("id, session_id, path, event_type, content_hash, occurred_at").order("occurred_at", { ascending: false }).limit(50),
    auth.db.from("dev_loop_check_results").select("id, evidence_event_id, session_id, path, result, reason, dependents, checked_at").order("checked_at", { ascending: false }).limit(50),
    auth.db.from("dev_loop_registry_proposals").select("id, check_result_id, session_id, target_registry, path, patch, status, proposed_at, decided_by, decided_at").order("proposed_at", { ascending: false }).limit(50),
  ])

  const error = sessions.error ?? evidence.error ?? checks.error ?? proposals.error
  if (error) return NextResponse.json({ error: error.message }, { status: 503 })

  const body = mcpEnvelope({
    owner: auth.token.user_email,
    sessions: sessions.data ?? [], evidence: evidence.data ?? [], checks: checks.data ?? [], proposals: proposals.data ?? [],
    human_approval_required: true,
  }, { source_files: ["supabase/migrations/20260805000001_dev_loop_pipeline.sql", "scripts/deploy-gate.ts"], registry_version: {}, confidence: "high" })
  return NextResponse.json(body, { headers: mcpCorsHeaders() })
}
