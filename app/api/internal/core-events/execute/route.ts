import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEventFromMessages, type RawMessage } from "@/engines/events/event-builder";
import { ensureExternalPartyIdentity } from "@/engines/connect/identity";
import { invokeAiGateway } from "@/services/ai/gateway";
import { sendMessage as sendKodChatMessage } from "@/engines/integration-gateway/adapters/kodchat";
import { requireProviderConnector } from "@/core/connector-loader";
import { sendLineMessage } from "@/registry/communication";
import { supabaseAdmin } from "@/services/supabase/queries";
import { isCoreEventEnvelope, type CoreEventEnvelope } from "@/supabase/functions/_shared/core-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CapabilityEntry = {
  CapabilityId: string;
  OwnerModule: string;
  ExportName: string;
  Category: string;
  Status: string;
  Mutability: string;
};

type CapabilityRegistryFile = { capabilities?: CapabilityEntry[] };
type ExecutionOutcome = {
  result: unknown;
  provider: string | null;
  model: string | null;
  responseDispatched?: boolean;
};

const EVENT_BUILDER_CAPABILITY = "business.event-builder.buildEventFromMessages";
const MAX_ATTEMPTS = 3;
const PROCESSING_LEASE_MS = 120_000;

function equalSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a[index] ^ b[index];
  return diff === 0;
}

function readCapabilityRegistry(): CapabilityRegistryFile {
  const path = join(process.cwd(), "registry", "capability-registry.json");
  return JSON.parse(readFileSync(path, "utf8")) as CapabilityRegistryFile;
}

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{1,119}$/.test(candidate) ? candidate : "CORE_EXECUTION_FAILED";
}

function resolveCapability(capabilityId: string): CapabilityEntry {
  const entry = readCapabilityRegistry().capabilities?.find((item) => item.CapabilityId === capabilityId);
  if (!entry || entry.Status !== "active") throw new Error("CORE_CAPABILITY_NOT_REGISTERED_OR_INACTIVE");
  if (entry.Category !== "business" || entry.Mutability !== "readOnly") {
    throw new Error("CORE_CAPABILITY_NOT_ALLOWED_FOR_AUTOMATIC_EXECUTION");
  }
  return entry;
}

function parseMessages(value: unknown): RawMessage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error("CORE_EVENT_MESSAGES_INVALID");
  }
  let totalTextBytes = 0;
  const messages = value.map((item): RawMessage => {
    if (!item || typeof item !== "object") throw new Error("CORE_EVENT_MESSAGE_INVALID");
    const message = item as Record<string, unknown>;
    if (typeof message.id !== "string" || typeof message.raw_type !== "string" || typeof message.created_at !== "string") {
      throw new Error("CORE_EVENT_MESSAGE_INVALID");
    }
    if (message.raw_text !== null && typeof message.raw_text !== "string") throw new Error("CORE_EVENT_MESSAGE_INVALID");
    if (typeof message.raw_text === "string" && message.raw_text.length > 12_000) throw new Error("CORE_EVENT_MESSAGE_TOO_LARGE");
    if (typeof message.raw_text === "string") totalTextBytes += new TextEncoder().encode(message.raw_text).byteLength;
    return {
      id: message.id,
      raw_type: message.raw_type,
      created_at: message.created_at,
      raw_text: message.raw_text as string | null,
    };
  });
  if (totalTextBytes > 60 * 1024) throw new Error("CORE_EVENT_MESSAGES_TOO_LARGE");
  return messages;
}

async function executeRegisteredCapability(event: CoreEventEnvelope, capabilityId: string): Promise<ExecutionOutcome> {
  if (capabilityId === "conversation.answer") return executeConversationEvent(event);
  const declaration = resolveCapability(capabilityId);
  // A registry entry is a declaration, not permission to dynamically execute
  // arbitrary exports. Each enabled handler is connected here explicitly.
  if (
    declaration.CapabilityId !== EVENT_BUILDER_CAPABILITY ||
    declaration.OwnerModule !== "engines/events/event-builder.ts" ||
    declaration.ExportName !== "buildEventFromMessages"
  ) {
    throw new Error("CORE_CAPABILITY_HANDLER_NOT_CONNECTED");
  }

  const data = event.data as Record<string, unknown>;
  const actorId = event.actor.id ?? event.tenant_id ?? "core-system";
  const response = await buildEventFromMessages(parseMessages(data.messages), {
    origin: "core-event-executor",
    ownerId: actorId,
    sessionId: event.correlation.parent_event_id ?? event.idempotency_key,
  });
  if (!response.ok) throw new Error(response.error);

  return {
    result: response.event,
    provider: response.provenance.provider,
    model: response.provenance.model ?? null,
  };
}

