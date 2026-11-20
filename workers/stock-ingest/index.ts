/** Gateway-only stock ingestion Worker; validates adapter identity and delegates tenant authorization to the existing database RPC. */
import {
  BoundaryError,
  callServiceRpc,
  recordAuthorizationRejection,
  requireGatewayPrincipal,
  rpcReasonCode,
  rpcStatus,
  safeFailureLog,
  type WorkerDatabaseEnv,
} from "../shared/workerIdentity.ts";

interface Env extends WorkerDatabaseEnv {}
interface StockInput {
  idempotency_key: string;
  external_entry_key: string;
  item_code: string;
  warehouse_key: string;
  quantity_delta: number;
  stock_uom: string;
  occurred_at: string;
  source_document_key: string | null;
}

const MAX_BODY_BYTES = 8 * 1024;

function requiredText(value: unknown, name: string, max = 240): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${name}_invalid`);
  return value.trim();
}

function parseStockInput(value: unknown): StockInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("json_object_required");
  const body = value as Record<string, unknown>;
  const allowed = new Set([
    "schema_version", "event_type", "idempotency_key", "external_entry_key", "item_code",
    "warehouse_key", "quantity_delta", "stock_uom", "occurred_at", "source_document_key",
  ]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new Error("unexpected_identity_or_payload_field");
  if (body.schema_version !== "1.0" || body.event_type !== "stock.movement.recorded") throw new Error("unsupported_event");
  if (typeof body.quantity_delta !== "number" || !Number.isFinite(body.quantity_delta) || body.quantity_delta === 0) {
    throw new Error("quantity_delta_invalid");
  }
  const occurredAt = requiredText(body.occurred_at, "occurred_at", 64);
  if (!Number.isFinite(Date.parse(occurredAt))) throw new Error("occurred_at_invalid");
  const sourceDocumentKey = body.source_document_key == null ? null : requiredText(body.source_document_key, "source_document_key");
  return {
    idempotency_key: requiredText(body.idempotency_key, "idempotency_key"),
    external_entry_key: requiredText(body.external_entry_key, "external_entry_key"),
    item_code: requiredText(body.item_code, "item_code"),
    warehouse_key: requiredText(body.warehouse_key, "warehouse_key"),
    quantity_delta: body.quantity_delta,
    stock_uom: requiredText(body.stock_uom, "stock_uom", 40),
    occurred_at: new Date(occurredAt).toISOString(),
    source_document_key: sourceDocumentKey,
  };
}

async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
  let principal;
  try { principal = requireGatewayPrincipal(request, env, "stock.ingest"); }
  catch (error) {
    const boundary = error instanceof BoundaryError ? error : new BoundaryError("gateway_only", 403);
    safeFailureLog({ requestId: null, adapterId: null, operation: "stock.ingest", reasonCode: boundary.message });
    return Response.json({ ok: false, error: boundary.message }, { status: boundary.status });
  }
  const maxBytes = Number(request.headers.get("content-length") ?? "0");
  if (maxBytes > MAX_BODY_BYTES) {
    await recordAuthorizationRejection(env, principal.requestId, principal.adapterId, "stock.ingest", "invalid_identity");
    safeFailureLog({ requestId: principal.requestId, adapterId: principal.adapterId, operation: "stock.ingest", reasonCode: "request_body_too_large" });
    return Response.json({ ok: false, error: "request_body_too_large", request_id: principal.requestId }, { status: 413 });
  }
  let input: StockInput;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      await recordAuthorizationRejection(env, principal.requestId, principal.adapterId, "stock.ingest", "invalid_identity");
      return Response.json({ ok: false, error: "request_body_too_large", request_id: principal.requestId }, { status: 413 });
    }
    input = parseStockInput(JSON.parse(raw));
  } catch (error) {
    await recordAuthorizationRejection(env, principal.requestId, principal.adapterId, "stock.ingest", "invalid_identity");
    safeFailureLog({ requestId: principal.requestId, adapterId: principal.adapterId, operation: "stock.ingest", reasonCode: "invalid_payload" });
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_payload", request_id: principal.requestId }, { status: 400 });
  }

  try {
    const { response, data } = await callServiceRpc<Record<string, unknown>>(env, "ingest_stock_movement_for_adapter", {
      p_request_id: principal.requestId,
      p_adapter_id: principal.adapterId,
      p_api_token: principal.apiToken,
      p_idempotency_key: input.idempotency_key,
      p_external_entry_key: input.external_entry_key,
      p_external_item_code: input.item_code,
      p_external_warehouse_key: input.warehouse_key,
      p_quantity_delta: input.quantity_delta,
      p_stock_uom: input.stock_uom,
      p_occurred_at: input.occurred_at,
      p_source_document_key: input.source_document_key,
    });
    if (!response.ok) {
      const row = data as Record<string, unknown> | null;
      const reason = response.status === 403 ? rpcReasonCode(row)
        : response.status === 404 ? "target_not_found"
          : response.status === 409 ? "idempotency_conflict" : "processing_rejected";
      if (response.status === 403) await recordAuthorizationRejection(env, principal.requestId, principal.adapterId, "stock.ingest", reason, input.external_entry_key);
      safeFailureLog({ requestId: principal.requestId, adapterId: principal.adapterId, operation: "stock.ingest", reasonCode: reason });
      return Response.json({ ok: false, error: response.status === 403 ? "adapter_not_authorized" : "stock_ingestion_failed", request_id: principal.requestId }, { status: rpcStatus(String(row?.code ?? "")) });
    }
    return Response.json({ ok: true, request_id: principal.requestId, data }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const boundary = error instanceof BoundaryError ? error : new BoundaryError("stock_ingestion_failed", 502);
    safeFailureLog({ requestId: principal.requestId, adapterId: principal.adapterId, operation: "stock.ingest", reasonCode: boundary.message });
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
    if (url.pathname !== "/api/integration/stock-update") return Response.json({ error: "not_found" }, { status: 404 });
    return handle(request, env);
  },
};
