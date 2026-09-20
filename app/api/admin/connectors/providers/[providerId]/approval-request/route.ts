/**
 * POST /api/admin/connectors/providers/[providerId]/approval-request
 *
 * The Connect Core Owner-approval REQUEST step: records a real proposal for
 * connecting one provider, on the SAME Integration Gateway Propose Channel every
 * other proposal already uses (bus publish -> integration_gateway_events +
 * integration_gateway_proposals), decided through the SAME route
 * (POST /api/gateway/proposals/[id]/decide). No second approval store, no second
 * decide path.
 *
 * Idempotent by design: an already-approved or already-pending request returns
 * that proposal instead of piling up duplicates. Providers whose contract does
 * not require approval answer approval_not_required — the request step exists
 * only where the contract says it must.
 *
 * Evidence attached to the request is the same real, secret-free evidence the
 * PREPARE step shows (workspace artifacts + connector state), so the Owner
 * decides on facts, not on a prompt.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { findContract } from "@/engines/connectors/registry";
import { publish } from "@/engines/integration-gateway/event-bus/bus";
import { getLatestProposal } from "@/engines/integration-gateway/evidence/proposalStore";
import type { GatewayEvent, GatewayProvider } from "@/engines/integration-gateway/contracts/event";
import { buildDetectDeps } from "../../../_lib/connectRuntime";

type Params = { params: Promise<{ providerId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { providerId } = await params;

  const contract = findContract(providerId);
  if (!contract) {
    return NextResponse.json({ ok: false, code: "NOT_SUPPORTED", error: "no_connect_contract_for_provider" }, { status: 501 });
  }
  if (contract.approvalRequirement !== "OWNER_REQUIRED") {
    return NextResponse.json({ ok: false, code: "APPROVAL_NOT_REQUIRED", provider_id: contract.providerId }, { status: 400 });
  }

  const db = supabaseAdmin();
  const existing = await getLatestProposal(db, contract.providerId, "connect.approval.requested");
  if (existing?.status === "approved") {
    return NextResponse.json({ ok: true, already_approved: true, proposal_id: existing.id });
  }
  if (existing?.status === "pending") {
    return NextResponse.json({ ok: true, already_pending: true, proposal_id: existing.id });
  }

  const event: GatewayEvent = {
    event_id: `EVT-connect-approval-${contract.providerId}-${Date.now()}`,
    // The Gateway provider allow-list lives in contracts/event.ts and, for the
    // proposal row, in the integration_gateway_proposals CHECK constraint — a
    // provider that has a contract but is absent from both is rejected by the
    // database rather than silently accepted.
    provider: contract.providerId as GatewayProvider,
    capability: "connect.approval.requested",
    channel: "propose",
    action: "propose",
    session_id: null,
    change_id: null,
    evidence: {
      provider_id: contract.providerId,
      requested_by: auth.email,
      approval_requirement: contract.approvalRequirement,
      artifacts: contract.detect(buildDetectDeps()).slice(0, 8),
    },
    requested_effect: `connect provider '${contract.providerId}' through the lifecycle`,
    requires_owner_approval: true,
    occurred_at: new Date().toISOString(),
  };

  const result = await publish(db, event);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.reason }, { status: 500 });

  return NextResponse.json({ ok: true, requested: true, event_id: event.event_id });
}