const INBOUND_REPLY_POLICY = `คุณเป็นผู้ช่วยรับข้อความของ DNA OS ภาษาไทย
ตอบสั้น สุภาพ และยึดเฉพาะข้อมูลในข้อความที่ได้รับ
ห้ามแต่งราคา สต็อกสินค้า การยืนยันคำสั่งซื้อ การชำระเงิน หรือเวลาจัดส่ง
หากผู้ส่งขอทำธุรกรรม ให้รับเรื่องและถามข้อมูลที่จำเป็น โดยบอกชัดว่ายังไม่ได้ยืนยันคำสั่งซื้อ
อย่าเปิดเผยข้อมูลของผู้ใช้หรือบริษัทอื่น`;

async function executeConversationEvent(event: CoreEventEnvelope): Promise<ExecutionOutcome> {
  const data = event.data as Record<string, unknown>;
  const provider = event.source;
  let externalSubjectId = typeof data.sender_id === "string" ? data.sender_id : event.actor.id;
  let conversationId = typeof data.conversation_id === "string" ? data.conversation_id : "";
  let messageText = typeof data.message_text === "string" ? data.message_text : "";

  if (provider === "line" && isRecord(data.line_event)) {
    const lineEvent = data.line_event;
    const source = isRecord(lineEvent.source) ? lineEvent.source : null;
    const message = isRecord(lineEvent.message) ? lineEvent.message : null;
    // A LINE group/room id identifies the conversation, never the person.
    // Only the provider's userId may be used for party identity or direct send.
    externalSubjectId = typeof source?.userId === "string" ? source.userId : "";
    messageText = typeof message?.text === "string" ? message.text : messageText;
    if (!conversationId) {
      conversationId = typeof source?.groupId === "string" ? source.groupId
        : typeof source?.roomId === "string" ? source.roomId
          : externalSubjectId;
    }
  }
  if (!externalSubjectId || !conversationId || !messageText.trim() || messageText.length > 12_000) {
    throw new Error("CORE_MESSAGE_FIELDS_INVALID");
  }
  if (provider !== "kodchat" && provider !== "line") throw new Error("CORE_MESSAGE_PROVIDER_NOT_SUPPORTED");

  // Resolve/create the stable person identity before intent or reply logic.
  // This links only this provider subject; cross-provider merges need proof.
  const identity = await ensureExternalPartyIdentity(supabaseAdmin(), {
    provider,
    externalSubjectId,
  });
  if (!identity.ok) throw new Error(identity.error);

  const response = await invokeAiGateway({
    origin: `core-event:${provider}`,
    ownerId: identity.partyId,
    sessionId: conversationId,
    capability: "conversation.answer",
    effect: "draft",
    systemPrompt: INBOUND_REPLY_POLICY,
    prompt: messageText.trim(),
    maxTokens: 350,
  });
  if (!response.ok || !response.output?.trim()) throw new Error("CORE_CONVERSATION_AI_FAILED");
  const replyText = response.output.trim().slice(0, 1900);

  if (provider === "kodchat") {
    const connector = await requireProviderConnector(supabaseAdmin(), "kodchat", "core-events.conversation.answer");
    const sent = await sendKodChatMessage(
      { roomId: conversationId },
      replyText,
      { apiKey: typeof connector.secret.api_key === "string" ? connector.secret.api_key : undefined },
      {
        apiBaseUrl: String(connector.config.base_url ?? "https://kobchat.com/api/bot/v1"),
        sendMessagePath: String(connector.config.send_message_path ?? "/messages"),
      },
    );
    if (sent.status !== "success") throw new Error(`CORE_OUTBOUND_${sent.error_code ?? "FAILED"}`);
  } else {
    const sent = await sendLineMessage(supabaseAdmin(), externalSubjectId, [{ type: "text", text: replyText }]);
    if (!sent.success) throw new Error("CORE_OUTBOUND_LINE_FAILED");
  }

  // Keep message text and generated reply transient; store delivery metadata only.
  return {
    result: { party_id: identity.partyId, response_sent: true, response_length: replyText.length },
    provider: response.provenance.provider,
    model: response.provenance.model ?? null,
    responseDispatched: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resultEvent(event: CoreEventEnvelope, status: "succeeded" | "failed", data: Record<string, unknown>): CoreEventEnvelope {
  const now = new Date().toISOString();
  return {
    event_id: `core-result:${event.idempotency_key}`,
    idempotency_key: `core-result:${event.idempotency_key}`,
    schema_version: "1.0.0",
    event_type: status === "succeeded" ? "core.execution.completed" : "core.execution.failed",
    source: "dna-os-core",
    source_event_id: event.event_id,
    tenant_id: event.tenant_id,
    actor: { type: "system", id: null },
    correlation: { ...event.correlation, parent_event_id: event.event_id },
    occurred_at: now,
    recorded_at: now,
    data: {
      original_event_id: event.event_id,
      idempotency_key: event.idempotency_key,
      status,
      ...data,
    },
  };
}

async function signalGateway(event: CoreEventEnvelope, status: "succeeded" | "failed", data: Record<string, unknown>): Promise<void> {
  const url = process.env.CORE_EVENT_RESULT_INGEST_URL;
  const secret = process.env.CORE_EVENT_RESULT_INGEST_SECRET;
  if (!url || !secret) throw new Error("CORE_EVENT_RESULT_INGEST_NOT_CONFIGURED");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-core-event-result-secret": secret },
    body: JSON.stringify({ event: resultEvent(event, status, data) }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`CORE_EVENT_RESULT_INGEST_HTTP_${response.status}`);
}

async function deliverExistingResult(event: CoreEventEnvelope, row: Record<string, unknown>): Promise<Response> {
  const status = row.status === "succeeded" ? "succeeded" : "failed";
  if (row.capability_id === "conversation.answer") {
    // A replay must not send the same answer a second time.
    return Response.json({ accepted: true, duplicate: true, status }, { status: 200 });
  }
  await signalGateway(event, status, {
    capability_id: row.capability_id,
    result: row.result ?? null,
    provider: row.provider ?? null,
    model: row.model ?? null,
    error_code: row.error_code ?? null,
  });
  return Response.json({ accepted: true, duplicate: true, status }, { status: 200 });
}

async function claimEvent(event: CoreEventEnvelope, capabilityId: string): Promise<{ row: Record<string, unknown>; duplicate: boolean }> {
  const db = supabaseAdmin();
  const initial = {
    event_id: event.event_id,
    idempotency_key: event.idempotency_key,
    source: event.source,
    event_type: event.event_type,
    capability_id: capabilityId,
    tenant_id: event.tenant_id,
    actor_type: event.actor.type,
    actor_id: event.actor.id,
    status: "processing",
    attempt_count: 1,
    lease_until: new Date(Date.now() + PROCESSING_LEASE_MS).toISOString(),
  };
  const inserted = await db.from("core_event_results").insert(initial).select("*").maybeSingle();
  if (!inserted.error && inserted.data) return { row: inserted.data, duplicate: false };
  if (inserted.error?.code !== "23505") throw new Error(`CORE_RESULT_INSERT_FAILED:${inserted.error?.code ?? "unknown"}`);

  const prior = await db.from("core_event_results").select("*").eq("idempotency_key", event.idempotency_key).maybeSingle();
  if (prior.error || !prior.data) throw new Error("CORE_RESULT_DUPLICATE_LOOKUP_FAILED");
  if (prior.data.status === "succeeded" || (prior.data.status === "failed" && prior.data.attempt_count >= MAX_ATTEMPTS)) {
    return { row: prior.data, duplicate: true };
  }
  if (prior.data.status === "processing") {
    const leaseUntil = typeof prior.data.lease_until === "string" ? Date.parse(prior.data.lease_until) : 0;
    if (leaseUntil > Date.now()) throw new Error("CORE_EVENT_ALREADY_PROCESSING");
    if (Number(prior.data.attempt_count) >= MAX_ATTEMPTS) {
      const expired = await db.from("core_event_results")
        .update({ status: "failed", error_code: "CORE_PROCESSING_LEASE_EXPIRED", lease_until: null, processed_at: new Date().toISOString() })
        .eq("idempotency_key", event.idempotency_key)
        .eq("status", "processing")
        .select("*")
        .maybeSingle();
      if (expired.error || !expired.data) throw new Error("CORE_EVENT_ALREADY_PROCESSING");
      return { row: expired.data, duplicate: true };
    }
    const reclaimedLease = await db.from("core_event_results")
      .update({ status: "processing", attempt_count: Number(prior.data.attempt_count) + 1, lease_until: new Date(Date.now() + PROCESSING_LEASE_MS).toISOString() })
      .eq("idempotency_key", event.idempotency_key)
      .eq("status", "processing")
      .lt("lease_until", new Date().toISOString())
      .select("*")
      .maybeSingle();
    if (reclaimedLease.error) throw new Error("CORE_EVENT_RECLAIM_FAILED");
    if (!reclaimedLease.data) throw new Error("CORE_EVENT_ALREADY_PROCESSING");
    return { row: reclaimedLease.data, duplicate: false };
  }

  const reclaimed = await db.from("core_event_results")
    .update({ status: "processing", attempt_count: Number(prior.data.attempt_count) + 1, lease_until: new Date(Date.now() + PROCESSING_LEASE_MS).toISOString(), error_code: null, processed_at: null })
    .eq("idempotency_key", event.idempotency_key)
    .eq("status", "failed")
    .lt("attempt_count", MAX_ATTEMPTS)
    .select("*")
    .maybeSingle();
  if (reclaimed.error) throw new Error("CORE_EVENT_RECLAIM_FAILED");
  if (!reclaimed.data) throw new Error("CORE_EVENT_ALREADY_PROCESSING");
  return { row: reclaimed.data, duplicate: false };
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CORE_QUEUE_DISPATCH_SECRET;
  const supplied = request.headers.get("x-core-queue-dispatch-secret") ?? "";
  if (!expected || !equalSecret(supplied, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let event: unknown;
  try {
    event = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isCoreEventEnvelope(event)) return Response.json({ error: "invalid_core_event" }, { status: 400 });

  const isConversation = event.event_type === "message.received" &&
    (event.source === "kodchat" || event.source === "line");
  const capabilityId = typeof event.data.capability_id === "string"
    ? event.data.capability_id
    : isConversation ? "conversation.answer" : "";
  if (!capabilityId) return Response.json({ error: "capability_id_required" }, { status: 400 });

  let claim: { row: Record<string, unknown>; duplicate: boolean };
  try {
    claim = await claimEvent(event, capabilityId);
    if (claim.duplicate) return await deliverExistingResult(event, claim.row);
  } catch (error) {
    const message = error instanceof Error ? error.message : "CORE_EVENT_CLAIM_FAILED";
    return Response.json({ error: message }, { status: message === "CORE_EVENT_ALREADY_PROCESSING" ? 409 : 503 });
  }

  let outcome: ExecutionOutcome;
  try {
    outcome = await executeRegisteredCapability(event, capabilityId);
    const saved = await supabaseAdmin().from("core_event_results")
      .update({ status: "succeeded", result: outcome.result, provider: outcome.provider, model: outcome.model, error_code: null, lease_until: null, processed_at: new Date().toISOString() })
      .eq("idempotency_key", event.idempotency_key)
      .eq("status", "processing")
      .select("id")
      .maybeSingle();
    if (saved.error || !saved.data) throw new Error("CORE_RESULT_PERSIST_FAILED");
  } catch (error) {
    const message = safeErrorCode(error);
    const terminal = Number(claim.row.attempt_count) >= MAX_ATTEMPTS ||
      message.startsWith("CORE_CAPABILITY_") || message.startsWith("CORE_EVENT_");
    const failed = await supabaseAdmin().from("core_event_results")
      .update({ status: "failed", error_code: message, lease_until: null, processed_at: new Date().toISOString() })
      .eq("idempotency_key", event.idempotency_key)
      .eq("status", "processing")
      .select("id")
      .maybeSingle();
    if (failed.error || !failed.data) return Response.json({ error: "core_result_state_persist_failed" }, { status: 503 });
    if (!terminal) return Response.json({ error: message }, { status: 503 });

    if (capabilityId === "conversation.answer") return Response.json({ accepted: true, status: "failed" }, { status: 200 });
    try {
      await signalGateway(event, "failed", { capability_id: capabilityId, error_code: message });
      return Response.json({ accepted: true, status: "failed" }, { status: 200 });
    } catch {
      return Response.json({ error: "core_result_signal_unavailable" }, { status: 503 });
    }
  }

  if (outcome.responseDispatched) {
    return Response.json({ accepted: true, status: "succeeded" }, { status: 200 });
  }

  try {
    await signalGateway(event, "succeeded", {
      capability_id: capabilityId,
      result: outcome.result,
      provider: outcome.provider,
      model: outcome.model,
    });
    return Response.json({ accepted: true, status: "succeeded" }, { status: 200 });
  } catch {
    // The result is already durable. Ask Queue to retry the delivery; a retry
    // finds the completed row and re-emits the same idempotent result event.
    return Response.json({ error: "core_result_signal_unavailable" }, { status: 503 });
  }
}
