/**
 * หน้าที่: the STANDALONE PROCESS entrypoint for the Owner Conversation
 * Layer (Owner UNLOCK, 2026-09-06, TASK: ISOLATE_OWNER_CONVERSATION_RUNTIME
 * PHASE 2A/2C). Launched as its own OS process — `node --loader tsx
 * control/conversation-runtime/main.ts` (or `tsx` directly) — never
 * `require`'d or `import`'ed into `transport/owner-command-http/server.ts`
 * or any other execution-capable process. That is the actual isolation:
 * a shared import graph would still share one OS process, one memory
 * space, one set of open file descriptors and ambient OS permissions.
 *
 * IMPORTS, and why each is the only kind allowed:
 * - `../owner-command-semantics/contract.ts` — the conversation logic
 *   itself.
 * - `../owner-command-semantics/read-only-registry-view.ts` — strips write
 *   authority off the registry store BEFORE it is ever handed to
 *   `translateOwnerMessage`/`resolveOwnerCommandSemantics`.
 * - `../../software/registry-database/contract.ts` — `createPersistentFileStore`
 *   (read side only used) + `ReadOnlyRegistryStore`/`RegistryStore` types.
 * - `./protocol.ts` — the IPC message shapes.
 * - Node builtins `node:readline`, `node:process` for line-delimited
 *   stdin/stdout framing. NOT `node:child_process` — this file, like every
 *   other file in this capability folder except
 *   `../owner-command-semantics/language-processor/fixed-runner.ts`, has no
 *   process-launch authority of its own. The one process this whole layer
 *   may still launch goes through that fixed, narrow adapter — see its
 *   header.
 *
 * NEVER imported here, structurally (grep this file — the import list
 * above is the complete list): `execution/run`, `control/command-router`,
 * `control/agent-gateway`, any `control/computer-use-*`, any
 * `credentials/*`, any deploy/registration-mutation module.
 *
 * FAIL CLOSED (PHASE 2F): a malformed request, a missing/degraded
 * conversation-read-model, or an unhandled exception all become a
 * `DENIED`/`UNRESOLVED` `ConversationResult` written to stdout — never a
 * silent fallback to any execution-capable module (there is none imported
 * here to fall back to) and never a process crash mid-request.
 */

declare const require: any;
declare const process: { stdin: unknown; stdout: { write(chunk: string): void }; argv: readonly string[]; exit(code: number): void };

import { resolveOwnerCommandSemantics, translateOwnerMessage, publishLanguageStage } from "../owner-command-semantics/contract";
import type { SemanticOutcome, StructuredOwnerContext } from "../owner-command-semantics/contract";
import { toReadOnlyRegistryView } from "../owner-command-semantics/read-only-registry-view";
import { createPersistentFileStore } from "../../software/registry-database/contract";
import { isPublished } from "../conversation-read-model/contract";
import { routeSubjectAwareQuery, type StageEmitter } from "./subject-router";
import { finalizeConversationResult } from "./owner-ask-response";
import {
  FORBIDDEN_REQUEST_FIELDS,
  isWellFormedConversationRequest,
  type ConversationRequest,
  type ConversationResult,
  type StructuredIntent,
} from "./protocol";

const readline = require("node:readline");

// Constructed ONCE, at process start — never per request, never re-derived
// from a caller-supplied object. `toReadOnlyRegistryView` (see its own
// header) returns a frozen object that literally does not carry
// `writeApprovedCandidate`/`appendRegistrationEvent`/`addRelationship`/etc,
// regardless of what the underlying adapter implements.
const registryStore = toReadOnlyRegistryView(createPersistentFileStore());

/** PHASE 2F: a projection that has never been published is treated as UNAVAILABLE, not as "nothing registered" — `../conversation-read-model/contract.ts#isPublished` checks the snapshot files exist, since its `read*` functions return `[]` for both "empty" and "never published". */
function conversationReadModelAvailable(): boolean {
  return isPublished();
}

/**
 * EMIT_FACT_OWNER_RUNTIME_EVENTS: the ONE place a `LanguageStageNotification`
 * becomes a real, correlatable event — reuses the exact mechanism the
 * generic semantic pipeline already uses (`publishLanguageStage` +
 * newline-delimited stdout streaming), so fact-owner-dispatch events and
 * generic-pipeline events share the same schema, the same `trace_id`
 * correlation, and the same transport. Never a second event system.
 */
