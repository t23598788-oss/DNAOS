import { NextRequest, NextResponse } from "next/server";
import { translateWithAI } from "@/lib/ai-bridge-openai";
import { translate as translateLocal } from "@/lib/ai-bridge";

export async function POST(req: NextRequest) {
  try {
    const { text, engine } = await req.json();

    if (!text) {
      return NextResponse.json({ ok: false, error: "ต้องระบุ text" }, { status: 400 });
    }

    // engine = "openai" ใช้ GPT, อื่นๆ ใช้ local keyword match (V4 เดิม)
    const result = engine === "openai"
      ? await translateWithAI(text)
      : translateLocal(text);

    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "internal error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
