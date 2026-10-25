import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAuth } from "@/core/auth/requireAuth";
import { ORG_CONTEXT_COOKIE, sanitizeOrgCookie } from "@/core/auth/orgContext";
import { isCompanyInScope } from "@/core/auth/orgScope";
import { fetchOrganizationName, resolveVerifiedScope } from "@/services/supabase/tenantAuthority";
import { supabaseAdmin } from "@/services/supabase/queries";
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
import type { AiProvenance } from "@/services/ai/gateway";
import type { LayerTrace } from "./_lib/resultContract";
import { enforceChatDirectivePolicy } from "@/core/auth/surfacePolicy";

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

    // STEP 1 — VERIFIED IDENTITY / DATA SCOPE. Read the org the user already
    // selected (httpOnly cookie validated against org_members) and resolve the
    // company ownership server-side. No body/header value can grant scope.
    const orgCookie = sanitizeOrgCookie((await cookies()).get(ORG_CONTEXT_COOKIE)?.value ?? null);
    const scopeResult = await resolveVerifiedScope(supabaseAdmin(), { auth, organizationId: orgCookie });
    const scope = scopeResult.ok ? scopeResult.scope : null;
    const requestedCustomerId = knownCustomerId ? String(knownCustomerId) : null;
    const requestedRelationshipId = relationshipId ? String(relationshipId) : null;
    if (requestedCustomerId && (!scope || !isCompanyInScope(scope, requestedCustomerId))) {
      return NextResponse.json(
        { ok: false, code: "RESOURCE_NOT_OWNED", error: "ลูกค้าที่ระบุไม่ได้อยู่ใน organization scope ที่ตรวจสอบแล้ว" },
        { status: 403 },
      );
    }
    if (requestedRelationshipId && (!scope || !isCompanyInScope(scope, requestedRelationshipId))) {
      return NextResponse.json(
        { ok: false, code: "RESOURCE_NOT_OWNED", error: "relationship ที่ระบุไม่ได้อยู่ใน organization scope ที่ตรวจสอบแล้ว" },
        { status: 403 },
      );
    }
    // gatewayContext + memory session (owner 2026-10-08 fix): BOTH are derived
    // server-side from the authenticated user that just passed
    // requireAuth(ADMIN_TIER) — never a client-invented identity, and never a
    // shared bucket: every real user gets `u:<auth.id>:<their own key>`, so two
    // people (or two tabs of different users) can never land in the same
    // cognitive memory (คห้ามใช้ __default__ ร่วมระหว่างผู้ใช้).
    // Scope the memory namespace by verified organization as well as user: the
    // same human switching orgs must not carry goals/entities across tenants.
    const memorySessionKey = `u:${auth.id}:${scope ? `org:${scope.organizationId}:` : ""}${sessionKey ? String(sessionKey) : "chat"}`;
    const organizationName = scope
      ? await fetchOrganizationName(supabaseAdmin(), scope.organizationId)
      : null;
    const gatewayContext = {
      ownerId: auth.id,
      sessionId: memorySessionKey,
      scope,
      organizationName,
    };
    // raw pipeline result — ยังไม่ผ่าน ADMIN_CHAT surface gate
    const cognitiveResponse = await runCognitivePipeline(
      rawMessage,
      null,
      memorySessionKey,
      requestedCustomerId ? { id: requestedCustomerId, name: String(knownCustomerName ?? "") } : null,
      gatewayContext,
      // OWNER WORKSPACE AI TOOL INTEGRATION (2026-10-11): transport ให้ Cline
      // (ทำงานบนเครื่องที่มี cline binary — Mac เจ้าของ · ไม่มี binary อย่าง
      // Railway → clineWorker fail-closed null ในไม่กี่ ms พฤติกรรมเดิมเหมือนเดิม
      // DNA-000218: ไม่มี local binary → task queue ไป Railway cline-worker (ai_tasks)
      { origin: new URL(request.url).origin, cookie: request.headers.get("cookie"), userId: auth.id },
    );
    // SURFACE POLICY — ADMIN_CHAT (owner directive 2026-10-18): จุดบังคับเดียว
    // ที่ครอบทุกเส้นทาง output ของ pipeline (regex/AI classify/board ทุกเชื้อ)
    // — ตัด directive ชุด DENY (screen.navigate/window.switch/route.push/
    // browser.open/desktop.control/jarvis.screen_control) ออกก่อนตอบ แล้ว
    // ให้ traffic ล่างทั้งหมด (deterministicCue/bridge/owner-runtime) ตัดสินใจ
    // บน directive ที่ผ่าน policy เท่านั้น · ALLOW/CONDITIONAL ไม่ถูกแตะ
    // (CONDITIONAL ยังต้องผ่าน flow ยืนยันเดิมตามเคย)
    const chatPolicyGate = enforceChatDirectivePolicy(
      cognitiveResponse as unknown as Record<string, unknown>,
    );
    const response = chatPolicyGate.response;
    const chatPolicyDenied = chatPolicyGate.denied;
    // RESPONSE CONTRACT (owner 2026-09-25): แนบ result ทุกครั้ง — structured
    // (finance/document/timeline/table) มาจาก canonical reader จึง "แทนที่"
    // ข้อความ LLM (text="") ห้ามให้ LLM แต่งตัวเลข · confirmation/text คงข้อความเดิม
    let result: ChatResult = (await buildChatResult(request, rawMessage, response, undefined, undefined, scope)) ?? {
      type: "text",
      text: typeof response.text === "string" ? response.text : "",
    };
    // OWNER WORKSPACE AI TOOL INTEGRATION (2026-10-11): structured result จาก
    // Cline (sanitized ใน clineWorker แล้ว) ชนะ text เปล่า — render ด้วย
    // Workspace result contract เดิมทุก type (sections/table/timeline/file/document)
    const pipelineResponse = response as Record<string, unknown>;
    // AI CONVERSATION PERFORMANCE (2026-10-18): pipeline แปลคำสั่งจบภายในข้อ
    // ความแล้ว (marker local_ai_scan="done") — route ห้ามเรียกตัวแปลเดิมซ้ำ
    // (เดิมเรียก intent.classify ครั้งที่ 3 ต่อข้อความโดยไม่จำเป็น) · command
    // ที่สแกนจับได้ยังวิ่ง buildChatResult → dispatcher สิทธิ์เดิมเท่านั้น
    const pipelineScanDone = pipelineResponse.local_ai_scan === "done";
    const pipelineCommand =
      pipelineScanDone && pipelineResponse.local_ai_command && typeof pipelineResponse.local_ai_command === "object"
        ? (pipelineResponse.local_ai_command as { action: string; payload: Record<string, unknown> })
        : null;
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
      chatPolicyDenied.length ||
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
    // LOCAL AI BUSINESS COMMAND PATH (owner, 2026-10-17 ข้อ 1): AI ตีความคำสั่ง
    // ธุรกิจได้เมื่อ Structured Intent ยังไม่สมบูรณ์ — เช่น "ยอดหนี้ของบริษัท X"
    // ตรง finance regex แต่ intent เดิมไม่มีชิ่อที่ขอบริษัท (mock answer รวม) ->
    // ให้ Local AI แปลได้ (debt.current ของบริษัทเจาะจง) · deterministic commands
    // ที่ทำงานถูกต้องอยู่ (navigate/external/window/line/pulse) ไม่ถูกแตะทุกประการ
    const structuredIntentIncomplete =
      result.type === "finance_summary" &&
      /บริษัท|หจก|บจก|ห้างหุ้นส่วน/.test(rawMessage);
    // sections = board fallback (ข้อมูล workspace เดิม) ไม่ใช่คำตอบจริงของคำถาม
    // — ปล่อยให้ Local AI แปลและแทนที่ได้ แต่ถ้า AI แปลไม่ได้ sections เดิมคงอยู่
    const bridgeEligible =
      !deterministicCue &&
      !pipelineScanDone &&
      (result.type === "text" || result.type === "error" || result.type === "sections" || structuredIntentIncomplete);
    // หลักฐานแต่ละชั้น (owner ข้อ 5): INPUT → AI → TOOL → DISPATCHER →
    // DATABASE → RESULT → WORKSPACE — ค่าจริงจากเส้นทางที่กำลังรันเท่านั้น
    const trace: LayerTrace = {
      input: {
        message: rawMessage.slice(0, 400),
        session_key: memorySessionKey,
        user: auth.id,
        organization_id: scope?.organizationId ?? null,
      },
    };
    if (pipelineCommand) {
      // command มาจาก scan ครั้งเดียวใน pipeline — ขนสาย AI layer เดิมให้ trace
      // แล้ววิ่ง buildChatResult เดิม (dispatcher สิทธิ์เดิม) ไม่มีสิ่งใหม่
      if (trace) {
        const p = (pipelineResponse.local_ai_provenance ?? null) as AiProvenance | null;
        trace.ai = {
          status: String(pipelineResponse.local_ai_status ?? "AI_OK"),
          request_id: p?.requestId ?? null,
          error: (pipelineResponse.local_ai_error as string | null) ?? null,
          command: pipelineCommand.action,
          payload: pipelineCommand.payload ?? null,
          provider: p?.provider ?? null,
          capability: p?.capability ?? null,
          evidenceId: p?.evidenceId ?? null,
          occurredAt: p?.occurredAt ?? null,
        };
      }
      const aiResult = await buildChatResult(request, rawMessage, response, pipelineCommand, trace, scope);
      if (aiResult && aiResult.type !== "text" && aiResult.type !== "error") {
        result = aiResult;
        localAiCommandUsed = pipelineCommand.action;
      }
    } else if (bridgeEligible) {
      const bridgeOutcome = await translateLocalAiCommand(rawMessage, {
        ownerId: auth.id,
        sessionId: memorySessionKey,
      });
      if (trace) {
        trace.ai = {
          status: bridgeOutcome.status,
          request_id: bridgeOutcome.provenance?.requestId ?? null,
          error: bridgeOutcome.error,
          command: bridgeOutcome.command?.action ?? null,
          payload: bridgeOutcome.command?.payload ?? null,
          provider: bridgeOutcome.provenance?.provider ?? null,
          capability: bridgeOutcome.provenance?.capability ?? null,
          evidenceId: bridgeOutcome.provenance?.evidenceId ?? null,
          occurredAt: bridgeOutcome.provenance?.occurredAt ?? null,
        };
      }
      if (bridgeOutcome.command) {
        const aiResult = await buildChatResult(request, rawMessage, response, bridgeOutcome.command, trace, scope);
        if (aiResult && aiResult.type !== "text" && aiResult.type !== "error") {
          result = aiResult;
          localAiCommandUsed = bridgeOutcome.command.action;
        }
      }
    } else if (pipelineScanDone && trace) {
      // scan จบใน pipeline แล้ว (สายสนทนาทั่วไป) — AI layer จริงของสายนี้:
      const p = (pipelineResponse.local_ai_provenance ?? null) as AiProvenance | null;
      trace.ai = {
        status: String(pipelineResponse.local_ai_status ?? "AI_UNRESOLVED"),
        request_id: p?.requestId ?? null,
        error: (pipelineResponse.local_ai_error as string | null) ?? null,
        command: null,
        payload: null,
        provider: p?.provider ?? null,
        capability: p?.capability ?? null,
        evidenceId: p?.evidenceId ?? null,
        occurredAt: p?.occurredAt ?? null,
      };
    } else if (trace) {
      // deterministic/capability layer ตอบก่อนอยู่แล้ว (คู่ในเงีื่อนไขห้ามทำลาย)
      trace.ai = { status: "SKIPPED", reason: "deterministic layer replied first", note: "ห้ามทำลาย deterministic commands ที่ทำงานถูกต้อง" };
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
          relationshipId: requestedRelationshipId ?? requestedCustomerId,
          // documentContext is UI text, never identity. It is withheld when no
          // verified scope exists; the runtime must not receive cross-tenant ids.
          documentContext: scope ? documentContext ?? null : null,
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
      // LOCAL AI BUSINESS COMMAND PATH (owner, 2026-10-17): สถานะ AI layer จริง
      // AI_OK | AI_UNRESOLVED (แปลไม่ได้) | AI_UNAVAILABLE (gateway/provider ล้ม) | SKIPPED
      ...(trace.ai ? { ai_status: String(trace.ai.status) } : {}),
      // TRANSPORT CORRELATION (RAILWAY↔MAC LOCAL AI, 2026-10-17): id เดียวกัน
      // กับ log บน Mac (worker) และ relay runtime — ใช้พิสูจน์ REQUEST_ID_MATCH
      ...((bridgeEligible || pipelineCommand || (pipelineScanDone && trace.ai?.request_id)) && trace.ai?.request_id
        ? { local_ai_request_id: String(trace.ai.request_id) }
        : {}),
      // หลักฐานการทำงานแต่ละชั้น INPUT→AI→TOOL→DISPATCHER→DATABASE→RESULT→WORKSPACE
      ...(Object.keys(trace).length > 1 ? { layers: trace } : {}),
    });
  } catch (error) {
    return NextResponse.json({
      sender: "ai",
      type: "text",
      text: `ผิดพลาด: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
