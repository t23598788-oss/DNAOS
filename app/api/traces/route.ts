import { NextResponse } from "next/server";
import { getRecentTraces, getTrace, traceLineage, replayTrace } from "@/lib/runtime/trace";

// GET /api/traces — recent traces จาก Runtime (in-memory)
// GET /api/traces?id=<traceId> — trace เดียว + lineage + replay
export async function GET(req: Request) {
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
