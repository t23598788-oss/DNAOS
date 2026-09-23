/**
 * GET /api/admin/system-config — single real aggregation for the System
 * Configuration Center (owner, 2026-08-05). Every field cites its real
 * source; items with no real backend today are reported as
 * not_integrated: true with the honest reason, never faked as connected.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { AUTOMATION_COMMANDS, AUTOMATION_NOT_IMPLEMENTED } from "@/engines/integration-gateway/automationCommands";
import { listConnectors, redactConnectors } from "@/gateway/connectors";
import { loadAiAdapterRegistry, describeAiAdapterFor } from "@/services/ai/resolver";
import type { AiCapability } from "@/services/ai/adapterContract";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const connectors = redactConnectors(await listConnectors());

  const db = supabaseAdmin();
  const { data: healthEvent } = await db
    .from("integration_gateway_events")
    .select("evidence, occurred_at")
    .eq("provider", "supabase")
    .eq("capability", "database.health.observed")
    .order("occurred_at", { ascending: false })
    .limit(1);

  // A10: this route no longer keeps its own provider list. Readiness comes from
  // the one AI adapter registry, through the same resolver every AI caller uses —
  // a provider that has no executable adapter reports itself as not integrated,
  // and no provider name is hardcoded here.
  const adapterRegistry = loadAiAdapterRegistry();
  const aiModels = adapterRegistry.adapters.map((declaration) => {
    const capabilities = declaration.capabilities_by_runtime?.next ?? declaration.capabilities;
    const probe = capabilities[0]
      ? describeAiAdapterFor(capabilities[0] as AiCapability, { adapterConstraint: { adapterId: declaration.id, reason: "owner-config" } })
      : null;
    const integrated = declaration.enabled && declaration.execution.status === "gateway-adapter" && probe?.adapterId === declaration.id;
    return {
      id: declaration.id,
      name: declaration.display_name ?? declaration.provider,
      integrated,
      configured: Boolean(probe?.available),
      env_var: declaration.configuration.required_any_env[0] ?? null,
      reason: integrated ? undefined : (probe?.reason ?? "no executable adapter in services/ai/adapters.ts"),
    };
  });

  return NextResponse.json({
    connectors: connectors ?? [],
    automation: {
      available: Object.keys(AUTOMATION_COMMANDS),
      not_implemented: AUTOMATION_NOT_IMPLEMENTED,
    },
    ai_models: aiModels,
    infrastructure: {
      database: healthEvent?.[0]?.evidence ?? null,
      database_checked_at: healthEvent?.[0]?.occurred_at ?? null,
      storage: { integrated: false, reason: "No storage-tier status endpoint" },
      gpu: { integrated: false, reason: "No GPU/RunPod adapter in codebase" },
      servers: { integrated: false, reason: "No server-fleet status source (Vercel-hosted, serverless)" },
    },
    business: { integrated: false, reason: "No unified pricing/billing/subscription config screen yet — pricing logic exists in engines/pricing.ts, engines/quote-price.ts but is not exposed as editable settings" },
    domains: { integrated: false, reason: "No domain/DNS/SSL management code in this codebase" },
  });
}
