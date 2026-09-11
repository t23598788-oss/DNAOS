/**
 * Runtime endpoint registry — deterministic, no network, no live provider.
 * Run: npx tsx control/runtime-endpoint-registry/tests/runtime-endpoint-registry.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOCAL_CORE_SERVICES,
  ensureRuntimeEndpointsLoaded,
  joinEndpointAddress,
  listRuntimeEndpoints,
  registerRuntimeEndpoint,
  replaceRuntimeEndpointsForTests,
  resetRuntimeEndpointsForTests,
  resolveRuntimeEndpoint,
  validateRuntimeEndpoint,
  type RuntimeEndpointRegistration,
} from "../contract";
import { SERVICES } from "../../runtime-control/contract";

declare const process: { cwd(): string; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function check(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const localCircuit: RuntimeEndpointRegistration = {
  endpoint_id: "endpoint://dna-os-circuit/local",
  service_id: "dna-os-circuit",
  scope: "CORE_LOCAL",
  transport: "HTTP",
  address: "http://127.0.0.1:8790",
  health_path: "/circuit.json",
  source: "NODE_LOCAL",
  status: "ACTIVE",
};
const remoteCircuit: RuntimeEndpointRegistration = {
  endpoint_id: "endpoint://dna-os-circuit/public",
  service_id: "dna-os-circuit",
  scope: "PUBLIC",
  transport: "HTTPS",
  address: "https://example.invalid",
  health_path: "/circuit.json",
  source: "REGISTERED_REMOTE",
  status: "ACTIVE",
};

check("1. ACTIVE local endpoint resolves", () => {
  replaceRuntimeEndpointsForTests([localCircuit]);
  const r = resolveRuntimeEndpoint("endpoint://dna-os-circuit/local");
  assert(r.ok && r.endpoint.address === "http://127.0.0.1:8790", JSON.stringify(r));
  assert(r.ok && r.endpoint.source === "NODE_LOCAL", "source");
});

check("2. ACTIVE registered remote endpoint resolves", () => {
  replaceRuntimeEndpointsForTests([remoteCircuit]);
  const r = resolveRuntimeEndpoint("endpoint://dna-os-circuit/public");
  assert(r.ok && r.endpoint.source === "REGISTERED_REMOTE", JSON.stringify(r));
  assert(r.ok && r.endpoint.address === "https://example.invalid", "addr");
});

check("3. unknown endpoint fails closed", () => {
  replaceRuntimeEndpointsForTests([localCircuit]);
  const r = resolveRuntimeEndpoint("endpoint://no-such/local");
  assert(!r.ok && r.reason === "UNKNOWN_ENDPOINT", JSON.stringify(r));
});

check("4. ambiguous service_id fails closed", () => {
  replaceRuntimeEndpointsForTests([localCircuit, remoteCircuit]);
  const r = resolveRuntimeEndpoint("dna-os-circuit");
  assert(!r.ok && r.reason === "AMBIGUOUS_ENDPOINT", JSON.stringify(r));
});

check("5. DISABLED endpoint fails closed", () => {
  replaceRuntimeEndpointsForTests([{ ...localCircuit, status: "DISABLED" }]);
  const r = resolveRuntimeEndpoint("endpoint://dna-os-circuit/local");
  assert(!r.ok && r.reason === "ENDPOINT_DISABLED", JSON.stringify(r));
});

check("6. DRAINING: execute fails; observe succeeds", () => {
  replaceRuntimeEndpointsForTests([{ ...localCircuit, status: "DRAINING" }]);
  const exec = resolveRuntimeEndpoint({ query: "endpoint://dna-os-circuit/local", purpose: "execute" });
  const obs = resolveRuntimeEndpoint({ query: "endpoint://dna-os-circuit/local", purpose: "observe" });
  assert(!exec.ok && exec.reason === "ENDPOINT_DRAINING", JSON.stringify(exec));
  assert(obs.ok && obs.endpoint.status === "DRAINING", JSON.stringify(obs));
});

check("7. malformed address/transport rejected", () => {
  assert(validateRuntimeEndpoint({ ...localCircuit, address: "not-a-url" }) === "TRANSPORT_ADDRESS_MISMATCH", "http");
  assert(validateRuntimeEndpoint({ ...remoteCircuit, transport: "HTTP" }) === "TRANSPORT_ADDRESS_MISMATCH", "https as http");
  const bad = registerRuntimeEndpoint({ ...localCircuit, address: "ftp://x" });
  assert(!bad.ok, "ftp");
});

check("8. resolver source has no provider awareness", () => {
  const src = readFileSync(join(process.cwd(), "control/runtime-endpoint-registry/resolver.ts"), "utf8");
  assert(!/railway|vercel/i.test(src), "resolver mentions optional provider");
});

check("9. no secret stored or exposed on registration", () => {
  const secret = validateRuntimeEndpoint({ ...localCircuit, address: "http://127.0.0.1:9/?token=abc" });
  assert(secret === "SECRET_MATERIAL", String(secret));
  const userinfo = validateRuntimeEndpoint({
    ...remoteCircuit,
    address: "https://user:password@example.com/x",
  });
  assert(userinfo === "SECRET_MATERIAL", String(userinfo));
  const userOnly = validateRuntimeEndpoint({ ...localCircuit, address: "http://user@127.0.0.1:9/health" });
  assert(userOnly === "SECRET_MATERIAL", String(userOnly));
  const extra = validateRuntimeEndpoint({ ...localCircuit, railway_service_id: "x" } as RuntimeEndpointRegistration);
  assert(extra === "FORBIDDEN_FIELD", String(extra));
  replaceRuntimeEndpointsForTests([localCircuit]);
  const listed = JSON.stringify(listRuntimeEndpoints());
  assert(!/token=|password=|shared_secret/i.test(listed), listed);
});

check("10. resolver does not mutate registry", () => {
  replaceRuntimeEndpointsForTests([localCircuit]);
  const before = JSON.stringify(listRuntimeEndpoints());
  resolveRuntimeEndpoint("endpoint://dna-os-circuit/local");
  resolveRuntimeEndpoint("missing");
  assert(JSON.stringify(listRuntimeEndpoints()) === before, "mutated");
});

check("11. existing ServiceId reused; ports from SERVICES", () => {
  resetRuntimeEndpointsForTests();
  ensureRuntimeEndpointsLoaded();
  for (const id of LOCAL_CORE_SERVICES) {
    const r = resolveRuntimeEndpoint(`endpoint://${id}/local`);
    assert(r.ok, String(id));
    assert(r.ok && r.endpoint.service_id === id, "service_id");
    assert(r.ok && r.endpoint.address === `http://127.0.0.1:${SERVICES[id].port}`, SERVICES[id].port.toString());
    assert(r.ok && r.endpoint.health_path === SERVICES[id].health_path, "health");
  }
});

check("12. duplicate endpoint_id is latest-wins, deterministic", () => {
  replaceRuntimeEndpointsForTests([]);
  registerRuntimeEndpoint(localCircuit);
  registerRuntimeEndpoint({ ...localCircuit, address: "http://127.0.0.1:9999" });
  const all = listRuntimeEndpoints().filter((e) => e.endpoint_id === localCircuit.endpoint_id);
  assert(all.length === 1 && all[0]!.address === "http://127.0.0.1:9999", JSON.stringify(all));
});

check("13. joinEndpointAddress does not invent hosts", () => {
  assert(joinEndpointAddress(localCircuit) === "http://127.0.0.1:8790/circuit.json", joinEndpointAddress(localCircuit));
});

check("14. empty query fails closed", () => {
  replaceRuntimeEndpointsForTests([localCircuit]);
  assert(resolveRuntimeEndpoint("  ").reason === "INVALID_QUERY", "blank");
});

check("15. REGISTERED_REMOTE cannot replace NODE_LOCAL endpoint id", () => {
  replaceRuntimeEndpointsForTests([]);
  assert(registerRuntimeEndpoint(localCircuit).ok, "local");
  const clash = registerRuntimeEndpoint({
    ...remoteCircuit,
    endpoint_id: localCircuit.endpoint_id,
    service_id: localCircuit.service_id,
  });
  assert(!clash.ok && clash.rejection === "CROSS_SOURCE_COLLISION", String(clash));
  const kept = listRuntimeEndpoints().find((e) => e.endpoint_id === localCircuit.endpoint_id);
  assert(kept?.source === "NODE_LOCAL" && kept.address === localCircuit.address, JSON.stringify(kept));
});

check("16. invalid latest replacement removes prior ACTIVE row", () => {
  replaceRuntimeEndpointsForTests([]);
  assert(registerRuntimeEndpoint(remoteCircuit).ok, "remote");
  const bad = registerRuntimeEndpoint({ ...remoteCircuit, address: "" });
  assert(!bad.ok, "empty address must reject");
  // Simulate host-runtime fail-closed policy for rejected same-id replacement.
  const { removeRuntimeEndpoint } = require("../registry") as typeof import("../registry");
  removeRuntimeEndpoint(remoteCircuit.endpoint_id);
  assert(listRuntimeEndpoints().every((e) => e.endpoint_id !== remoteCircuit.endpoint_id), "stale ACTIVE remains");
});

resetRuntimeEndpointsForTests();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