function emitStage(requestId: string, traceId: string, notification: Parameters<typeof publishLanguageStage>[1], source: string): void {
  const event = publishLanguageStage(requestId, notification, source, traceId);
  if (typeof require !== "undefined" && require.main === module) {
    process.stdout.write(`${JSON.stringify({ message_type: "stage", request_id: requestId, event })}\n`);
  }
}

function buildIntent(context: StructuredOwnerContext): StructuredIntent {
  const capability = context.resolved_capabilities[0]?.resolved_id ?? undefined;
  const target = context.resolved_resources[0]?.resolved_id ?? context.resolved_history?.resolved_id ?? undefined;
  const unresolvedReason = context.unresolved_refs.length > 0
    ? context.unresolved_refs.map((ref) => `${ref.kind}:"${ref.mention}"`).join("; ")
    : undefined;
  return {
    request_id: context.command_id,
    intent: context.intent,
    capability_id: capability,
    target_id: target,
    parameters: context.parameters as Readonly<Record<string, unknown>> | undefined,
    unresolved_reason: unresolvedReason,
  };
}

function buildAnswer(context: StructuredOwnerContext): string {
  if (context.read_only_knowledge) return context.read_only_knowledge.owner_reply_th;
  return `resolved_state=${context.resolved_state}; intent=${context.intent}`;
}

