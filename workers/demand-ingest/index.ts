/** Gateway-only demand ingestion Worker; validates adapter identity and delegates tenant authorization to the existing database RPC. */
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

interface Env extends WorkerDatabaseEnv {
  STOCK_ADAPTER_ID?: string;
}
interface DemandInput {
  idempotency_key: string;
  demand_reference: string;
  item_code: string;
  warehouse_key: string;
  quantity: number;
  stock_uom: string;
  requested_at: string;
}
const MAX_BODY_BYTES = 8 * 1024;

function requiredText(value: unknown, name: string, max = 240): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${name}_invalid`);
  return value.trim();
}

function parseDemand(value: unknown): DemandInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("json_object_required");
  const body = value as Record<string, unknown>;
  const allowed = new Set(["schema_version", "event_type", "idempotency_key", "demand_reference", "item_code", "warehouse_key", "quantity", "stock_uom", "requested_at"]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new Error("unexpected_identity_or_payload_field");
  if (body.schema_version !== "1.0" || body.event_type !== "demand.stock.requested") throw new Error("unsupported_event");
  if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity) || body.quantity <= 0) throw new Error("quantity_invalid");
  const requestedAt = requiredText(body.requested_at, "requested_at", 64);
  if (!Number.isFinite(Date.parse(requestedAt))) throw new Error("requested_at_invalid");
  return {
    idempotency_key: requiredText(body.idempotency_key, "idempotency_key"),
    demand_reference: requiredText(body.demand_reference, "demand_reference"),
    item_code: requiredText(body.item_code, "item_code"),
    warehouse_key: requiredText(body.warehouse_key, "warehouse_key"),
    quantity: body.quantity,
    stock_uom: requiredText(body.stock_uom, "stock_uom", 40),
    requested_at: new Date(requestedAt).toISOString(),
  };
}

async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
  let principal;
  try { principal = requireGatewayPrincipal(request, env, "demand.submit"); }
  catch (error) {
    const boundary = error instanceof BoundaryError ? error : new BoundaryError("gateway_only", 403);
    safeFailureLog({ requestId: null, adapterId: null, operation: "demand.submit", reasonCode: boundary.message });
    return Response.json({ ok: false, error: boundary.message }, { status: boundary.status });
  }
  if (!env.STOCK_ADAPTER_ID || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(env.STOCK_ADAPTER_ID)) {
    return Response.json({ ok: false, error: "demand_ingestion_not_configured", request_id: principal.requestId }, { status: 503 });
  }
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    await recordAuthorizationRejection(env, principal.requestId, principal.adapterId, "demand.submit", "invalid_identity");
    safeFailureLog({ requestId: principal.requestId, adapterId: principal.adapterId, operation: "demand.submit", reasonCode: "request_body_too_large" });
    return Response.json({ ok: false, error: "request_body_too_large", request_id: principal.requestId }, { status: 413 });
  }
  let input: DemandInput;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      await recordAuthorizationRejection(env, principal.requestId, principal.adapterId, "demand.submit", "invalid_identity");
      return Response.json({ ok: false, error: "request_body_too_large", request_id: principal.requestId }, { status: 413 });
    }
    input = parseDemand(JSON.parse(raw));
  } catch (error) {
    await recordAuthorizationRejection(env, principal.requestId, principal.adapterId, "demand.submit", "invalid_identity");
    safeFailureLog({ requestId: principal.requestId, adapterId: principal.adapterId, operation: "demand.submit", reasonCode: "invalid_payload" });
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "invalid_payload", request_id: principal.requestId }, { status: 400 });
  }

  try {
    const { response, data } = await callServiceRpc<Record<string, unknown>>(env, "match_and_reserve_stock_demand_for_adapter", {
      p_request_id: principal.requestId,
      p_demand_adapter_id: principal.adapterId,
      p_api_token: principal.apiToken,
      p_stock_adapter_id: env.STOCK_ADAPTER_ID,
      p_idempotency_key: input.idempotency_key,
      p_demand_reference: input.demand_reference,
      p_external_item_code: input.item_code,
      p_external_warehouse_key: input.warehouse_key,
      p_requested_qty: input.quantity,
      p_stock_uom: input.stock_uom,
      p_requested_at: input.requested_at,
    });
    if (!response.ok) {
      const row = data as Record<string, unknown> | null;
      const reason = response.status === 403 ? rpcReasonCode(row)
        : response.status === 404 ? "target_not_found"
          : response.status === 409 ? "idempotency_conflict" : "processing_rejected";
      if (response.status === 403) await recordAuthorizationRejection(env, principal.requestId, principal.adapterId, "demand.submit", reason, input.demand_reference);
      safeFailureLog({ requestId: principal.requestId, adapterId: principal.adapterId, operation: "demand.submit", reasonCode: reason });
      return Response.json({ ok: false, error: response.status === 403 ? "adapter_not_authorized" : "demand_processing_failed", request_id: principal.requestId }, { status: rpcStatus(String(row?.code ?? "")) });
    }
    const result = data as Record<string, unknown>;
    return Response.json({ ...result, request_id: principal.requestId }, {
      status: result.outcome === "OUT_OF_STOCK" ? 409 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const boundary = error instanceof BoundaryError ? error : new BoundaryError("demand_processing_failed", 502);
    safeFailureLog({ requestId: principal.requestId, adapterId: principal.adapterId, operation: "demand.submit", reasonCode: boundary.message });
    return Response.json({ ok: false, error: boundary.message, request_id: principal.requestId }, { status: boundary.status });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      const ready = Boolean(env.GATEWAY_INTERNAL_SECRET && env.STOCK_ADAPTER_ID && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
      return Response.json({ status: ready ? "ready" : "misconfigured" }, { status: ready ? 200 : 503 });
    }
    if (url.pathname !== "/api/integration/demand") return Response.json({ error: "not_found" }, { status: 404 });
    return handle(request, env);
  },
};
