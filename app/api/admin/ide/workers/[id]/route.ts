/**
 * GET /api/admin/ide/workers/[id] — real, single Worker Adapter detail
 * (owner, 2026-08-08, Software Factory Step 13.6).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getWorkerAdapter } from "../../_lib/workerSelectorRuntime";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  const adapter = getWorkerAdapter(id);
  if (!adapter) return NextResponse.json({ ok: false, code: "ADAPTER_NOT_FOUND", message: `no real Adapter with id "${id}"` }, { status: 404 });
  return NextResponse.json({ ok: true, adapter: { id: adapter.id, type: adapter.type, provider: adapter.provider, capabilities: adapter.capabilities(), availability: adapter.availability(), limitations: adapter.limitations() } });
}
