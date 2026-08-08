/**
 * POST /api/admin/ide/operations/incidents/[incidentId]/status — real,
 * owner-driven Incident status transition (owner, 2026-08-08, Software
 * Factory Step 12). Never automatic — RESOLVED requires a real
 * verificationEvidenceArtifactId (no auto-close).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { changeIncidentStatus, IncidentError, type IncidentStatus } from "../../../../_lib/incidentRuntime";

const VALID_STATUSES: IncidentStatus[] = ["OPEN", "INVESTIGATING", "MITIGATION_PLANNED", "RECOVERY_PENDING", "VERIFICATION_PENDING", "RESOLVED", "FALSE_POSITIVE", "UNKNOWN"];

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "INVALID_REQUEST" || code === "INVALID_TRANSITION") return 400;
  return 500;
}

export async function POST(req: Request, { params }: { params: Promise<{ incidentId: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const { incidentId } = await params;
  let body: { status?: unknown; note?: unknown; verificationEvidenceArtifactId?: unknown };
  try { body = await req.json(); } catch { return errorResponse("INVALID_REQUEST", "invalid JSON body", 400); }
  if (typeof body.status !== "string" || !VALID_STATUSES.includes(body.status as IncidentStatus)) return errorResponse("INVALID_REQUEST", `status must be one of ${VALID_STATUSES.join(", ")}`, 400);
  if (typeof body.note !== "string" || body.note.trim().length === 0) return errorResponse("INVALID_REQUEST", "a real note is required for every status change", 400);
  if (body.verificationEvidenceArtifactId !== undefined && typeof body.verificationEvidenceArtifactId !== "string") return errorResponse("INVALID_REQUEST", "verificationEvidenceArtifactId must be a string", 400);

  try {
    const incident = changeIncidentStatus(incidentId, auth.id, auth.email, body.status as IncidentStatus, body.note, body.verificationEvidenceArtifactId as string | undefined);
    return NextResponse.json({ ok: true, incident });
  } catch (e) {
    const code = e instanceof IncidentError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
