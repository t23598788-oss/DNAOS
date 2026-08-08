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

  const aiModels = [
    { id: "anthropic", name: "Claude (Anthropic)", integrated: true, configured: !!process.env.ANTHROPIC_API_KEY, env_var: "ANTHROPIC_API_KEY" },
    { id: "ollama", name: "Ollama (Local)", integrated: true, configured: !!process.env.AI_GATEWAY_OLLAMA_URL, env_var: "AI_GATEWAY_OLLAMA_URL" },
    { id: "openai", name: "OpenAI", integrated: false, reason: "No adapter in services/ai/gateway.ts — bridge was removed" },
    { id: "gemini", name: "Gemini", integrated: false, reason: "No adapter in services/ai/gateway.ts" },
    { id: "local", name: "Local Models (other)", integrated: false, reason: "No local-model runner beyond Ollama" },
  ];

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
