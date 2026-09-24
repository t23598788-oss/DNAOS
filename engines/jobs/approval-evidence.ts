/**
 * APPROVAL EVIDENCE NORMALIZER (IntegrPASS 3 / G5) — READ-ONLY.
 *
 * Owner rule: this is an EVIDENCE/INDEX layer, never an approval authority. Each source
 * below stays the authority for its own decision; this module only reads the real rows
 * and re-states them in one shared language. SELECT-only: a missing/negative record can
 * only BLOCK a job, never approve one.
 *
 * Real sources (existing tables — no new approval system):
 *   owner_passkey → owner_auth_audit_log · pending_authorization → pending_authorizations
 *   connector_proposal → integration_gateway_proposals · destructive_action_gate → destructive_action_log
 *   audit_log → audit_logs (approval-shaped actions)
 */
import { supabaseAdmin } from "@/services/supabase/queries";

export type ApprovalSource = "owner_passkey" | "pending_authorization" | "connector_proposal" | "destructive_action_gate" | "audit_log";
export type ApprovalVerificationState = "VERIFIED" | "PENDING" | "REJECTED" | "BLOCKED" | "NOT_FOUND";

export interface NormalizedApprovalEvidence {
  approval_ref: string;
  job_id: string | null;
  source: ApprovalSource;
  actor: string | null;
  authority: string;
  decision: string;
  scope: string | null;
  capability: string | null;
  decided_at: string | null;
  evidence_ref: string;
  verification_state: ApprovalVerificationState;
  authority_note: string;
}

const AUTHORITY_NOTE = "index/evidence only — the source table remains the approval authority; this layer can block a job but never approve one";
const APPROVAL_ACTIONS = ["document.voided", "ADMIN_LOGIN", "approve", "approved", "decided", "rejected", "enabled", "register"];

/**
 * audit_logs has NO `actor` text column — verified against LIVE (2026-09-24):
 * `select=actor` → 400/42703 "column audit_logs.actor does not exist", while
 * `actor_user_id` and `new_value` both answer 200. The canonical writers put
 * the actor INSIDE `new_value` as JSON text: `{ value, evidence: { actor } }`
 * (the exact shape engines/canonical/audit.ts and the canonical payment RPCs
 * write — see supabase/migrations/20260923000001 comment "the actor travels
 * inside the evidence text because the table has no actor text column").
 * SELECT-only parse helper: prefers the dedicated column, falls back to the
 * evidence text, never guesses a value that is not really there.
 */
function actorFromAuditRow(row: { actor_user_id?: string | null; new_value?: string | null }): string | null {
  if (row.actor_user_id) return row.actor_user_id;
  if (!row.new_value) return null;
  try {
    const parsed = JSON.parse(row.new_value) as { evidence?: { actor?: unknown } };
    const actor = parsed?.evidence?.actor;
    return typeof actor === "string" && actor.trim() ? actor : null;
  } catch {
    return null; // new_value ไม่ใช่ JSON ที่ถูกต้อง → คืน null ห้ามเดา
  }
}

