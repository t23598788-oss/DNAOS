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
import * as railwayBinding from "@/engines/domains/railway-binding";

type Params = { params: Promise<{ slug: string }> };

interface DiscoveredResource {
  kind: string;
  id: string;
  name: string;
  parent_id: string | null;
  children?: DiscoveredResource[];
}

/** Whitelist of providers whose adapters expose real, API-backed resource
 * discovery. Providers not listed here honestly answer NOT_SUPPORTED
 * (manual input stays allowed there per the owner's rules) — no guessing. */
const DISCOVERERS: Record<string, () => Promise<{ ok: true; resources: DiscoveredResource[] } | { ok: false; error: string }>> = {
  railway: async () => {
    const r = await railwayBinding.discoverResources();
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, resources: r.resources as DiscoveredResource[] };
  },
};

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { slug } = await params;

  const connector = await getConnector(supabaseAdmin(), slug);
  if (!connector) return NextResponse.json({ error: "ไม่พบ Connector นี้" }, { status: 404 });

  const discover = DISCOVERERS[connector.slug];
  if (!discover) {
    return NextResponse.json(
      { ok: false, code: "NOT_SUPPORTED", error: `Provider นี้ยังไม่มี resource discovery — กรอก config ด้วยมือได้ตามปกติ (manual input อนุญาตเฉพาะเมื่อ API ค้นไม่ได้จริง)` },
      { status: 501 }
    );
  }

  const result = await discover();
  if (!result.ok) {
    // NotReady errors carry their own clear owner guidance (connectorNotReady)
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, resources: result.resources });
}
