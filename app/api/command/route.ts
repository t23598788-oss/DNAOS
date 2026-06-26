/**
 * DNA OS Command Center API
 *
 * รับ JSON Command หรือ ภาษาไทย → AI แปล → Runtime → Business → Result
 * แสดง Event Log + Trace ID ทุกครั้ง
 */

import { NextRequest, NextResponse } from "next/server";
import { executeCommand, getEventsByTrace, type RuntimeCommand } from "@/lib/runtime/engine";
import { registerBusinessCommands } from "@/lib/v3-engines/business";
import { translate, registerTranslationCommands } from "@/lib/v4-ai/translator";

let initialized = false;

function init() {
  if (initialized) return;
  registerBusinessCommands();
  registerTranslationCommands();
  initialized = true;
}

export async function POST(req: NextRequest) {
  init();

  const body = await req.json();
  const { text, command } = body as { text?: string; command?: RuntimeCommand };

  // Route 1: ภาษาไทย → AI แปล → Runtime
  if (text) {
    const translation = translate(text);

    if (!translation.ok || !translation.command) {
      return NextResponse.json({
        success: false,
        intent: translation.intent,
        raw: text,
        error: "ไม่เข้าใจคำสั่ง",
      });
    }

    const result = await executeCommand(translation.command);
    const events = getEventsByTrace(result.traceId);

    return NextResponse.json({
      success: result.success,
      intent: translation.intent,
      entities: translation.entities,
      raw: text,
      traceId: result.traceId,
      data: result.data,
      error: result.error,
      events,
    });
  }

  // Route 2: JSON Command ตรง → Runtime
  if (command) {
    const result = await executeCommand(command);
    const events = getEventsByTrace(result.traceId);

    return NextResponse.json({
      success: result.success,
      command: result.command,
      traceId: result.traceId,
      data: result.data,
      error: result.error,
      events,
    });
  }

  return NextResponse.json({ success: false, error: "ต้องระบุ text หรือ command" }, { status: 400 });
}
