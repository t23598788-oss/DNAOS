import { NextResponse } from "next/server";
import { runCognitivePipeline } from "@/lib/cognitive/pipeline";

export async function POST(request: Request) {
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
