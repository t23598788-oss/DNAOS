/**
 * POST /api/admin/provider-settings/[providerId]/request-approval — the Owner
 * Approval REQUEST step for destructive credential mutations (rotate /
 * disconnect on production), mirrored 1:1 from the Connect approval-request
 * route: publish ONE GatewayEvent on the SAME propose channel →
 * integration_gateway_proposals → decided through the SAME
 * POST /api/gateway/proposals/[id]/decide route (approve-only branch for
 * connector.* capabilities — no command executes on approval; the executing
 * route re-checks the approved row itself).
 *
 * Idempotent: already-approved / already-pending returns that proposal.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { publish } from "@/engines/integration-gateway/event-bus/bus";
import { getLatestProposal } from "@/engines/integration-gateway/evidence/proposalStore";
import type { GatewayEvent, GatewayProvider } from "@/engines/integration-gateway/contracts/event";
import { loadSettings } from "../../_lib/providerCredentialMeta";

type Params = { params: Promise<{ providerId: string }> };
const KINDS = ["rotate", "disconnect"] as const;
type Kind = (typeof KINDS)[number];

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { providerId } = await params;

  const body = (await req.json().catch(() => ({}))) as { kind?: unknown };
  const kind = body.kind;
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ ok: false, error: "kind must be 'rotate' or 'disconnect'" }, { status: 400 });
  }
  const k = kind as Kind;
  const capability = `connector.${k}.requested`;
  const db = supabaseAdmin();

  try {
    const existing = await getLatestProposal(db, providerId, capability);
    if (existing?.status === "approved") return NextResponse.json({ ok: true, already_approved: true, proposal_id: existing.id });
    if (existing?.status === "pending") return NextResponse.json({ ok: true, already_pending: true, proposal_id: existing.id });

    // Evidence = secret-free metadata snapshot (environment + version), so the
    // Owner decides on facts, never on a prompt — same rule as Connect approval.
    const settings = await loadSettings(db);
    const row = settings.rows.find((r) => r.provider_id === providerId);
    const event: GatewayEvent = {
      event_id: `EVT-connector-${k}-${providerId}-${Date.now()}`,
      // provider must pass the Gateway allow-list + the proposals CHECK
      // constraint — a provider absent from both is rejected by the database.
      provider: providerId as GatewayProvider,
      capability: capability as GatewayEvent["capability"],
      channel: "propose",
      action: "propose",
      session_id: null,
      change_id: null,
      evidence: {
        provider_id: providerId,
        kind: k,
        requested_by: auth.email,
        environment: row?.environment ?? "unknown (treated as production)",
        credential_version: row?.credential_version ?? 0,
        last_rotated_at: row?.last_rotated_at ?? null,
      },
      requested_effect: `${k} connector credential for provider '${providerId}' on ${row?.environment ?? "production"}`,
      requires_owner_approval: true,
      occurred_at: new Date().toISOString(),
    };

    const result = await publish(db, event);
    if (!result.ok) {
      return NextResponse.json({ ok: false, code: "PROPOSAL_REJECTED", error: result.reason }, { status: 502 });
    }
    return NextResponse.json({ ok: true, requested: true, event_id: event.event_id, capability });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[provider-settings] approval request failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
