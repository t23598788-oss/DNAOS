/**
 * POST /api/admin/ide/inspection/run — { inspectionType, targetPath, jobId? }
 * (owner, 2026-08-06, Software Factory Step 4). The client can only ever
 * send a registered inspectionType + a target file path — never an
 * executable, raw shell command, cwd, or environment. Ownership comes
 * entirely from the real auth session (auth.id/auth.email), never the
 * request body. targetPath is validated by the same real fs security gate
 * every other /admin/ide route already uses (via inspectionRuntime.ts's
 * real check functions), never trusted as-is.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getInspectionTypeDefinition, type InspectionType } from "../../_lib/inspectionRegistry";
import { createInspection, InspectionError } from "../../_lib/inspectionRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code === "INSPECTION_TYPE_NOT_REGISTERED" || code === "INVALID_TARGET") return 400;
  if (code === "INSPECTION_NOT_OWNED") return 403;
  if (code === "INSPECTION_NOT_FOUND") return 404;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  let body: { inspectionType?: unknown; targetPath?: unknown; jobId?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_TARGET", "invalid JSON body", 400);
  }
  const { inspectionType, targetPath, jobId } = body;
  if (typeof inspectionType !== "string" || inspectionType.length === 0) {
    return errorResponse("INSPECTION_TYPE_NOT_REGISTERED", "inspectionType is required", 400);
  }
  if (typeof targetPath !== "string" || targetPath.length === 0) {
    return errorResponse("INVALID_TARGET", "targetPath is required", 400);
  }
  if (jobId !== undefined && typeof jobId !== "string") {
    return errorResponse("INVALID_TARGET", "jobId must be a string", 400);
  }

  const def = getInspectionTypeDefinition(inspectionType);
  if (!def) {
    return errorResponse("INSPECTION_TYPE_NOT_REGISTERED", `unknown inspection type "${inspectionType}"`, 400);
  }

  try {
    const record = await createInspection(inspectionType as InspectionType, targetPath, auth.email, auth.id, { jobId: (jobId as string) ?? null });
    return NextResponse.json({ ok: true, inspection: record });
  } catch (e) {
    const code = e instanceof InspectionError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof Error ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }
}
