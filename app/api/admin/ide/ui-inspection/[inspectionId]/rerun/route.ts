/**
 * POST /api/admin/ide/ui-inspection/[inspectionId]/rerun — real rerun,
 * owner-only (owner, 2026-08-06, Software Factory Step 6). Replays the
 * SAME real target/viewport/inspectionType parameters the original scan
 * used (recorded in ScanRecord.originalRequest) — never accepts new raw
 * parameters from the client, so a rerun can't be used to smuggle a
 * different, unvalidated target.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getScanRecord, runUiInspectionScan, UiInspectionError } from "../../../_lib/browserInspectionRuntime";
import { startUiInspectionJob, finalizeUiInspectionJob } from "../../../_lib/queueRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "TARGET_REJECTED" || code === "INVALID_VIEWPORT") return 400;
  if (code === "CONCURRENCY_LIMIT") return 429;
  return 500;
}

export async function POST(req: Request, { params }: { params: Promise<{ inspectionId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { inspectionId: scanId } = await params;
  const original = getScanRecord(scanId, auth.id);
  if (!original) return errorResponse("SCAN_NOT_FOUND", "no scan with that id", 404);

  const jobTarget = original.originalRequest.route ?? original.originalRequest.url ?? original.originalRequest.targetType;
  const job = startUiInspectionJob(auth.email, auth.id, jobTarget);
  try {
    const scanResult = await runUiInspectionScan({
      ...original.originalRequest, requestUrl: req.url, actor: auth.email, ownerId: auth.id, jobId: job.jobId,
    });
    const errorCount = scanResult.inspectionRecords.reduce((sum, r) => sum + r.errorCount, 0);
    const findingCount = scanResult.inspectionRecords.reduce((sum, r) => sum + r.findingCount, 0);
    finalizeUiInspectionJob(job.jobId, auth.id, { ok: true, result: `rerun: ${findingCount} finding(s), ${errorCount} error(s)`, error: null });
    return NextResponse.json({
      ok: true, scanId: scanResult.scanId, jobId: job.jobId, targetUrl: scanResult.targetUrl, environment: scanResult.environment,
      viewportsRun: scanResult.viewportsRun, inspectionIds: scanResult.inspectionRecords.map((r) => r.inspectionId),
      manifestArtifactId: scanResult.manifestArtifact.artifactId, findingCount, errorCount,
    });
  } catch (e) {
    const code = e instanceof UiInspectionError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    finalizeUiInspectionJob(job.jobId, auth.id, { ok: false, result: null, error: code });
    return errorResponse(code, message, statusFor(code));
  }
}
