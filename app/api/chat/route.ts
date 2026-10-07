import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { runCognitivePipeline } from "@/cognitive/pipeline";
import { buildChatResult } from "./_lib/resultContract";
import type { ChatResult } from "./_lib/chatResultTypes";

// Real Data Analysis Layer (owner, 2026-07-30): "ai ในเครื่องมันตัวเล็กมาก
// มันไม่สามารถประมวลผลด้วยตัวของมันเองและวิเคราะห์ได้รวดเร็ว...ก่อนที่จะให้
// ai คิด มันผ่านหลายชั้นมาก่อนจะได้คำตอบ ไม่ใช่ ai คิดแล้วตอบ" — the
// deterministic fuel/weather/exchange-rate/date checks that used to live
// here were moved into cognitive/pipeline.ts's answerExternalFact(), which
// runs at the very start of runCognitivePipeline() — so EVERY caller of the
// pipeline (this route, the /ask route, anything future) goes through the
// same one real analysis layer instead of each route re-implementing its
// own checks. This file is intentionally thin now.
export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  try {
    // sessionKey (owner, 2026-07-31 fix): the caller's session key, so
    // cognitive/memory/session.ts keeps each customer/relationship's memory
    // isolated instead of one process-wide singleton — see cognitive/
    // pipeline.ts's runCognitivePipeline for the real incident this fixes.
    // Distinct from contactContext, which is free-text AI-prompt context,
    // not an identifier.
    // knownCustomerId/knownCustomerName (owner, 2026-08-01): "เรื่องการเงิน
    // เอกสารไม่ต้องให้ ai เข้ามา" — when the caller (an Action Bar button)
    // already knows exactly which customer this is, skip AI name-matching
    // for identity entirely (see runCognitiveCore's knownCustomer handling).
    const { message, sessionKey, knownCustomerId, knownCustomerName } = await request.json();
    const rawMessage = String(message ?? "");
    // gatewayContext (owner, step "ui-baseline-workspace-2026-10-08" ข้อ 1):
    // the SAME authenticated session that passed requireAuth(ADMIN_TIER) above —
    // never a client-invented identity. ownerId = auth.email, matching the
    // established convention in app/api/admin/screen-vision/route.ts; sessionId
    // prefers the real session header the workspace shell sends, then the
    // caller's sessionKey (workspace-shell/composer context), then a stable
    // fallback for this one route. Without this, runCognitivePipeline's
    // classifyIntentViaAi()/answerWithAi() both no-op ("ไม่มี AI session context").
    const gatewayContext = {
      ownerId: auth.email,
      sessionId:
        request.headers.get("x-dna-session") ??
        (sessionKey ? String(sessionKey) : "workspace-chat"),
    };
    const response = await runCognitivePipeline(
      rawMessage,
      null,
      sessionKey ?? null,
      knownCustomerId ? { id: String(knownCustomerId), name: String(knownCustomerName ?? "") } : null,
      gatewayContext,
    );
    // RESPONSE CONTRACT (owner 2026-09-25): แนบ result ทุกครั้ง — structured
    // (finance/document/timeline/table) มาจาก canonical reader จึง "แทนที่"
    // ข้อความ LLM (text="") ห้ามให้ LLM แต่งตัวเลข · confirmation/text คงข้อความเดิม
    const result: ChatResult = (await buildChatResult(request, rawMessage, response)) ?? {
      type: "text",
      text: response.text ?? "",
    };
    const structured = ["finance_summary", "document", "timeline", "table", "error"].includes(result.type);
    return NextResponse.json({
      ...response,
      text: structured ? "" : response.text,
      result,
    });
  } catch (error) {
    return NextResponse.json({
      sender: "ai",
      type: "text",
      text: `ผิดพลาด: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
