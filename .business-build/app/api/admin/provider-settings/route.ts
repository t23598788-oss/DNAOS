/**
 * GET /api/admin/provider-settings — the ONE aggregate read the Connections &
 * Credentials board renders from (Settings section and line-customers tab both
 * fetch this exact endpoint — no second settings data source).
 *
 * Composes EXISTING authorities, read-only:
 *  - requirements + settings + recent events → the new metadata tables
 *    (fail open to migrated:false when the migration is not applied here)
 *  - connectors → gateway/connectors.listConnectors, always redacted
 *    (secret keys come back as booleans — no value can leave this route)
 *  - providers → providerRegistryRuntime.listNormalizedProviders (same source
 *    /admin/connectors/providers already uses)
 *  - mutation proposals → proposalStore.listConnectorMutationProposals (the
 *    ONE approval store) for rotate/disconnect approval status per provider
 *  - contracts → engines/connectors registry ids (which providers the system
 *    can actually Connect today)
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { listConnectors, redactConnectors } from "@/gateway/connectors";
import { listConnectContractIds } from "@/engines/connectors/registry";
import { listNormalizedProviders } from "@/app/api/admin/ide/_lib/providerRegistryRuntime";
import { listConnectorMutationProposals } from "@/engines/integration-gateway/evidence/proposalStore";
import { loadRequirements, loadSettings, loadRecentEvents } from "./_lib/providerCredentialMeta";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  try {
    const db = supabaseAdmin();
    const [requirements, settings, events, connectorsRaw, providersRaw, proposals] = await Promise.all([
      loadRequirements(db),
      loadSettings(db),
      loadRecentEvents(db, 50),
      listConnectors(),
      listNormalizedProviders(),
      listConnectorMutationProposals(db, 100),
    ]);

    // Latest proposal per provider+capability for the board's approval badges.
    const mutationProposals: Record<string, { rotate?: unknown; disconnect?: unknown }> = {};
    for (const p of proposals) {
      const slot = (mutationProposals[p.provider] ??= {});
      const kind = p.capability === "connector.rotate.requested" ? "rotate" : "disconnect";
      if (!slot[kind]) slot[kind] = p; // rows arrive newest-first
    }

    const connectors = redactConnectors(connectorsRaw);
    const unowned = connectors
      .filter((c) => !((c.config as Record<string, unknown> | null)?.provider))
      .map((c) => ({ id: c.id, name: c.name, auth_type: c.auth_type }));

    return NextResponse.json({
      ok: true,
      requirements: requirements.rows,
      settings: settings.rows,
      events,
      connectors,
      providers: providersRaw.map((p) => ({ provider_id: p.provider_id, connection_status: p.connection_status })),
      contracts: listConnectContractIds(),
      mutation_proposals: mutationProposals,
      unowned_connectors: unowned,
      migrated: requirements.migrated && settings.migrated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[provider-settings] aggregate read failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
