import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { getRecentTraces, getTrace, traceLineage, replayTrace } from "@/core/runtime/trace";

// GET /api/traces — recent traces จาก Runtime (in-memory)
// GET /api/traces?id=<traceId> — trace เดียว + lineage + replay
// Real, live security fix (TASK-001, DNA-000070): was unauthenticated, leaked
// real runtime execution traces.
export async function GET(req: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const traceId = url.searchParams.get("id");

  if (traceId) {
    const trace = getTrace(traceId);
    if (!trace) {
      return NextResponse.json(
        { error_th: `ไม่พบ trace: ${traceId}` },
        { status: 404 }
      );
    }
    return NextResponse.json({
      trace,
      lineage: traceLineage(traceId),
      replay: replayTrace(traceId),
    });
  }

  const traces = getRecentTraces(50);
  return NextResponse.json({
    traces,
    total: traces.length,
    note_th: traces.length === 0
      ? "ยังไม่มี trace — trace จะปรากฏหลังจากมีการเรียก /api/chat หรือ /api/command"
      : null,
  });
}
