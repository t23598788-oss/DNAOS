import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { runCognitivePipeline } from "@/cognitive/pipeline";
import { buildChatResult } from "./_lib/resultContract";
import type { ChatResult } from "./_lib/chatResultTypes";
import {
  askOwnerRuntime,
  resolveOwnerRuntimeIdentity,
  resolveOwnerRuntimeInstruction,
  type OwnerRuntimeAnswer,
} from "@/core/owner-runtime/client";
import { translateLocalAiCommand } from "./_lib/localAiBridge";

// ── owner runtime read path (BATCH 12, owner spec) ─────────────────────────
// After the deterministic command/intent layers and the canonical capability
// dispatcher have had their chance, a question the workspace still could not
// answer goes to the infrastructure's owner conversation runtime
// (127.0.0.1:8791). No AI, no command engine, no reader/router is added
// here — this is a fallback call with a fail-closed identity.

/**
 * Map the runtime's answer onto the EXISTING result contract
 * (chatResultTypes ChatResult): structured facts render as fields blocks
 * (BusinessDisplayRenderer), a plain answer stays a text result. Nothing is
 * flattened into a text bubble when the runtime supplied structured fields.
 */
function mapOwnerRuntimeResult(owner: OwnerRuntimeAnswer): ChatResult {
  const facts = owner.facts ?? {};
  const keys = Object.keys(facts);
  if (keys.length > 0) {
    return {
      type: "sections",
      blocks: [
        {
          kind: "fields",
          id: "owner-runtime",
          title: "Owner runtime",
          fields: keys.map((key) => ({
            kind: "field" as const,
            id: `owner-runtime-${key}`,
            label: key,
            value: String(facts[key]),
          })),
        },
      ],
    };
  }
  return { type: "text", text: owner.answer };
}

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
    const { message, sessionKey, knownCustomerId, knownCustomerName, relationshipId, documentContext } = await request.json();
    const rawMessage = String(message ?? "");
    // gatewayContext + memory session (owner 2026-10-08 fix): BOTH are derived
    // server-side from the authenticated user that just passed
    // requireAuth(ADMIN_TIER) — never a client-invented identity, and never a
    // shared bucket: every real user gets `u:<auth.id>:<their own key>`, so two
    // people (or two tabs of different users) can never land in the same
    // cognitive memory (คห้ามใช้ __default__ ร่วมระหว่างผู้ใช้).
    const memorySessionKey = `u:${auth.id}:${sessionKey ? String(sessionKey) : "chat"}`;
    const gatewayContext = {
      ownerId: auth.email,
      sessionId: request.headers.get("x-dna-session") ?? memorySessionKey,
    };
    const response = await runCognitivePipeline(
      rawMessage,
      null,
      memorySessionKey,
      knownCustomerId ? { id: String(knownCustomerId), name: String(knownCustomerName ?? "") } : null,
      gatewayContext,
      // OWNER WORKSPACE AI TOOL INTEGRATION (2026-10-11): transport ให้ Cline
      // (ทำงานบนเครื่องที่มี cline binary — Mac เจ้าของ · ไม่มี binary อย่าง
      // Railway → clineWorker fail-closed null ในไม่กี่ ms พฤติกรรมเดิมเหมือนเดิม)
      { origin: new URL(request.url).origin, cookie: request.headers.get("cookie") },
    );
    // RESPONSE CONTRACT (owner 2026-09-25): แนบ result ทุกครั้ง — structured
    // (finance/document/timeline/table) มาจาก canonical reader จึง "แทนที่"
    // ข้อความ LLM (text="") ห้ามให้ LLM แต่งตัวเลข · confirmation/text คงข้อความเดิม
    let result: ChatResult = (await buildChatResult(request, rawMessage, response)) ?? {
      type: "text",
      text: response.text ?? "",
    };
    // OWNER WORKSPACE AI TOOL INTEGRATION (2026-10-11): structured result จาก
    // Cline (sanitized ใน clineWorker แล้ว) ชนะ text เปล่า — render ด้วย
    // Workspace result contract เดิมทุก type (sections/table/timeline/file/document)
    const pipelineResponse = response as Record<string, unknown>;
    const clineStructured = pipelineResponse.cline_result;
    if (
      pipelineResponse.pulse_node === "module:app/api/chat/_lib/clineWorker" &&
      clineStructured &&
      typeof clineStructured === "object"
    ) {
      result = clineStructured as ChatResult;
    }
    let ownerTextOverride: string | null = null;
    // FALLBACK ORDER (owner spec): deterministic command/intent (inside
    // runCognitivePipeline: client directives, navigation, external facts) →
    // canonical capability (buildChatResult dispatcher above) → owner runtime.
    // A deterministic cue or a structured capability result means the layers
    // above already answered — the runtime is never consulted for those.
    const deterministicCue = Boolean(
      pipelineResponse.navigate_url ||
        pipelineResponse.open_app ||
        pipelineResponse.external_url ||
        pipelineResponse.window_action ||
        pipelineResponse.screen_vision ||
        pipelineResponse.line_copilot ||
        pipelineResponse.command ||
        // OWNER BUSINESS ROUTING FIX (2026-10-11): deterministic business Q&A
        // (เช่น answerCompanyInfoQuestion) แนบ pulse_node มาด้วย — ชั้นนี้ตอบ
        // แล้วจริง ห้ามส่งต่อให้ local AI bridge / owner-runtime เรียก AI อีกชั้น
        pipelineResponse.pulse_node,
    );
    const capabilityAnswered = result.type !== "text" && result.type !== "error";
    // LOCAL AI intent bridge (LOCAL AI RUNTIME mission, 2026-10-11): เมื่อ
    // deterministic layers + canonical capability ยังไม่ตอบ — Local AI (Ollama
    // adapter ของ AI Gateway เดิม, capability intent.classify) แปลภาษาคนเป็น
    // READ command จากรายการคำสั่งเดิม แล้วส่งกลับเข้า buildChatResult path
    // canonical เดิม — AI ไม่เขียน DB ไม่ execute อะไรทั้งสิ้น · fail-closed:
    // แปลไม่ได้/ไม่ configured = null → เดินต่อ owner-runtime เหมือนเดิมทุกประการ
    let localAiCommandUsed: string | null = null;
    // sections = board fallback (ข้อมูล workspace เดิม) ไม่ใช่คำตอบจริงของคำถาม
    // — ปล่อยให้ Local AI แปลและแทนที่ได้ แต่ถ้า AI แปลไม่ได้ sections เดิมคงอยู่
    const bridgeEligible =
      !deterministicCue &&
      (result.type === "text" || result.type === "error" || result.type === "sections");
    if (bridgeEligible) {
      const localCommand = await translateLocalAiCommand(rawMessage, {
        ownerId: auth.id,
        sessionId: memorySessionKey,
      });
      if (localCommand) {
        const aiResult = await buildChatResult(request, rawMessage, response, localCommand);
        if (aiResult && aiResult.type !== "text" && aiResult.type !== "error") {
          result = aiResult;
          localAiCommandUsed = localCommand.action;
        }
      }
    }
    if (!deterministicCue && !(result.type !== "text" && result.type !== "error")) {
      // identity_id comes ONLY from the authenticated session mapping —
      // never hardcoded, never the customer/relationship id (relationshipId
      // travels as its own context param), never a default. No mapping = no
      // call: the runtime is never asked under a guessed identity.
      const identityId = resolveOwnerRuntimeIdentity(auth);
      if (identityId) {
        const owner = await askOwnerRuntime({
          text: resolveOwnerRuntimeInstruction(rawMessage, documentContext),
          identityId,
          relationshipId: relationshipId ? String(relationshipId) : knownCustomerId ? String(knownCustomerId) : null,
          documentContext: documentContext ?? null,
        });
        if (owner) {
          result = mapOwnerRuntimeResult(owner);
          ownerTextOverride = result.type === "text" ? result.text : null;
        }
      }
    }
    const structured = ["finance_summary", "document", "timeline", "table", "error"].includes(result.type);
    // navigate_url vs structured result (owner fix 2026-10-08, found by real
    // browser test): the pipeline sometimes answers with BOTH a navigation cue
    // and a structured read result — the workspace shell pushed the message and
    // then router.push()ed away, unmounting the result the user just asked for.
    // When a structured result is present it OWNS the screen: navigation cues
    // are suppressed. Text-only replies keep their original navigate behavior.
    const { navigate_url: navigateUrl, ...rest } = response;
    return NextResponse.json({
      ...rest,
      ...(structured ? {} : navigateUrl ? { navigate_url: navigateUrl } : {}),
      text: structured ? "" : ownerTextOverride ?? response.text,
      result,
      // LOCAL AI RUNTIME evidence: action ที่ Local AI แปลได้ (null = ไม่ผ่าน bridge)
      ...(localAiCommandUsed ? { local_ai_command: localAiCommandUsed } : {}),
    });
  } catch (error) {
    return NextResponse.json({
      sender: "ai",
      type: "text",
      text: `ผิดพลาด: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
