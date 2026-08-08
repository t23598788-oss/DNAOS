/**
 * GET /api/admin/ide/workers — real Universal Worker Adapter Registry
 * listing (owner, 2026-08-08, Software Factory Step 13.6, Section 20).
 * Never exposes a secret — availability().reason is a real, human
 * string, never a credential value.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { WORKER_ADAPTER_REGISTRY } from "../_lib/workerSelectorRuntime";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const adapters = WORKER_ADAPTER_REGISTRY.map((a) => ({
    id: a.id, type: a.type, provider: a.provider, capabilities: a.capabilities(), availability: a.availability(), limitations: a.limitations(),
  }));
  return NextResponse.json({ ok: true, adapters });
}
