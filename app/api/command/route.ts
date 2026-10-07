import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { runCognitivePipeline } from "@/cognitive/pipeline";
import { getDisplayState, setDisplayState, type DisplayState } from "@/services/supabase/state-cache";

type PipelineResult = Awaited<ReturnType<typeof runCognitivePipeline>>;

// Real, live security fix (TASK-001, registry/CHANGELOG.json DNA-000070): this
// route was completely unauthenticated — any unauthenticated request could
// trigger the real cognitive command pipeline (runCognitivePipeline), which
// can perform real business actions. requireAuth() with no arguments defaults
// to ANY_AUTHENTICATED (any real logged-in role) — the same default the
// function itself declares, not a narrower guess with no evidence behind it.
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    let state: DisplayState;

    if (body.userCommand) {
      // Server-derived, user-scoped memory key (owner 2026-10-08): memory is
      // keyed per authenticated user — never a shared default bucket.
      const result = await runCognitivePipeline(body.userCommand, null, `u:${auth.id}:command`);
      state = toDisplayState(result);
    } else if (body.command) {
      state = { activeView: body.command, data: body.payload || {} };
    } else {
      return NextResponse.json({ success: false, error: "ไม่มี userCommand หรือ command" }, { status: 400 });
    }

    await setDisplayState(state);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
  }
}

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const state = await getDisplayState();
  return NextResponse.json(state);
}

function toDisplayState(result: PipelineResult): DisplayState {
  if ("command" in result && result.command === "CLEAR_SCREEN") {
    return { activeView: "IDLE", data: {} };
  }

  if (result.type === "workspace" && "workspace" in result) {
    return { activeView: "BOARD", data: result as unknown as Record<string, unknown> };
  }

  return { activeView: "TEXT", data: { text: String("text" in result ? result.text : "") } };
}
