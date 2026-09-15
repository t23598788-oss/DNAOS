import assert from "node:assert/strict";
import {
  DNA_OS_RUNTIME_STATE_BOUNDARY,
  type RuntimeProviderAdapter,
  type RuntimeProviderStatus,
} from "../engines/integration-gateway/contracts/runtime-provider";
import { selectRuntimeProvider } from "../engines/integration-gateway/runtime-router";
import { railwayRuntimeProviderStatus } from "../engines/integration-gateway/adapters/railway";
import { vercelRuntimeProviderStatus } from "../engines/integration-gateway/adapters/vercel";

function adapter(status: RuntimeProviderStatus): RuntimeProviderAdapter {
  return {
    provider_id: status.provider_id,
    observeRuntimeStatus: () => status,
  };
}

const request = {
  required_capabilities: ["runtime.render", "runtime.display"],
  max_latency_ms: 500,
  allow_paid_providers: true,
};

async function main() {
 {
  const result = await selectRuntimeProvider([
    adapter(vercelRuntimeProviderStatus({ runtimeUrl: "https://vercel.test", healthy: true, available: true, latencyMs: 80 })),
    adapter(railwayRuntimeProviderStatus({ runtimeUrl: "https://railway.test", healthy: true, available: true, latencyMs: 90 })),
  ], request);

  assert.equal(result.ok, true);
  assert.equal(result.selected_provider_id, "vercel");
  assert.equal(result.runtime_url, "https://vercel.test");
}

{
  const result = await selectRuntimeProvider([
    adapter(vercelRuntimeProviderStatus({ runtimeUrl: "https://vercel.test", healthy: false, available: true, latencyMs: 80 })),
    adapter(railwayRuntimeProviderStatus({ runtimeUrl: "https://railway.test", healthy: true, available: true, latencyMs: 90 })),
  ], request);

  assert.equal(result.ok, true);
  assert.equal(result.selected_provider_id, "railway");
}

{
  const result = await selectRuntimeProvider([
    adapter(railwayRuntimeProviderStatus({ runtimeUrl: "https://railway.test", healthy: false, available: true, latencyMs: 90 })),
    adapter(vercelRuntimeProviderStatus({ runtimeUrl: "https://vercel.test", healthy: true, available: true, latencyMs: 80 })),
  ], request);

  assert.equal(result.ok, true);
  assert.equal(result.selected_provider_id, "vercel");
}

{
  const result = await selectRuntimeProvider([
    adapter(vercelRuntimeProviderStatus({ runtimeUrl: "https://vercel.test", healthy: true, available: true, latencyMs: 900 })),
    adapter(railwayRuntimeProviderStatus({ runtimeUrl: "https://railway.test", healthy: true, available: true, latencyMs: 120 })),
  ], request);

  assert.equal(result.ok, true);
  assert.equal(result.selected_provider_id, "railway");
  assert.deepEqual(result.rejections, [{ provider_id: "vercel", reason: "latency_too_high" }]);
}

{
  const result = await selectRuntimeProvider([
    adapter(railwayRuntimeProviderStatus({
      runtimeUrl: "https://railway.test",
      healthy: true,
      available: true,
      latencyMs: 120,
      paid: true,
      ownerApproved: false,
    })),
  ], request);

  assert.equal(result.ok, false);
  assert.equal(result.selected_provider_id, "railway");
  assert.equal(result.requires_owner_approval, true);
}

{
  const result = await selectRuntimeProvider([
    adapter(vercelRuntimeProviderStatus({ runtimeUrl: "https://vercel.test", healthy: false, available: true, latencyMs: 80 })),
    adapter(railwayRuntimeProviderStatus({ runtimeUrl: "https://railway.test", healthy: false, available: true, latencyMs: 90 })),
  ], request);

  assert.equal(result.ok, false);
  assert.equal(result.selected_provider_id, null);
  assert.equal(result.runtime_url, null);
  assert.equal(result.requires_owner_approval, false);
}

{
  const result = await selectRuntimeProvider([
    adapter(vercelRuntimeProviderStatus({ runtimeUrl: "https://vercel.test", healthy: true, available: true, latencyMs: 80 })),
  ], request);

  assert.deepEqual(result.state_boundary, DNA_OS_RUNTIME_STATE_BOUNDARY);
  assert.equal("business_state" in result, false);
  assert.equal("data_state" in result, false);
  assert.equal("auth_state" in result, false);
}

console.log("runtime-provider-router-test: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