export function handleConversationRequest(request: ConversationRequest): ConversationResult {
  if (!conversationReadModelAvailable()) {
    return { request_id: request.request_id, trace_id: request.trace_id, answer: null, intent: null, status: "DENIED", evidence_refs: ["conversation-read-model unavailable — fail closed, no execution-source fallback"], semantic_outcome: null };
  }

  const emit: StageEmitter = (notification) => emitStage(request.request_id, request.trace_id, notification, "control/conversation-runtime/subject-router.ts");

  // HARDEN_SUBJECT_AWARE_OWNER_QUERY_ROUTING (Owner UNLOCK 2026-09-06),
  // WORK_STATUS folded in by REMOVE_HUMAN_PHRASE_HARDCODING_FROM_SELF_KNOWLEDGE_ROUTING
  // (Owner UNLOCK 2026-09-07) — "งานล่าสุดถึงไหน" used to be special-cased
  // here via its own phrase-regex list BEFORE the subject router ever ran;
  // it is now just one of the canonical SELF question types the router's
  // language-processor-backed classifier can resolve to, same as every
  // other self-knowledge question.
  // ONE router, subject resolved first against every real registry
  // (self-explanation projection's node labels, the one known metric name,
  // self-knowledge's fixed "self" pseudo-subject), THEN question type asked
  // of whichever reader owns that subject's facts. Replaces three
  // independently-ordered per-reader keyword checks — that ordering is
  // exactly how "target-resolution มาจากไหน" once misrouted to
  // self-knowledge (COMPLETE_SELF_EXPLANATION_PROJECTION_OWNER_PROOF).
  // Returns `null` only when no real subject/self-reference was found at
  // all — this call never invents or guesses one, and emits nothing when
  // it returns null (EMIT_FACT_OWNER_RUNTIME_EVENTS PHASE 3: no fake event
  // for a path that didn't run).
  const subjectAwareResult = routeSubjectAwareQuery(request.request_id, request.trace_id, request.text, request.owner_identity, emit);
  if (subjectAwareResult) {
    const finalized = finalizeConversationResult(subjectAwareResult, {
      subject_resolved: true,
      fact_owner_selected: subjectAwareResult.intent?.intent !== "UNRESOLVED_LANGUAGE",
      facts_nonempty: Boolean(subjectAwareResult.answer && !subjectAwareResult.answer.startsWith("ไม่สามารถตีความ") && !subjectAwareResult.answer.startsWith("ไม่ทราบ")),
      assembly_succeeded: Boolean(subjectAwareResult.answer && subjectAwareResult.answer.trim().length > 0),
      parser_ok: (subjectAwareResult.semantic_outcome as { ok?: boolean } | null)?.ok ?? null,
    });
    if (finalized.final_semantic_state === "ANSWERABLE_READ_ONLY") {
      emit({ stage: "HUMAN_PRESENTATION_STARTED", status: "STARTED", detail: "formatting answer for Owner", subject_id: subjectAwareResult.intent?.parameters?.subject as string | undefined ?? null });
      emit({ stage: "HUMAN_PRESENTATION_COMPLETED", status: "COMPLETED", detail: finalized.answer ?? "" });
      emit({ stage: "OWNER_ANSWER_READY", status: "COMPLETED", detail: "ANSWERABLE_READ_ONLY", decision: "ANSWERABLE_READ_ONLY" });
    } else {
      emit({
        stage: "OWNER_ANSWER_READY",
        status: "COMPLETED",
        detail: finalized.final_semantic_state ?? "UNRESOLVED",
        decision: finalized.final_semantic_state ?? "UNRESOLVED",
        blocker_kind: finalized.final_semantic_state === "SEMANTIC_UNRESOLVED" ? "SEMANTIC_UNRESOLVED" : finalized.final_semantic_state,
        blocker_detail: finalized.final_semantic_state === "SEMANTIC_UNRESOLVED" ? "no verified facts after presentation" : null,
      });
    }
    return finalized;
  }

  let semantic: SemanticOutcome;
  try {
    const onStage = (notification: Parameters<NonNullable<typeof publishLanguageStage>>[1]) => {
      const event = publishLanguageStage(request.request_id, notification, "core:control/owner-command-semantics/resolver.ts", request.trace_id);
      process.stdout.write(`${JSON.stringify({ message_type: "stage", request_id: request.request_id, event })}\n`);
    };
    semantic = request.persist === false
      ? resolveOwnerCommandSemantics(request.request_id, request.text, request.owner_identity, { registryStore, persist: false, onStage })
      : translateOwnerMessage(request.request_id, request.text, request.owner_identity, { registryStore, onStage }).semantic;
  } catch (error) {
    return { request_id: request.request_id, trace_id: request.trace_id, answer: null, intent: null, status: "DENIED", evidence_refs: [`unhandled exception during resolution: ${error instanceof Error ? error.message : String(error)}`], semantic_outcome: null };
  }

  if (!semantic.ok) {
    return finalizeConversationResult({
      request_id: request.request_id,
      trace_id: request.trace_id,
      answer: null,
      intent: null,
      status: "UNRESOLVED",
      evidence_refs: semantic.reasons,
      semantic_outcome: semantic,
    }, { parser_ok: false, facts_nonempty: false, assembly_succeeded: false, subject_resolved: false });
  }

  const context = semantic.context;
  const intent = buildIntent(context);
  const status = context.read_only_knowledge || context.resolved_state === "RESOLVED" ? "ANSWERED" : "UNRESOLVED";
  return finalizeConversationResult({
    request_id: request.request_id,
    trace_id: request.trace_id,
    answer: buildAnswer(context),
    intent,
    status,
    evidence_refs: context.evidence_refs,
    semantic_outcome: semantic,
  }, { parser_ok: true, subject_resolved: status === "ANSWERED", facts_nonempty: Boolean(context.read_only_knowledge), assembly_succeeded: Boolean(context.read_only_knowledge || context.resolved_state === "RESOLVED") });
}

function rejectMalformed(rawLine: string): ConversationResult {
  let requestId = "unknown";
  try {
    const parsed = JSON.parse(rawLine);
    if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).request_id === "string") {
      requestId = (parsed as Record<string, unknown>).request_id as string;
    }
  } catch { /* not even valid JSON — requestId stays "unknown" */ }
  return { request_id: requestId, trace_id: "unknown", answer: null, intent: null, status: "DENIED", evidence_refs: [`malformed request — rejected before processing (forbidden fields checked: ${FORBIDDEN_REQUEST_FIELDS.join(", ")})`], semantic_outcome: null };
}

function main(): void {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      process.stdout.write(`${JSON.stringify(rejectMalformed(trimmed))}\n`);
      return;
    }
    if (!isWellFormedConversationRequest(parsed)) {
      process.stdout.write(`${JSON.stringify(rejectMalformed(trimmed))}\n`);
      return;
    }
    const result = handleConversationRequest(parsed);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  });
}

const isEntrypoint = typeof require !== "undefined" && require.main === module;
if (isEntrypoint) {
  main();
}
