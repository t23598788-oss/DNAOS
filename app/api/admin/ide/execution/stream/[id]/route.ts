/**
 * GET /api/admin/ide/execution/stream/[id] — Server-Sent Events stream of a
 * run's real events (owner, 2026-08-05, Phase 4). Replays any buffered
 * history first, then streams live run.stdout/run.stderr/run.completed/etc.
 * events as the real process produces them. No WebSocket infrastructure —
 * a plain Next.js ReadableStream Response, per instruction. Ownership is
 * checked once up front via getRun(); the stream closes itself once the
 * run reaches a terminal status.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { ExecutionError, type ExecutionErrorCode } from "../../../_lib/executionRegistry";
import { getRun, subscribeToRunEvents, type RunEvent } from "../../../_lib/executionRuntime";

export const runtime = "nodejs";

function errorResponse(code: ExecutionErrorCode, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
function statusFor(code: ExecutionErrorCode): number {
  if (code === "RUN_NOT_FOUND") return 404;
  if (code === "RUN_NOT_OWNED") return 403;
  return 500;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  try {
    getRun(id, auth.id); // ownership + existence check before subscribing
  } catch (e) {
    const code = e instanceof ExecutionError ? e.code : "INTERNAL_ERROR";
    const message = e instanceof ExecutionError ? e.message : "unexpected error";
    return errorResponse(code, message, statusFor(code));
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: RunEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        if (isRunTerminal_forEvent(event)) {
          controller.close();
          unsubscribe?.();
        }
      };
      function isRunTerminal_forEvent(event: RunEvent): boolean {
        return event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled" || event.type === "run.timeout" || event.type === "run.output_limited";
      }

      const sub = subscribeToRunEvents(id, send);
      if (!sub) {
        controller.close();
        return;
      }
      unsubscribe = sub.unsubscribe;
      // If the run was already terminal before the client connected, this
      // replay loop's own terminal-event check closes the stream.
      for (const event of sub.replay) send(event);
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
