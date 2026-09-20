/**
 * Integration Gateway — Proposal Store (owner, 2026-08-05).
 * The one place that writes/reads integration_gateway_proposals — mirrors
 * evidence/store.ts's role for the Observe Channel, but for Propose.
 * event-bus/bus.ts calls recordProposal() after a channel='propose' event
 * passes the policy gate; app/api/gateway/proposals/[id]/decide/route.ts
 * calls decideProposal() — the only place status ever changes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GatewayEvent } from "../contracts/event";

export interface GatewayProposal {
  id: string;
  event_id: string;
  provider: string;
  capability: string;
  requested_effect: string;
  evidence: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "failed";
  proposed_at: string;
  decided_by: string | null;
  decided_at: string | null;
  run_result: Record<string, unknown> | null;
}

export async function recordProposal(db: SupabaseClient, event: GatewayEvent): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.from("integration_gateway_proposals").upsert(
    {
      event_id: event.event_id,
      provider: event.provider,
      capability: event.capability,
      requested_effect: event.requested_effect,
      evidence: event.evidence,
    },
    { onConflict: "event_id" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function listPendingProposals(db: SupabaseClient, limit = 50): Promise<GatewayProposal[]> {
  const { data } = await db
    .from("integration_gateway_proposals")
    .select("*")
    .order("proposed_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as GatewayProposal[];
}

/**
 * Latest proposal for one provider (optionally narrowed to one capability), any
 * status — the real read used by Connect Core's trust boundary: a provider whose
 * contract declares OWNER_REQUIRED approval may only be connected while an
 * approved 'connect.approval.requested' proposal exists. Same table, same
 * decision route, never a second approval store.
 */
export async function getLatestProposal(
  db: SupabaseClient,
  provider: string,
  capability?: string
): Promise<GatewayProposal | null> {
  let query = db
    .from("integration_gateway_proposals")
    .select("*")
    .eq("provider", provider)
    .order("proposed_at", { ascending: false })
    .limit(1);
  if (capability) query = query.eq("capability", capability);
  const { data } = await query;
  return ((data ?? [])[0] as GatewayProposal | undefined) ?? null;
}

export async function decideProposal(
  db: SupabaseClient,
  id: string,
  decision: "approved" | "rejected",
  decidedBy: string,
  runResult?: Record<string, unknown>
): Promise<{ ok: boolean; proposal?: GatewayProposal; error?: string }> {
  const { data, error } = await db
    .from("integration_gateway_proposals")
    .update({
      status: runResult && (runResult as any).exit_code !== 0 && decision === "approved" ? "failed" : decision,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      run_result: runResult ?? null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "proposal not found or already decided" };
  return { ok: true, proposal: data as GatewayProposal };
}
