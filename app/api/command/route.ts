import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { runWithDataScope } from "@/core/authority/data-scope-context";
import { resolveSessionDataScope } from "@/engines/authority/session-scope";
import { runCognitivePipeline } from "@/cognitive/pipeline";
import { getDisplayState, setDisplayState, type DisplayState } from "@/services/supabase/state-cache";

type PipelineResult = Awaited<ReturnType<typeof runCognitivePipeline>>;

// Real, live security fix (TASK-001, registry/CHANGELOG.json DNA-000070): this
// route was completely unauthenticated — any unauthenticated request could
// trigger the real cognitive command pipeline (runCognitivePipeline), which
// can perform real business actions.
//
// STEP 1 (2026-10-25): the previous guard accepted ANY authenticated role,
// including `customer`, while the pipeline dispatches tenant-wide reads
// (partner.list/debt.*). This route is a control surface, so it now requires
// the admin tier AND runs the pipeline inside the caller's verified DataScope.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    let state: DisplayState;

    if (body.userCommand) {
      const scope = await resolveSessionDataScope(auth);
      const result = await runWithDataScope(scope, () => runCognitivePipeline(body.userCommand));
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
