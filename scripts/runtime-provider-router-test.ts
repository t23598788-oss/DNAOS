import assert from "node:assert/strict";
import {
  DNA_OS_RUNTIME_STATE_BOUNDARY,
  type RuntimeProviderAdapter,
  type RuntimeProviderStatus,
} from "../engines/integration-gateway/contracts/runtime-provider";
import { selectRuntimeProvider } from "../engines/integration-gateway/runtime-router";
import { observeRailwayRuntimeProviderStatus, railwayRuntimeProviderStatus } from "../engines/integration-gateway/adapters/railway";
import { observeVercelRuntimeProviderStatus, vercelRuntimeProviderStatus } from "../engines/integration-gateway/adapters/vercel";

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
    adapter(vercelRuntimeProviderStatus({
      runtimeUrl: "https://vercel.test",
      healthy: true,
      available: true,
      latencyMs: 80,
      paid: true,
      ownerApproved: false,
    })),
    adapter(railwayRuntimeProviderStatus({
      runtimeUrl: "https://railway.test",
      healthy: true,
      available: true,
      latencyMs: 90,
      paid: false,
    })),
  ], request);

  assert.equal(result.ok, true);
  assert.equal(result.selected_provider_id, "railway");
  assert.equal(result.runtime_url, "https://railway.test");
  assert.equal(result.requires_owner_approval, false);
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

{
  const originalVercelRuntimeUrl = process.env.VERCEL_RUNTIME_URL;
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalVercelPaid = process.env.VERCEL_RUNTIME_PAID;
  const originalVercelOwnerApproved = process.env.VERCEL_RUNTIME_OWNER_APPROVED;
  const originalRailwayRuntimeUrl = process.env.RAILWAY_RUNTIME_URL;
  const originalRailwayPaid = process.env.RAILWAY_RUNTIME_PAID;
  const originalRailwayOwnerApproved = process.env.RAILWAY_RUNTIME_OWNER_APPROVED;

  delete process.env.VERCEL_RUNTIME_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.VERCEL_RUNTIME_PAID;
  delete process.env.VERCEL_RUNTIME_OWNER_APPROVED;
  delete process.env.RAILWAY_RUNTIME_URL;
  delete process.env.RAILWAY_RUNTIME_PAID;
  delete process.env.RAILWAY_RUNTIME_OWNER_APPROVED;

  const vercel = vercelRuntimeProviderStatus({ latencyMs: 80 });
  const railway = railwayRuntimeProviderStatus({ latencyMs: 90 });
  const result = await selectRuntimeProvider([adapter(vercel), adapter(railway)], request);

  assert.equal(vercel.runtime_url, "https://dnaos.dev");
  assert.equal(vercel.cost.paid, false);
  assert.equal(vercel.cost.owner_approved, false);
  assert.equal(railway.runtime_url, null);
  assert.equal(railway.availability, "unavailable");
  assert.equal(result.ok, true);
  assert.equal(result.selected_provider_id, "vercel");

  if (originalVercelRuntimeUrl === undefined) delete process.env.VERCEL_RUNTIME_URL;
  else process.env.VERCEL_RUNTIME_URL = originalVercelRuntimeUrl;
  if (originalNextPublicAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl;
  if (originalVercelPaid === undefined) delete process.env.VERCEL_RUNTIME_PAID;
  else process.env.VERCEL_RUNTIME_PAID = originalVercelPaid;
  if (originalVercelOwnerApproved === undefined) delete process.env.VERCEL_RUNTIME_OWNER_APPROVED;
  else process.env.VERCEL_RUNTIME_OWNER_APPROVED = originalVercelOwnerApproved;
  if (originalRailwayRuntimeUrl === undefined) delete process.env.RAILWAY_RUNTIME_URL;
  else process.env.RAILWAY_RUNTIME_URL = originalRailwayRuntimeUrl;
  if (originalRailwayPaid === undefined) delete process.env.RAILWAY_RUNTIME_PAID;
  else process.env.RAILWAY_RUNTIME_PAID = originalRailwayPaid;
  if (originalRailwayOwnerApproved === undefined) delete process.env.RAILWAY_RUNTIME_OWNER_APPROVED;
  else process.env.RAILWAY_RUNTIME_OWNER_APPROVED = originalRailwayOwnerApproved;
}

{
  const result = await selectRuntimeProvider([
    adapter(vercelRuntimeProviderStatus({ runtimeUrl: null, healthy: false, available: false, latencyMs: 0 })),
    adapter(railwayRuntimeProviderStatus({ runtimeUrl: null, healthy: false, available: false, latencyMs: 0 })),
  ], request);

  assert.equal(result.ok, false);
  assert.equal(result.selected_provider_id, null);
  assert.equal(result.runtime_url, null);
  assert.equal(result.requires_owner_approval, false);
}

{
  const vercel = await observeVercelRuntimeProviderStatus(
    { runtimeUrl: "https://vercel.test", paid: false, ownerApproved: true },
    async () => ({ ok: true }),
  );
  const railway = await observeRailwayRuntimeProviderStatus(
    { runtimeUrl: "https://railway.test", paid: false, ownerApproved: true },
    async () => ({ ok: false }),
  );

  assert.equal(vercel.health, "healthy");
  assert.equal(vercel.availability, "available");
  assert.equal(railway.health, "unhealthy");
  assert.equal(railway.availability, "available");
}

console.log("runtime-provider-router-test: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
