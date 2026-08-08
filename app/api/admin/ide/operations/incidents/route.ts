/**
 * GET /api/admin/ide/operations/incidents — owner-scoped real Incident
 * list (owner, 2026-08-08, Software Factory Step 12).
 * POST — opens a real Incident from a real, already-collected Signal
 * (signalId must reference a real, owned Signal Record). Never opens
 * from a guess.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { listIncidents, openIncidentFromSignal, IncidentError } from "../../_lib/incidentRuntime";
import { getSignal, MonitoringError } from "../../_lib/monitoringRuntime";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "INVALID_REQUEST") return 400;
  return 500;
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, incidents: listIncidents(auth.id) });
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: { signalId?: unknown };
  try { body = await req.json(); } catch { return errorResponse("INVALID_REQUEST", "invalid JSON body", 400); }
  if (typeof body.signalId !== "string") return errorResponse("INVALID_REQUEST", "signalId is required — an Incident may only be opened from a real, already-collected Signal", 400);

  try {
    const signal = getSignal(body.signalId, auth.id);
    const incident = await openIncidentFromSignal(signal, auth.id, auth.email);
    return NextResponse.json({ ok: true, incident });
  } catch (e) {
    const code = e instanceof IncidentError ? e.code : e instanceof MonitoringError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
