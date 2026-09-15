import assert from "node:assert/strict";
import { activateStandbyConnect } from "../engines/integration-gateway/connect-failover";
import type { ExternalConnectAdapter, ExternalConnectStatus } from "../engines/integration-gateway/contracts/external-connect";
import { DNA_OS_RUNTIME_STATE_BOUNDARY } from "../engines/integration-gateway/contracts/runtime-provider";

const releaseSha = "release-test-sha";

function status(overrides: Partial<ExternalConnectStatus> = {}): ExternalConnectStatus {
  return {
    provider_id: "railway",
    installed: true,
    ready: false,
    release_version: null,
    runtime: {
      provider_id: "railway",
      availability: "available",
      health: "healthy",
      latency_ms: 10,
      cost: { paid: false, owner_approved: false, requires_owner_approval: false },
      runtime_url: "https://runtime.test",
      capabilities: ["runtime.render", "runtime.display"],
      state_boundary: DNA_OS_RUNTIME_STATE_BOUNDARY,
    },
    ...overrides,
  };
}

const request = { release_sha: releaseSha, required_capabilities: ["runtime.render"], max_latency_ms: 3000, allow_paid_providers: true };

{
  let activated = false;
  const adapter: ExternalConnectAdapter = {
    provider_id: "railway",
    observeConnectStatus: () => status({ installed: false }),
    activateRelease: () => { activated = true; return { ok: true }; },
  };
  const result = await activateStandbyConnect(adapter, request);
  assert.equal(result.code, "EXTERNAL_CONNECT_NOT_INSTALLED");
  assert.equal(activated, false);
}

{
  let activated = false;
  const paid = status();
  paid.runtime.cost = { paid: true, owner_approved: false, requires_owner_approval: true };
  const adapter: ExternalConnectAdapter = {
    provider_id: "railway",
    observeConnectStatus: () => paid,
    activateRelease: () => { activated = true; return { ok: true }; },
  };
  const result = await activateStandbyConnect(adapter, request);
  assert.equal(result.code, "OWNER_APPROVAL_REQUIRED");
  assert.equal(activated, false);
}

{
  let observations = 0;
  let authority: string | null = null;
  const adapter: ExternalConnectAdapter = {
    provider_id: "railway",
    observeConnectStatus: () => ++observations === 1 ? status() : status({ ready: true, release_version: releaseSha }),
    activateRelease: (activation) => { authority = activation.authority; return { ok: true }; },
  };
  const result = await activateStandbyConnect(adapter, request);
  assert.equal(authority, "dna-os");
  assert.equal(result.ok, true);
  assert.equal(result.runtime_url, "https://runtime.test");
}

{
  let observations = 0;
  const adapter: ExternalConnectAdapter = {
    provider_id: "railway",
    observeConnectStatus: () => ++observations === 1 ? status() : status({ ready: true, release_version: "wrong-release" }),
    activateRelease: () => ({ ok: true }),
  };
  const result = await activateStandbyConnect(adapter, request);
  assert.equal(result.code, "EXTERNAL_CONNECT_RELEASE_MISMATCH");
  assert.equal(result.runtime_url, null);
}

console.log("external-connect-failover-test: PASS");
