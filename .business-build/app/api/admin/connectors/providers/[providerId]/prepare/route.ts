/**
 * POST /api/admin/connectors/providers/[providerId]/prepare
 *
 * The pre-Connect PREPARE step for one provider: what the system will fill in
 * itself (derived read-only URLs + non-secret defaults), which fields the owner
 * still has to supply (secret field NAMES only), whether this provider needs an
 * Owner decision, and the real evidence behind those answers.
 *
 * Provider-neutral by construction: the provider is looked up in the ONE
 * contract registry (engines/connectors/registry.ts) and nothing here switches
 * on a provider name. Wiring comes from ../../_lib/connectRuntime, so the
 * connector read, this app's origin and the canonical Test call are shared with
 * the create route rather than re-implemented.
 *
 * Read-only: no connector is created, no Test is run, no secret value is read —
 * inspect() and prepareConnect() receive status/enabled/config plus secret FIELD
 * NAMES only. A provider without a contract answers NOT_SUPPORTED honestly
 * instead of inventing a field set.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { findContract } from "@/engines/connectors/registry";
import { getLatestProposal } from "@/engines/integration-gateway/evidence/proposalStore";
import { buildConnectRuntimeDeps } from "../../../_lib/connectRuntime";

type Params = { params: Promise<{ providerId: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { providerId } = await params;

  const contract = findContract(providerId);
  if (!contract) {
    return NextResponse.json(
      {
        ok: false,
        code: "NOT_SUPPORTED",
        contract_implemented: false,
        provider_id: providerId,
        error: "no_connect_contract_for_provider",
      },
      { status: 501 },
    );
  }

  const deps = buildConnectRuntimeDeps();
  const [inspection, preparation, approval] = await Promise.all([
    contract.inspect(deps),
    contract.prepareConnect(deps),
    // Real approval state from the one proposal store — the UI shows what the
    // server will actually enforce on Connect, never a local guess.
    getLatestProposal(supabaseAdmin(), contract.providerId, "connect.approval.requested"),
  ]);

  return NextResponse.json({
    ok: true,
    contract_implemented: true,
    provider_id: contract.providerId,
    auth_modes: contract.authModes,
    approval_requirement: contract.approvalRequirement,
    approval_state: {
      required: contract.approvalRequirement === "OWNER_REQUIRED",
      approved: approval?.status === "approved",
      pending: approval?.status === "pending",
      proposal_id: approval?.id ?? null,
      status: approval?.status ?? null,
      decided_by: approval?.decided_by ?? null,
      decided_at: approval?.decided_at ?? null,
    },
    capability_metadata: contract.capabilityMetadata(),
    inspection,
    preparation,
  });
}
