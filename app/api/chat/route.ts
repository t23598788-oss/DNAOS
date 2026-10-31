import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { runWithDataScope } from "@/core/authority/data-scope-context";
import { resolveSessionDataScope } from "@/engines/authority/session-scope";
import { runCognitivePipeline } from "@/cognitive/pipeline";
import { buildChatResult } from "./_lib/resultContract";
import type { ChatResult } from "./_lib/chatResultTypes";
import {
  completeTrace,
  emitExecutionEvent,
  getTrace,
  startTrace,
  withExecutionContext,
  type ExecutionEvent,
} from "@/core/runtime/trace";
import { randomUUID } from "node:crypto";
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
type ChatPayload = {
  message?: unknown;
  sessionKey?: unknown;
  knownCustomerId?: unknown;
  knownCustomerName?: unknown;
  relationshipId?: unknown;
  documentContext?: {
    document_no?: string | null;
    document_id?: string | null;
    title?: string | null;
  } | null;
}

interface ChatExecutionResult {
  body: Record<string, unknown>;
  status: number;
}

async function executeChat(
  request: Request,
  auth: Extract<Awaited<ReturnType<typeof requireAuth>>, { id: string }>,
  input: ChatPayload,
  onEvent?: (event: ExecutionEvent) => void,
): Promise<ChatExecutionResult> {
  const traceId = randomUUID();
  startTrace(traceId, "[Workspace command redacted]");
  let context: Parameters<typeof withExecutionContext>[0] = {
    traceId,
    actorId: auth.id,
    scopeMode: "none",
    organizationIds: [],
    onEvent,
  };

  try {
    const rawMessage = String(input.message ?? "");
    const scope = await resolveSessionDataScope(auth);
    context = {
      traceId,
      actorId: scope.profileId ?? auth.id,
      scopeMode: scope.mode,
      organizationIds: scope.organizationIds,
      onEvent,
    };

    return await withExecutionContext(context, async () => {
      emitExecutionEvent({
        event: "command.received",
        toolId: "chat.workspace",
        sourceReference: "/api/chat",
        status: "received",
      });

      try {
        const sessionKey = input.sessionKey;
        const knownCustomerId = input.knownCustomerId;
        const knownCustomerName = input.knownCustomerName;
        const relationshipId = input.relationshipId;
        const documentContext = input.documentContext;
        const memorySessionKey = `u:${auth.id}:${sessionKey ? String(sessionKey) : "chat"}`;
        const gatewayContext = {
          ownerId: auth.email,
          sessionId: request.headers.get("x-dna-session") ?? memorySessionKey,
        };

        const payload = await runWithDataScope(scope, async () => {
          const response = await runCognitivePipeline(
            rawMessage,
            null,
            memorySessionKey,
            knownCustomerId ? { id: String(knownCustomerId), name: String(knownCustomerName ?? "") } : null,
            gatewayContext,
            { origin: new URL(request.url).origin, cookie: request.headers.get("cookie"), userId: auth.id },
          );
          let result: ChatResult = (await buildChatResult(request, rawMessage, response)) ?? {
            type: "text",
            text: response.text ?? "",
          };

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
          const deterministicCue = Boolean(
            pipelineResponse.navigate_url ||
              pipelineResponse.open_app ||
              pipelineResponse.external_url ||
              pipelineResponse.window_action ||
              pipelineResponse.screen_vision ||
              pipelineResponse.line_copilot ||
              pipelineResponse.command ||
              pipelineResponse.pulse_node,
          );
          let localAiCommandUsed: string | null = null;
          const bridgeEligible =
            result.type !== "error" &&
            !deterministicCue &&
            (result.type === "text" || result.type === "sections");
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
          if (!deterministicCue && result.type === "text") {
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
          const { navigate_url: navigateUrl, ...rest } = response;
          return {
            ...rest,
            ...(structured ? {} : navigateUrl ? { navigate_url: navigateUrl } : {}),
            text: structured ? "" : ownerTextOverride ?? response.text,
            result,
            trace_id: traceId,
            ...(localAiCommandUsed ? { local_ai_command: localAiCommandUsed } : {}),
          };
        });

        const readerOutcomes = new Map<string, ExecutionEvent>();
        for (const event of getTrace(traceId)?.events ?? []) {
          if (event.event === "reader.completed") readerOutcomes.set(event.toolId, event);
        }
        const failedReader = [...readerOutcomes.values()].find((event) => event.status === "failed");
        const deniedTool = [...(getTrace(traceId)?.events ?? [])]
          .reverse()
          .find((event) => event.event === "tool.selected" && event.status === "denied");
        const readerFailure = failedReader ?? deniedTool;
        let result = payload.result as ChatResult;
        if (result.type !== "error" && readerFailure) {
          result = {
            type: "error",
            code: deniedTool ? "ACCESS_DENIED" : "QUERY_FAILED",
            message: deniedTool
              ? "บัญชีนี้ไม่มีสิทธิ์อ่านข้อมูลที่ร้องขอ"
              : "อ่านข้อมูลจาก Canonical Reader ไม่สำเร็จ",
            sourceReference: readerFailure.sourceReference,
          };
          payload.result = result;
          payload.text = "";
        }
        emitExecutionEvent({
          event: "result.ready",
          toolId: `chat.result.${result.type}`,
          sourceReference:
            result.type === "error" && result.sourceReference
              ? result.sourceReference
              : "app/api/chat/_lib/resultContract.ts#buildChatResult",
          status: result.type === "error" ? "failed" : "ready",
        });
        if (result.type === "error") {
          emitExecutionEvent({
            event: "execution.failed",
            toolId: "chat.workspace",
            sourceReference: "/api/chat",
            status: "failed",
          });
          completeTrace(traceId, "failed");
          const status = result.code === "ACCESS_DENIED" ? 403 : result.code === "INVALID_REQUEST" ? 400 : 502;
          return { body: payload, status };
        }

        emitExecutionEvent({
          event: "execution.completed",
          toolId: "chat.workspace",
          sourceReference: "/api/chat",
          status: "completed",
        });
        completeTrace(traceId, "completed");
        return { body: payload, status: 200 };
      } catch (error) {
        console.error("[chat] pipeline execution failed", {
          traceId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        emitExecutionEvent({
          event: "execution.failed",
          toolId: "chat.workspace",
          sourceReference: "/api/chat",
          status: "failed",
        });
        completeTrace(traceId, "failed");
        return {
          body: {
            sender: "ai",
            type: "text",
            text: "ประมวลผลคำสั่งไม่สำเร็จ โปรดลองอีกครั้ง",
            result: {
              type: "error",
              code: "QUERY_FAILED",
              message: "ประมวลผลคำสั่งไม่สำเร็จ โปรดลองอีกครั้ง",
              sourceReference: "/api/chat",
            },
            trace_id: traceId,
          },
          status: 500,
        };
      }
    });
  } catch (error) {
    console.error("[chat] request scope resolution failed", {
      traceId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return withExecutionContext(context, () => {
      emitExecutionEvent({
        event: "execution.failed",
        toolId: "chat.workspace",
        sourceReference: "/api/chat",
        status: "failed",
      });
      completeTrace(traceId, "failed");
      return {
        body: {
          sender: "ai",
          type: "text",
          text: "ตรวจสอบสิทธิ์หรือขอบเขตข้อมูลไม่สำเร็จ",
          result: {
            type: "error",
            code: "QUERY_FAILED",
            message: "ตรวจสอบสิทธิ์หรือขอบเขตข้อมูลไม่สำเร็จ",
            sourceReference: "/api/chat",
          },
          trace_id: traceId,
        },
        status: 500,
      };
    });
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  let input: ChatPayload;
  try {
    input = (await request.json()) as ChatPayload;
  } catch {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  }

  if (!request.headers.get("accept")?.includes("text/event-stream")) {
    const result = await executeChat(request, auth, input);
    return NextResponse.json(result.body, { status: result.status });
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (cancelled) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      void executeChat(request, auth, input, (event) => send("execution", event)).then((result) => {
        send("result", { ...result.body, http_status: result.status });
        if (!cancelled) controller.close();
      });
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
