import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { runCognitivePipeline } from "@/cognitive/pipeline";

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  try {
    const { message } = await request.json();
    const response = await runCognitivePipeline(String(message ?? ""));
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({
      sender: "ai",
      type: "text",
      text: `ผิดพลาด: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
