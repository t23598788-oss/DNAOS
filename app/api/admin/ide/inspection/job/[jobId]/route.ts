/**
 * GET /api/admin/ide/inspection/job/[jobId] — real Inspection Records bound
 * to a given SAVE_FILE / RUN_COMMAND jobId, owner-only (owner, 2026-08-06,
 * Software Factory Step 4). Lets the UI show inspection results next to
 * the Job that triggered them, without inventing a second job concept.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listInspectionsForJob, isFindingStale } from "../../../_lib/inspectionRuntime";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { jobId } = await params;
  const records = listInspectionsForJob(jobId, auth.id);
  const withStale = await Promise.all(records.map(async (r) => ({ ...r, stale: await isFindingStale(r) })));
  return NextResponse.json({ ok: true, inspections: withStale });
}
