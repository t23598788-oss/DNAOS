/**
 * GET /api/admin/ide/workers/[id]/health — real, live Worker Adapter
 * health check (owner, 2026-08-08, Software Factory Step 13.6, Section
 * 17). Never infers HEALTHY from configuration presence alone.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getWorkerAdapter } from "../../../_lib/workerSelectorRuntime";
import { createOperationsArtifact } from "../../../_lib/artifactRuntime";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  const adapter = getWorkerAdapter(id);
  if (!adapter) return NextResponse.json({ ok: false, code: "ADAPTER_NOT_FOUND", message: `no real Adapter with id "${id}"` }, { status: 404 });
  const health = await adapter.health();
  const artifact = createOperationsArtifact({ artifactType: "WORKER_HEALTH_REPORT", content: JSON.stringify({ adapterId: id, ...health }), mimeType: "application/json", actor: auth.email, ownerId: auth.id, generatedFrom: id, jobId: null });
  return NextResponse.json({ ok: true, adapterId: id, health, artifactId: artifact.artifactId });
}
