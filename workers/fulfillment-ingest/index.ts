/** Gateway-only fulfillment ingestion Worker; validates adapter identity and delegates reservation and tenant authorization to the existing database RPC. */
import {
  BoundaryError,
  callServiceRpc,
  recordAuthorizationRejection,
  requireGatewayPrincipal,
  rpcReasonCode,
  rpcStatus,
  safeFailureLog,
  type WorkerDatabaseEnv,
  UUID_RE,
} from "../shared/workerIdentity.ts";

interface Env extends WorkerDatabaseEnv {}
interface FulfillmentInput {
  reservation_id: string;
  idempotency_key: string;
  document_reference: string;
  document_created_at: string | null;
  arrived_at: string;
  occurred_at: string;
}
const MAX_BODY_BYTES = 8 * 1024;

function requiredText(value: unknown, name: string, max = 240): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${name}_invalid`);
  return value.trim();
}
function timestamp(value: unknown, name: string, optional = false): string | null {
  if (optional && value == null) return null;
  const raw = requiredText(value, name, 64);
  if (!Number.isFinite(Date.parse(raw))) throw new Error(`${name}_invalid`);
  return new Date(raw).toISOString();
}
function parseFulfillment(value: unknown): FulfillmentInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("json_object_required");
  const body = value as Record<string, unknown>;
  const allowed = new Set(["schema_version", "event_type", "reservation_id", "idempotency_key", "document_reference", "document_created_at", "arrived_at", "occurred_at"]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new Error("unexpected_identity_or_payload_field");
  if (body.schema_version !== "1.0" || body.event_type !== "fulfillment.delivery.confirmed") throw new Error("unsupported_event");
  const reservationId = requiredText(body.reservation_id, "reservation_id", 36);
  if (!UUID_RE.test(reservationId)) throw new Error("reservation_id_invalid");
  const arrivedAt = timestamp(body.arrived_at, "arrived_at")!;
  const occurredAt = timestamp(body.occurred_at, "occurred_at")!;
  const documentCreatedAt = timestamp(body.document_created_at, "document_created_at", true);
  if (Date.parse(occurredAt) < Date.parse(arrivedAt)) throw new Error("timestamp_order_invalid");
  return {
    reservation_id: reservationId,
    idempotency_key: requiredText(body.idempotency_key, "idempotency_key"),
    document_reference: requiredText(body.document_reference, "document_reference"),
    document_created_at: documentCreatedAt,
    arrived_at: arrivedAt,
    occurred_at: occurredAt,
  };
}

async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
  let principal;
  try { principal = requireGatewayPrincipal(request, env, "stock.fulfillment.confirm"); }
  catch (error) {
    const boundary = error instanceof BoundaryError ? error : new BoundaryError("gateway_only", 403);
    safeFailureLog({ requestId: null, adapterId: null, operation: "stock.fulfillment.confirm", reasonCode: boundary.message });
    return Response.json({ ok: false, error: boundary.message }, { status: boundary.status });
  }
  const receivedAt = new Date().toISOString();
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    await recordAuthorizationRejection(env, principal.requestId, principal.adapterId, "stock.fulfillment.confirm", "invalid_identity");
    safeFailureLog({ requestId: principal.requestId, adapterId: principal.adapterId, operation: "stock.fulfillment.confirm", reasonCode: "request_body_too_large" });
    return Response.json({ ok: false, error: "request_body_too_large", request_id: principal.requestId }, { status: 413 });
  }
  let input: FulfillmentInput;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      await recordAuthorizationRejection(env, principal.requestId, principal.adapterId, "stock.fulfillment.confirm", "invalid_identity");
      return Response.json({ ok: false, error: "request_body_too_large", request_id: principal.requestId }, { status: 413 });
    }
    input = parseFulfillment(JSON.parse(raw));
  } catch (error) {
    await recordAuthorizationRejection(env, principal.requestId, principal.adapterId, "stock.fulfillment.confirm", "invalid_identity");
    safeFailureLog({ requestId: principal.requestId, adapterId: principal.adapterId, operation: "stock.fulfillment.confirm", reasonCode: "invalid_payload" });
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_payload", request_id: principal.requestId }, { status: 400 });
  }

  try {
    const { response, data } = await callServiceRpc<Record<string, unknown>>(env, "confirm_stock_fulfillment_for_adapter", {
      p_request_id: principal.requestId,
      p_adapter_id: principal.adapterId,
      p_api_token: principal.apiToken,
      p_reservation_id: input.reservation_id,
      p_idempotency_key: input.idempotency_key,
      p_document_reference: input.document_reference,
      p_document_created_at: input.document_created_at,
      p_arrived_at: input.arrived_at,
      p_occurred_at: input.occurred_at,
      p_received_at: receivedAt,
    });
    if (!response.ok) {
      const row = data as Record<string, unknown> | null;
      const reason = response.status === 403 ? rpcReasonCode(row)
        : response.status === 404 ? "target_not_found"
          : response.status === 409 ? "idempotency_conflict" : "processing_rejected";
      if (response.status === 403) await recordAuthorizationRejection(env, principal.requestId, principal.adapterId, "stock.fulfillment.confirm", reason, input.reservation_id);
      safeFailureLog({ requestId: principal.requestId, adapterId: principal.adapterId, operation: "stock.fulfillment.confirm", reasonCode: reason });
      return Response.json({ ok: false, error: response.status === 403 ? "adapter_not_authorized" : "fulfillment_processing_failed", request_id: principal.requestId }, { status: rpcStatus(String(row?.code ?? "")) });
    }
    return Response.json({ ok: true, request_id: principal.requestId, data }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const boundary = error instanceof BoundaryError ? error : new BoundaryError("fulfillment_processing_failed", 502);
    safeFailureLog({ requestId: principal.requestId, adapterId: principal.adapterId, operation: "stock.fulfillment.confirm", reasonCode: boundary.message });
    return Response.json({ ok: false, error: boundary.message, request_id: principal.requestId }, { status: boundary.status });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      const ready = Boolean(env.GATEWAY_INTERNAL_SECRET && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
      return Response.json({ status: ready ? "ready" : "misconfigured" }, { status: ready ? 200 : 503 });
    }
    if (url.pathname !== "/api/integration/fulfillment") return Response.json({ error: "not_found" }, { status: 404 });
    return handle(request, env);
  },
};
