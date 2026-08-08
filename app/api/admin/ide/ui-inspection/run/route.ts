/**
 * POST /api/admin/ide/ui-inspection/run — { targetType, route?, url?,
 * viewportProfileIds, inspectionTypes?, waitUntil?, timeoutMs? } (owner,
 * 2026-08-06, Software Factory Step 6: UI Inspection Capability). Never
 * accepts a raw executable, Chrome argument, or arbitrary filesystem path
 * — targetType/route/url go straight through targetPolicy.ts's real
 * validateTarget() (SSRF/private-network/protocol gate) before the
 * Browser Inspection Runtime ever opens a page. Ownership from the real
 * auth session only.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { runUiInspectionScan, UiInspectionError } from "../../_lib/browserInspectionRuntime";
import { getViewportProfile } from "../../_lib/viewportRegistry";
import { getInspectionTypeDefinition, type InspectionType } from "../../_lib/inspectionRegistry";
import { startUiInspectionJob, finalizeUiInspectionJob } from "../../_lib/queueRuntime";

const DEFAULT_UI_INSPECTION_TYPES: InspectionType[] = [
  "UI_DOM_STRUCTURE_CHECK", "UI_LAYOUT_CHECK", "UI_OVERFLOW_CHECK", "UI_OVERLAP_CHECK",
  "UI_RESPONSIVE_CHECK", "UI_TEXT_RENDER_CHECK", "UI_COLOR_CONTRAST_CHECK",
  "UI_INTERACTIVE_TARGET_CHECK", "UI_ACCESSIBILITY_CHECK", "UI_RESOURCE_CHECK",
];
const MAX_TIMEOUT_MS = 120_000;
const MAX_VIEWPORTS_PER_SCAN = 6;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "TARGET_REJECTED" || code === "INVALID_VIEWPORT") return 400;
  if (code === "CONCURRENCY_LIMIT") return 429;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  let body: {
    targetType?: unknown; route?: unknown; url?: unknown; viewportProfileIds?: unknown;
    inspectionTypes?: unknown; waitUntil?: unknown; timeoutMs?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_TARGET", "invalid JSON body", 400);
  }

  const { targetType, route, url, viewportProfileIds, inspectionTypes, waitUntil, timeoutMs } = body;
  if (targetType !== "CURRENT_PREVIEW" && targetType !== "DEPLOYED_URL" && targetType !== "REGISTERED_ROUTE") {
    return errorResponse("INVALID_TARGET_TYPE", "targetType must be CURRENT_PREVIEW, DEPLOYED_URL, or REGISTERED_ROUTE", 400);
  }
  if (route !== undefined && typeof route !== "string") return errorResponse("INVALID_TARGET", "route must be a string", 400);
  if (url !== undefined && typeof url !== "string") return errorResponse("INVALID_TARGET", "url must be a string", 400);
  if (!Array.isArray(viewportProfileIds) || viewportProfileIds.length === 0 || !viewportProfileIds.every((v) => typeof v === "string")) {
    return errorResponse("INVALID_VIEWPORT", "viewportProfileIds must be a non-empty array of real viewport profile ids", 400);
  }
  if (viewportProfileIds.length > MAX_VIEWPORTS_PER_SCAN) {
    return errorResponse("INVALID_VIEWPORT", `at most ${MAX_VIEWPORTS_PER_SCAN} viewport profiles per scan`, 400);
  }
  for (const id of viewportProfileIds) {
    if (!getViewportProfile(id)) return errorResponse("INVALID_VIEWPORT", `unknown viewport profile: ${id}`, 400);
  }

  let types: InspectionType[] = DEFAULT_UI_INSPECTION_TYPES;
  if (inspectionTypes !== undefined) {
    if (!Array.isArray(inspectionTypes) || !inspectionTypes.every((t) => typeof t === "string")) {
      return errorResponse("INSPECTION_TYPE_NOT_REGISTERED", "inspectionTypes must be an array of strings", 400);
    }
    for (const t of inspectionTypes) {
      const def = getInspectionTypeDefinition(t);
      if (!def || def.scope !== "URL") return errorResponse("INSPECTION_TYPE_NOT_REGISTERED", `${t} is not a registered UI inspection type`, 400);
    }
    types = inspectionTypes as InspectionType[];
  }

  const resolvedWaitUntil = waitUntil === "load" || waitUntil === "domcontentloaded" || waitUntil === "networkidle" ? waitUntil : "load";
  const resolvedTimeoutMs = typeof timeoutMs === "number" && timeoutMs > 0 ? Math.min(timeoutMs, MAX_TIMEOUT_MS) : 30_000;

  const jobTarget = (route as string) ?? (url as string) ?? targetType;
  const job = startUiInspectionJob(auth.email, auth.id, jobTarget);

  try {
    const scanResult = await runUiInspectionScan({
      targetType, route: (route as string) ?? null, url: (url as string) ?? null, requestUrl: req.url,
      viewportProfileIds: viewportProfileIds as string[], waitUntil: resolvedWaitUntil, timeoutMs: resolvedTimeoutMs,
      inspectionTypes: types, actor: auth.email, ownerId: auth.id, jobId: job.jobId,
    });
    const errorCount = scanResult.inspectionRecords.reduce((sum, r) => sum + r.errorCount, 0);
    const findingCount = scanResult.inspectionRecords.reduce((sum, r) => sum + r.findingCount, 0);
    finalizeUiInspectionJob(job.jobId, auth.id, { ok: true, result: `${findingCount} finding(s), ${errorCount} error(s) across ${scanResult.viewportsRun.length} viewport(s)`, error: null });
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