export async function resolveApprovalEvidence(input: {
  capability: string;
  approval_ref?: string | null;
  job_id?: string | null;
  limit?: number;
}): Promise<NormalizedApprovalEvidence[]> {
  const db = supabaseAdmin();
  const limit = Math.min(input.limit ?? 20, 50);
  const jobId = input.job_id ?? null;
  const cap = input.capability;
  const out: NormalizedApprovalEvidence[] = [];
  const keep = (ref: string) => !input.approval_ref || input.approval_ref === ref;
  const push = (e: Omit<NormalizedApprovalEvidence, "job_id" | "capability" | "authority_note">) => {
    if (keep(e.approval_ref)) out.push({ ...e, job_id: jobId, capability: cap, authority_note: AUTHORITY_NOTE });
  };

  const { data: authRows } = await db.from("owner_auth_audit_log")
    .select("audit_id, owner_identity_id, device_id, auth_method, event, occurred_at").order("occurred_at", { ascending: false }).limit(limit);
  for (const r of authRows ?? []) {
    push({ approval_ref: `owner_passkey:${r.audit_id}`, source: "owner_passkey", actor: r.owner_identity_id ?? r.device_id ?? null,
      authority: "public.owner_auth_audit_log", decision: String(r.event ?? "unknown"), scope: r.auth_method ?? null,
      decided_at: r.occurred_at ?? null, evidence_ref: `public.owner_auth_audit_log#${r.audit_id}`,
      verification_state: r.occurred_at ? "VERIFIED" : "NOT_FOUND" });
  }

  const { data: pend } = await db.from("pending_authorizations")
    .select("id, status, request_description, claimant_line_user_id, responsible_line_user_id, resolved_at, created_at")
    .order("created_at", { ascending: false }).limit(limit);
  for (const r of pend ?? []) {
    const status = String(r.status ?? "").toLowerCase();
    push({ approval_ref: `pending_authorization:${r.id}`, source: "pending_authorization",
      actor: r.responsible_line_user_id ?? r.claimant_line_user_id ?? null, authority: "public.pending_authorizations",
      decision: status || "unknown", scope: r.request_description ?? null, decided_at: r.resolved_at ?? null,
      evidence_ref: `public.pending_authorizations#${r.id}`,
      verification_state: r.resolved_at && (status.includes("approv") || status.includes("resolved")) ? "VERIFIED" : r.resolved_at ? "REJECTED" : "PENDING" });
  }

  const { data: props } = await db.from("integration_gateway_proposals")
    .select("id, provider, capability, requested_effect, status, decided_by, decided_at, proposed_at")
    .order("proposed_at", { ascending: false }).limit(limit);
  for (const r of props ?? []) {
    const status = String(r.status ?? "").toLowerCase();
    push({ approval_ref: `connector_proposal:${r.id}`, source: "connector_proposal", actor: r.decided_by ?? null,
      authority: "public.integration_gateway_proposals", decision: status || "unknown", scope: r.requested_effect ?? null,
      decided_at: r.decided_at ?? null, evidence_ref: `public.integration_gateway_proposals#${r.id}`,
      verification_state: status === "approved" || status === "executed" ? "VERIFIED" : status === "rejected" ? "REJECTED" : "PENDING" });
  }

  const { data: destruct } = await db.from("destructive_action_log")
    .select("id, operation_id, action, target_path, actor, requested_at, blocked, block_reason, executed, executed_at")
    .order("requested_at", { ascending: false }).limit(limit);
  for (const r of destruct ?? []) {
    push({ approval_ref: `destructive_action_gate:${r.id}`, source: "destructive_action_gate", actor: r.actor ?? null,
      authority: "public.destructive_action_log", decision: r.executed ? "executed" : r.blocked ? "blocked" : "requested",
      scope: `${r.action ?? ""} ${r.target_path ?? ""}`.trim() || null, decided_at: r.executed_at ?? r.requested_at ?? null,
      evidence_ref: `public.destructive_action_log#${r.id}`,
      verification_state: r.executed ? "VERIFIED" : r.blocked ? "BLOCKED" : "PENDING" });
  }

  const { data: audits } = await db.from("audit_logs")
    .select("id, action, entity_type, entity_id, actor_user_id, new_value, created_at").in("action", APPROVAL_ACTIONS)
    .order("created_at", { ascending: false }).limit(limit);
  for (const r of audits ?? []) {
    push({ approval_ref: `audit_log:${r.id}`, source: "audit_log", actor: actorFromAuditRow(r), authority: "public.audit_logs",
      decision: String(r.action ?? "unknown"), scope: r.entity_type ? `${r.entity_type}:${r.entity_id ?? "-"}` : null,
      decided_at: r.created_at ?? null, evidence_ref: `public.audit_logs#${r.id}`,
      verification_state: r.created_at ? "VERIFIED" : "NOT_FOUND" });
  }

  return out;
}

/** True when a job that requires approval has a usable (VERIFIED) evidence record. */
export function hasVerifiedApproval(records: NormalizedApprovalEvidence[], approvalRef?: string | null): boolean {
  return records.some((r) => r.verification_state === "VERIFIED" && (!approvalRef || r.approval_ref === approvalRef));
}

