/**
 * POST /api/admin/connectors/discover/[slug] — Resource Discovery for the
 * Connector Owner Surface (owner principle: "Human ไม่ใช่ Integration
 * Layer"). The owner selects from what the system discovers — never types
 * Project/Service/Environment IDs copied from an external dashboard.
 *
 * Reuses the existing canonical path end-to-end; creates no second system:
 *   requireAuth(ADMIN_TIER)               — core/auth/requireAuth.ts (session/identity)
 *   registry/permissions.json ADMIN_TIER  — owner authorization tier
 *   core/connector-loader.ts getConnector — connector resolution by slug (the exact
 *                                           read path every adapter already uses)
 *   provider adapter's own discovery fn   — credential resolution stays inside the adapter
 *                                           (getConnectedConnector), never in this route
 *   normalized resource list response     — no token/secret in any field, redaction mirrors
 *                                           redactConnector()'s principle
 *
 * Manual input stays allowed only where discovery is genuinely impossible
 * (documented per-provider in the adapters) — this route never becomes a
 * form for technical ids.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getConnector } from "@/core/connector-loader";
import { supabaseAdmin } from "@/services/supabase/queries";
import { findContract } from "@/engines/connectors/registry";
import { resolveConnectorProvider } from "@/app/api/admin/ide/_lib/providerRegistryRuntime";

type Params = { params: Promise<{ slug: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { slug } = await params;

  const connector = await getConnector(supabaseAdmin(), slug);
  if (!connector) return NextResponse.json({ error: "ไม่พบ Connector นี้" }, { status: 404 });

  // Provider-neutral: the connector's declared provider (config.provider) or its
  // legacy slug identity is looked up in the ONE contract registry — this route
  // never switches on a provider name, and every provider's discovery already
  // exists in its own adapter (engines/connectors/providers/*). Fixes a real
  // pre-existing gap: the previous provider->function map was keyed by the FULL
  // slug, which never matches a real row (gateway/connectors.ts#slugify appends a
  // random 6-hex suffix), so discovery could not run for a normally created row.
  const providerId = resolveConnectorProvider(connector.config as Record<string, unknown>, connector.slug);
  const contract = findContract(providerId);
  if (!contract) {
    return NextResponse.json(
      { ok: false, code: "NOT_SUPPORTED", error: `Provider นี้ยังไม่มี resource discovery — กรอก config ด้วยมือได้ตามปกติ (manual input อนุญาตเฉพาะเมื่อ API ค้นไม่ได้จริง)` },
      { status: 501 }
    );
  }

  const result = await contract.discoverResources();
  if (!result.ok) {
    if (result.code === "NOT_SUPPORTED") {
      return NextResponse.json({ ok: false, code: result.code, error: result.error }, { status: 501 });
    }
    // NotReady errors carry their own clear owner guidance (connectorNotReady)
    return NextResponse.json({ ok: false, code: result.code, error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, resources: result.resources });
}
