/**
 * POST /api/admin/ide/operations/monitoring/collect — real Signal
 * collection (owner, 2026-08-08, Software Factory Step 12). Observe-only
 * — never mutates production. Accepts an optional real signalType; omit
 * to collect all real, registered Signal Types.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { collectSignal, collectAllSignals, MonitoringError } from "../../../_lib/monitoringRuntime";
import { getSignalTypeDefinition, type SignalType } from "../../../_lib/monitoringRegistry";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: string): number {
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_NOT_OWNED")) return 403;
  if (code === "SIGNAL_TYPE_NOT_REGISTERED" || code === "INVALID_REQUEST") return 400;
  return 500;
}

export async function POST(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  let body: { signalType?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  try {
    if (typeof body.signalType === "string") {
      if (!getSignalTypeDefinition(body.signalType)) return errorResponse("SIGNAL_TYPE_NOT_REGISTERED", `unknown signal type: ${body.signalType}`, 400);
      const signal = await collectSignal(body.signalType as SignalType, auth.id, auth.email);
      return NextResponse.json({ ok: true, signals: [signal] });
    }
    const signals = await collectAllSignals(auth.id, auth.email);
    return NextResponse.json({ ok: true, signals });
  } catch (e) {
    const code = e instanceof MonitoringError ? e.code : "INTERNAL_ERROR";
    return errorResponse(code, e instanceof Error ? e.message : "unexpected error", statusFor(code));
  }
}
