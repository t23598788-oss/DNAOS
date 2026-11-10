/**
 * Canonical audit writer (Phase D8) — every significant canonical write lands here.
 *
 * Contract: CANONICAL_MODEL_DOCUMENT_TRANSACTION_FINANCE_V1_1.md
 * `audit_logs` is the single audit owner (actor + time + entity + evidence).
 * Actions are the canonical vocabulary:
 *   document.created · document.updated · document.issued · document.voided
 *   payment.allocated · payment.reallocated · debt.event_created
 *   transaction.created · transaction.status_changed
 *   artifact.created
 *
 * The writer is deliberately strict (it throws) so a business write never
 * silently loses its evidence: callers decide whether to abort or to record a
 * failure marker.
 */
import { supabaseAdmin } from "@/services/supabase/queries";

export const CANONICAL_AUDIT_ACTIONS = [
  "document.created",
  "document.updated",
  "document.issued",
  "document.voided",
  "payment.allocated",
  "payment.reallocated",
  "debt.event_created",
  "transaction.created",
  "transaction.status_changed",
  "artifact.created",
  "artifact.failed",
  // D3 deferred work landed (owner 2026-09-24) — money-out side vocabulary,
  // appended additively; no test pins this list (grep-verified)
  "expense.recorded",
  "payable.requested",
  "payable.transitioned",
  // BATCH 40 (owner 2026-10-08) — payment acknowledgement vocabulary,
  // appended additively (same rule as the D3 additions above)
  "receipt.acknowledged",
  // WAVE 2 (2026-10-25) — central price authority. A seller's quote reply is
  // an OFFER (evidence), never a central price change: the two are separate
  // actions so an audit reader can always tell them apart.
  "price.offer_recorded",
  "price.updated",
  "price.created",
  // Layer 3 identity overlay — binding a channel to a partner profile is a
  // canonical write with its own actor/evidence, now that it no longer happens
  // in the provider tier (Connect boundary census T1c).
  "partner.profile_created",
  "partner.bound",
] as const;

export type CanonicalAuditAction = (typeof CANONICAL_AUDIT_ACTIONS)[number];

export interface CanonicalAuditInput {
  action: CanonicalAuditAction;
  entity_type: string;
  entity_id: string;
  actor: string;
  company_id?: string | null;
  field?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  /** free-form evidence: ids of versions/allocations/artifacts that prove the change */
  evidence?: Record<string, unknown> | null;
}

const asText = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
};

export interface CanonicalAuditRecord {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
}

export async function recordCanonicalAudit(input: CanonicalAuditInput): Promise<CanonicalAuditRecord> {
  if (!input.actor || !input.actor.trim()) {
    throw new Error("AUDIT_ACTOR_REQUIRED: every canonical write must carry an actor");
  }
  const { data, error } = await supabaseAdmin()
    .from("audit_logs")
    .insert({
      actor_user_id: null,
      company_id: input.company_id ?? null,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      action: input.action,
      field: input.field ?? null,
      old_value: asText(input.old_value),
      new_value: asText({ value: input.new_value ?? null, evidence: input.evidence ?? null }),
      created_at: new Date().toISOString(),
    })
    .select("id, action, entity_type, entity_id, created_at")
    .single();
  if (error) throw new Error(`บันทึก audit ไม่สำเร็จ (${input.action}): ${error.message}`);
  return data as CanonicalAuditRecord;
}
