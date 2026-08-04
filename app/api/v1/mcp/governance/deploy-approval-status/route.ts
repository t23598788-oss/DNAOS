import { NextResponse } from "next/server"
import { mcpEnvelope, mcpCorsHeaders } from "../../_lib/envelope"
import { authenticate } from "../_lib/auth"

export async function GET(req: Request) {
  const auth = await authenticate(req, "read")
  if (!auth.ok) return auth.response
  const [pending, failed] = await Promise.all([
    auth.db.from("dev_loop_registry_proposals").select("id, session_id, path, status, proposed_at").eq("status", "pending").order("proposed_at", { ascending: false }).limit(100),
    auth.db.from("dev_loop_check_results").select("id, session_id, path, result, reason, checked_at").eq("result", "fail").order("checked_at", { ascending: false }).limit(100),
  ])
  const error = pending.error ?? failed.error
  if (error) return NextResponse.json({ error: error.message }, { status: 503 })
  const body = mcpEnvelope({
    approval_status: pending.data?.length || failed.data?.length ? "blocked" : "no_blocking_evidence",
    pending_proposals: pending.data ?? [], failed_impact_checks: failed.data ?? [],
    human_owner_approval_required: true, deploy_executed: false,
  }, { source_files: ["scripts/deploy-gate.ts", "supabase/migrations/20260805000001_dev_loop_pipeline.sql"], registry_version: {}, confidence: "medium" })
  return NextResponse.json(body, { headers: mcpCorsHeaders() })
}
