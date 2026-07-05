import { NextResponse } from "next/server";
import { runCognitivePipeline } from "@/lib/cognitive/pipeline";
import { getDisplayState, setDisplayState, type DisplayState } from "@/lib/supabase/state-cache";

type PipelineResult = Awaited<ReturnType<typeof runCognitivePipeline>>;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let state: DisplayState;

    if (body.userCommand) {
      const result = await runCognitivePipeline(body.userCommand);
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
