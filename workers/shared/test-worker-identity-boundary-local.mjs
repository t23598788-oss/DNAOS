import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const localDbUrl = process.env.DNAOS_LOCAL_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:55422/postgres";
assert.match(localDbUrl, /127\.0\.0\.1|localhost/, "this test must use the isolated Local database");

const statusEnv = execFileSync("supabase", ["status", "-o", "env"], { cwd: root, encoding: "utf8" });
const serviceKeyLine = statusEnv.split(/\r?\n/).find(line => line.startsWith("SERVICE_ROLE_KEY="));
assert.ok(serviceKeyLine, "Local service-role key must be available from local Supabase status");
const serviceKey = serviceKeyLine.slice("SERVICE_ROLE_KEY=".length).replace(/^"|"$/g, "");
const supabaseUrl = "http://127.0.0.1:55421";
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  const targetUrl = typeof args[0] === "string" ? args[0] : args[0]?.url;
  if (!response.ok && typeof targetUrl === "string" && targetUrl.includes("/rest/v1/rpc/")) {
    let error = {};
    try { error = await response.clone().json(); } catch { /* no error details */ }
    console.warn(JSON.stringify({ event: "local_rpc_test_failure", status: response.status,
      sqlstate: error.code ?? null, error: error.message ?? null, detail: error.details ?? null }));
  }
  return response;
};
const gatewaySecret = randomBytes(48).toString("base64url");
const token = () => randomBytes(48).toString("base64url");
const ids = {
  orgA: randomUUID(), orgB: randomUUID(), stockA: randomUUID(), demandA: randomUUID(),
  stockB: randomUUID(), demandB: randomUUID(), noDemand: randomUUID(),
  shared: randomUUID(), item: randomUUID(), location: randomUUID(),
};
const credentials = {
  stockA: token(), demandA: token(), stockB: token(), demandB: token(),
  noDemand: token(), sharedA: token(), sharedB: token(),
};
const asSql = value => `'${String(value).replaceAll("'", "''")}'`;
function psql(sql) {
  return execFileSync("psql", [localDbUrl, "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], { encoding: "utf8" }).trim();
}
function sqlUuid(value) { return `${asSql(value)}::uuid`; }
function serviceHeaders() {
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };
}
async function callWorker(worker, path, body, principal, overrides = {}) {
  const headers = new Headers({ "content-type": "application/json", ...(principal?.headers ?? {}) });
  if (principal) {
    headers.set("x-adapter-id", principal.adapterId);
    headers.set("x-adapter-token", principal.token);
    headers.set("x-dna-request-id", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"); // gateway must replace this
  }
  return worker.fetch(new Request(`https://dnaos.local${path}`, {
    method: "POST", headers, body: body == null ? undefined : JSON.stringify(body),
  }), { ...overrides, GATEWAY_INTERNAL_SECRET: gatewaySecret, SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey });
}

const { default: stockWorker } = await import(pathToFileURL(resolve(root, "workers/stock-ingest/index.ts")));
const { default: demandWorker } = await import(pathToFileURL(resolve(root, "workers/demand-ingest/index.ts")));
const { default: fulfillmentWorker } = await import(pathToFileURL(resolve(root, "workers/fulfillment-ingest/index.ts")));
const { default: gatewayWorker } = await import(pathToFileURL(resolve(root, "workers/business-onboarding/index.ts")));

const tokens = [credentials.stockA, credentials.demandA, credentials.stockB, credentials.demandB, credentials.noDemand, credentials.sharedA, credentials.sharedB];
const adapters = [
  [ids.stockA, "local.stock.a", ["stock.ingest", "stock.fulfillment.confirm"]],
  [ids.demandA, "local.demand.a", ["demand.submit"]],
  [ids.stockB, "local.stock.b", ["stock.ingest", "stock.fulfillment.confirm"]],
  [ids.demandB, "local.demand.b", ["demand.submit"]],
  [ids.noDemand, "local.no-demand", ["stock.ingest"]],
  [ids.shared, "local.shared", ["stock.ingest"]],
];
const bindings = [
  [ids.orgA, ids.stockA, credentials.stockA], [ids.orgA, ids.demandA, credentials.demandA],
  [ids.orgB, ids.stockB, credentials.stockB], [ids.orgB, ids.demandB, credentials.demandB],
  [ids.orgA, ids.noDemand, credentials.noDemand],
  [ids.orgA, ids.shared, credentials.sharedA], [ids.orgB, ids.shared, credentials.sharedB],
];

function cleanup() {
  const adapterIds = [ids.stockA, ids.demandA, ids.stockB, ids.demandB, ids.noDemand, ids.shared].map(sqlUuid).join(",");
  const orgIds = [ids.orgA, ids.orgB].map(sqlUuid).join(",");
  psql(`delete from system.event_stream where adapter_id in (${adapterIds});
    delete from public.shadow_stock_events where adapter_id in (${adapterIds});
    delete from system.usage_meter_logs where adapter_id in (${adapterIds});
    delete from public.stock_shadow_reservations where demand_adapter_id in (${adapterIds}) or stock_adapter_id in (${adapterIds});
    delete from public.stock_shadow_demand_attempts where demand_adapter_id in (${adapterIds}) or stock_adapter_id in (${adapterIds});
    delete from public.stock_current_status where adapter_id in (${adapterIds});
    delete from public.stock_shadow_balance_observations where adapter_id in (${adapterIds});
    delete from public.stock_shadow_movements where adapter_id in (${adapterIds});
    delete from public.stock_shadow_locations where adapter_id in (${adapterIds});
    delete from public.stock_shadow_items where adapter_id in (${adapterIds});
    delete from system.adapter_organization_bindings where adapter_id in (${adapterIds}) or organization_id in (${orgIds});
    delete from system.system_adapters where adapter_id in (${adapterIds});
    delete from public.organizations where id in (${orgIds});`);
}

let testsPassed = 0;
try {
  // Explicitly refuse to overlap with any prior/real business data in this Local DB.
  const initialCounts = psql("select (select count(*) from system.adapter_organization_bindings)||','||(select count(*) from public.stock_shadow_reservations)||','||(select count(*) from public.stock_shadow_movements)");
  assert.equal(initialCounts, "0,0,0", "Local baseline must have no existing adapter binding, reservation, or stock movement data");
  psql(`insert into public.organizations(id,name) values (${sqlUuid(ids.orgA)},'local-worker-test-a'),(${sqlUuid(ids.orgB)},'local-worker-test-b');
    insert into system.system_adapters(adapter_id,adapter_type,capability_scope,status) values
      (${sqlUuid(ids.stockA)},'local.stock.a','["stock.ingest","stock.fulfillment.confirm"]'::jsonb,'ready'),
      (${sqlUuid(ids.demandA)},'local.demand.a','["demand.submit"]'::jsonb,'ready'),
      (${sqlUuid(ids.stockB)},'local.stock.b','["stock.ingest","stock.fulfillment.confirm"]'::jsonb,'ready'),
      (${sqlUuid(ids.demandB)},'local.demand.b','["demand.submit"]'::jsonb,'ready'),
      (${sqlUuid(ids.noDemand)},'local.no-demand','["stock.ingest"]'::jsonb,'ready'),
      (${sqlUuid(ids.shared)},'local.shared','["stock.ingest"]'::jsonb,'ready');
    insert into system.adapter_organization_bindings(organization_id,adapter_id,credential_sha256,status)
      values ${bindings.map(([org, adapterId, secret]) => `(${sqlUuid(org)},${sqlUuid(adapterId)},encode(extensions.digest(convert_to(${asSql(secret)},'UTF8'),'sha256'),'hex'),'active')`).join(",")};
    insert into public.stock_shadow_items(shadow_item_id,adapter_id,external_item_code,item_name,stock_uom)
      values (${sqlUuid(ids.item)},${sqlUuid(ids.stockA)},'LOCAL-ITEM','Local test item','pcs');
    insert into public.stock_shadow_locations(shadow_location_id,adapter_id,external_warehouse_key,warehouse_name)
      values (${sqlUuid(ids.location)},${sqlUuid(ids.stockA)},'LOCAL-WH','Local test warehouse');
    insert into public.stock_shadow_balance_observations(adapter_id,idempotency_key,shadow_item_id,shadow_location_id,actual_qty,stock_uom,observed_at)
      values (${sqlUuid(ids.stockA)},'fixture-balance:${randomUUID()}',${sqlUuid(ids.item)},${sqlUuid(ids.location)},100,'pcs',clock_timestamp()-interval '5 minutes');`);

  const services = {
    GATEWAY_INTERNAL_SECRET: gatewaySecret,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    STOCK_ADAPTER_ID: ids.stockA,
  };
  const noRateLimit = { limit: async () => ({ success: true }) };
  const gatewayEnv = {
    ...services,
    RATE_LIMITER: noRateLimit,
    STOCK_INGEST: { fetch: request => stockWorker.fetch(request, services) },
    DEMAND_INGEST: { fetch: request => demandWorker.fetch(request, services) },
    FULFILLMENT_INGEST: { fetch: request => fulfillmentWorker.fetch(request, services) },
  };

  const stockBody = { schema_version: "1.0", event_type: "stock.movement.recorded", idempotency_key: `stock-${randomUUID()}`,
    external_entry_key: `entry-${randomUUID()}`, item_code: "LOCAL-ITEM", warehouse_key: "LOCAL-WH", quantity_delta: 5,
    stock_uom: "pcs", occurred_at: new Date(Date.now() - 180_000).toISOString() };
  const gatewayStockRequest = new Request("https://dnaos.local/api/gateway", { method: "POST", headers: {
    "content-type": "application/json", "x-adapter-id": ids.stockA, "x-adapter-token": credentials.stockA,
    "x-dna-request-id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "x-dna-gateway-secret": "attacker-supplied",
  }, body: JSON.stringify({ capability_id: "stock.ingest", input: stockBody }) });
  const stockResponse = await gatewayWorker.fetch(gatewayStockRequest, gatewayEnv);
  const stockJson = await stockResponse.json();
  assert.equal(stockResponse.status, 200, `authorized stock write should pass: ${JSON.stringify(stockJson)}`);
  assert.notEqual(stockJson.request_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Gateway must replace caller request_id");
  assert.equal(stockJson.data.quantity_after, 105);
  testsPassed += 1;

  const movementsAfterStock = Number(psql(`select count(*) from public.stock_shadow_movements where adapter_id=${sqlUuid(ids.stockA)}`));
  const directStock = await callWorker(stockWorker, "/api/integration/stock-update", stockBody, {
    adapterId: ids.stockA, token: credentials.stockA, headers: { "x-dna-capability": "stock.ingest" },
  }, services);
  assert.equal(directStock.status, 403, "direct worker call without Gateway proof must fail");
  assert.equal(Number(psql(`select count(*) from public.stock_shadow_movements where adapter_id=${sqlUuid(ids.stockA)}`)), movementsAfterStock);
  testsPassed += 1;

  const operationSpoof = await callWorker(stockWorker, "/api/integration/stock-update", stockBody, {
    adapterId: ids.stockA, token: credentials.stockA,
    headers: { "x-dna-capability": "demand.submit", "x-dna-gateway-secret": gatewaySecret },
  }, services);
  assert.equal(operationSpoof.status, 401, "worker must reject a gateway capability that does not match its operation");
  testsPassed += 1;

  const actorSpoof = await gatewayWorker.fetch(new Request("https://dnaos.local/v1/integrations/stock-update", { method: "POST", headers: {
    "content-type": "application/json", "x-adapter-id": ids.stockA, "x-adapter-token": credentials.stockA,
  }, body: JSON.stringify({ ...stockBody, organization_id: ids.orgB, actor_id: "spoofed" }) }), gatewayEnv);
  assert.equal(actorSpoof.status, 400, "body-supplied actor/organization identity must fail");
  const actorSpoofResult = await actorSpoof.json();
  assert.ok(Number(psql(`select count(*) from system.event_stream where trace_id=${sqlUuid(actorSpoofResult.request_id)} and event_type='worker.authorization_rejected'`)) === 1,
    "trusted malformed request must have an append-only request_id audit trace");
  testsPassed += 1;

  const invalidToken = await gatewayWorker.fetch(new Request("https://dnaos.local/v1/integrations/stock-update", { method: "POST", headers: {
    "content-type": "application/json", "x-adapter-id": ids.stockA, "x-adapter-token": token(),
  }, body: JSON.stringify({ ...stockBody, idempotency_key: `bad-${randomUUID()}` }) }), gatewayEnv);
  assert.equal(invalidToken.status, 403, "wrong adapter token must fail closed");
  testsPassed += 1;
  const wrongAdapterToken = await gatewayWorker.fetch(new Request("https://dnaos.local/v1/integrations/stock-update", { method: "POST", headers: {
    "content-type": "application/json", "x-adapter-id": ids.stockA, "x-adapter-token": credentials.demandA,
  }, body: JSON.stringify({ ...stockBody, idempotency_key: `wrong-adapter-${randomUUID()}` }) }), gatewayEnv);
  assert.equal(wrongAdapterToken.status, 403, "valid token for a different adapter must not authenticate this adapter id");
  testsPassed += 1;

  const demandBody = { schema_version: "1.0", event_type: "demand.stock.requested", idempotency_key: `demand-${randomUUID()}`,
    demand_reference: `demand-ref-${randomUUID()}`, item_code: "LOCAL-ITEM", warehouse_key: "LOCAL-WH", quantity: 10,
    stock_uom: "pcs", requested_at: new Date(Date.now() - 60_000).toISOString() };
  const demandUrl = "https://dnaos.local/api/gateway";
  const callDemand = (adapterId, apiToken, body = demandBody) => gatewayWorker.fetch(new Request(demandUrl, { method: "POST", headers: {
    "content-type": "application/json", "x-adapter-id": adapterId, "x-adapter-token": apiToken,
  }, body: JSON.stringify({ capability_id: "demand.submit", input: body }) }), gatewayEnv);
  const wrongOrgDemand = await callDemand(ids.demandB, credentials.demandB);
  assert.equal(wrongOrgDemand.status, 403, "different organization cannot use stock adapter from organization A");
  testsPassed += 1;
  const noCapabilityDemand = await callDemand(ids.noDemand, credentials.noDemand);
  assert.equal(noCapabilityDemand.status, 403, "adapter without demand.submit cannot call demand operation");
  testsPassed += 1;
  const demandSpoof = await callDemand(ids.demandA, credentials.demandA, { ...demandBody, actor_id: "spoofed" });
  assert.equal(demandSpoof.status, 400, "demand body identity fields must fail closed");
  testsPassed += 1;
  const authorizedDemandResponse = await callDemand(ids.demandA, credentials.demandA);
  const authorizedDemand = await authorizedDemandResponse.json();
  assert.equal(authorizedDemandResponse.status, 200, `same-organization demand should pass: ${JSON.stringify(authorizedDemand)}`);
  assert.equal(authorizedDemand.outcome, "RESERVED");
  testsPassed += 1;

  const fulfillmentBody = { schema_version: "1.0", event_type: "fulfillment.delivery.confirmed", reservation_id: authorizedDemand.reservation_id,
    idempotency_key: `fulfillment-${randomUUID()}`, document_reference: "local-delivery-proof",
    document_created_at: new Date(Date.now() - 40_000).toISOString(), arrived_at: new Date(Date.now() - 30_000).toISOString(),
    occurred_at: new Date(Date.now() - 20_000).toISOString() };
  const fulfillmentUrl = "https://dnaos.local/api/gateway";
  const callFulfillment = (adapterId, apiToken, body = fulfillmentBody) => gatewayWorker.fetch(new Request(fulfillmentUrl, { method: "POST", headers: {
    "content-type": "application/json", "x-adapter-id": adapterId, "x-adapter-token": apiToken,
  }, body: JSON.stringify({ capability_id: "stock.fulfillment.confirm", input: body }) }), gatewayEnv);
  const forgedActorFulfillment = await callFulfillment(ids.stockA, credentials.stockA, { ...fulfillmentBody, actor_id: "spoofed", actor_type: "founder" });
  assert.equal(forgedActorFulfillment.status, 400, "fulfillment actor fields from body must be rejected");
  testsPassed += 1;
  const wrongAdapterFulfillment = await callFulfillment(ids.stockB, credentials.stockB);
  assert.equal(wrongAdapterFulfillment.status, 403, "unrelated adapter cannot use another organization's reservation");
  testsPassed += 1;
  const authorizedFulfillmentResponse = await callFulfillment(ids.stockA, credentials.stockA);
  const authorizedFulfillment = await authorizedFulfillmentResponse.json();
  assert.equal(authorizedFulfillmentResponse.status, 200, `participant adapter should fulfill owned reservation: ${JSON.stringify(authorizedFulfillment)}`);
  assert.equal(authorizedFulfillment.data.status, "CONSUMED");
  assert.equal(authorizedFulfillment.data.actor_id, (await psql(`select binding_id::text from system.adapter_organization_bindings where adapter_id=${sqlUuid(ids.stockA)} limit 1`)));
  testsPassed += 1;

  const ambiguousPrincipal = await callWorker(stockWorker, "/api/integration/stock-update", { ...stockBody, idempotency_key: `ambiguous-${randomUUID()}` }, {
    adapterId: ids.shared, token: credentials.sharedA, headers: { "x-dna-capability": "stock.ingest", "x-dna-gateway-secret": gatewaySecret },
  }, services);
  assert.equal(ambiguousPrincipal.status, 403, "adapter bound to multiple active organizations must fail closed");
  testsPassed += 1;

  const oldRpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/apply_stock_shadow_movement`, {
    method: "POST", headers: serviceHeaders(), body: JSON.stringify({ p_adapter_id: ids.stockA, p_idempotency_key: `bypass-${randomUUID()}`,
      p_external_entry_key: "bypass", p_external_item_code: "LOCAL-ITEM", p_external_warehouse_key: "LOCAL-WH",
      p_quantity_delta: 1, p_stock_uom: "pcs", p_occurred_at: new Date().toISOString(), p_source_document_key: null }),
  });
  assert.notEqual(oldRpcResponse.status, 200, "legacy unscoped RPC must not be directly callable with the service key");
  testsPassed += 1;
  const oldDemandRpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/match_and_reserve_stock_demand`, {
    method: "POST", headers: serviceHeaders(), body: JSON.stringify({ p_demand_adapter_id: ids.demandA, p_stock_adapter_id: ids.stockA,
      p_idempotency_key: `bypass-${randomUUID()}`, p_demand_reference: "bypass", p_external_item_code: "LOCAL-ITEM",
      p_external_warehouse_key: "LOCAL-WH", p_requested_qty: 1, p_stock_uom: "pcs", p_requested_at: new Date().toISOString() }),
  });
  assert.notEqual(oldDemandRpcResponse.status, 200, "legacy unscoped demand RPC must not be directly callable with the service key");
  testsPassed += 1;
  const oldFulfillmentRpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/confirm_stock_shadow_fulfillment`, {
    method: "POST", headers: serviceHeaders(), body: JSON.stringify({ p_reservation_id: authorizedDemand.reservation_id,
      p_idempotency_key: `bypass-${randomUUID()}`, p_document_reference: "bypass", p_document_created_at: null,
      p_arrived_at: new Date().toISOString(), p_occurred_at: new Date().toISOString(), p_received_at: new Date().toISOString(),
      p_actor_type: "spoof", p_actor_id: "spoof", p_source_channel: "spoof" }),
  });
  assert.notEqual(oldFulfillmentRpcResponse.status, 200, "legacy unscoped fulfillment RPC must not be directly callable with the service key");
  testsPassed += 1;
  const directTableWrite = await fetch(`${supabaseUrl}/rest/v1/stock_shadow_items`, {
    method: "POST", headers: { ...serviceHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ adapter_id: ids.stockA, external_item_code: "BYPASS", item_name: "Bypass", stock_uom: "pcs" }),
  });
  assert.ok([401, 403].includes(directTableWrite.status), "service_role must not write stock tables directly outside authorized RPC");
  testsPassed += 1;
  const directProjectionWrite = await fetch(`${supabaseUrl}/rest/v1/stock_current_status`, {
    method: "POST", headers: { ...serviceHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ adapter_id: ids.stockA, shadow_item_id: ids.item, shadow_location_id: ids.location,
      balance_observation_id: randomUUID(), actual_qty: 0, stock_uom: "pcs", observed_at: new Date().toISOString() }),
  });
  assert.ok([401, 403].includes(directProjectionWrite.status), "service_role must not directly modify the projection maintained by its authorized trigger");
  testsPassed += 1;

  const traceResults = psql(`select count(*) from system.event_stream where adapter_id=${sqlUuid(ids.stockA)} and trace_id is not null and event_type like 'worker.%'`);
  assert.ok(Number(traceResults) >= 2, "accepted operations must carry request_id trace records");
  const rejectedResults = psql(`select count(*) from system.event_stream where adapter_id=${sqlUuid(ids.stockA)} and event_type='worker.authorization_rejected'`);
  assert.ok(Number(rejectedResults) >= 1, "authorization failure must create an append-only rejection audit record");
  testsPassed += 1;

  // ACL verification: the reservation-status projection is internal and must
  // deny direct anonymous access; the view also remains a security-invoker view.
  const anonKeyLine = statusEnv.split(/\r?\n/).find(line => line.startsWith("ANON_KEY="));
  assert.ok(anonKeyLine);
  const anonKey = anonKeyLine.slice("ANON_KEY=".length).replace(/^"|"$/g, "");
  const anonResponse = await fetch(`${supabaseUrl}/rest/v1/stock_shadow_reservation_status?select=reservation_id`, {
    headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
  });
  assert.ok([401, 403].includes(anonResponse.status), "anonymous direct access to reservation status must be denied");
  testsPassed += 1;

  console.log(JSON.stringify({ status: "PASS", environment: "Supabase Local only", passed: testsPassed, test_count: 21 }));
} finally {
  cleanup();
}
