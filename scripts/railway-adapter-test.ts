#!/usr/bin/env npx tsx
/**
 * Railway Deployment Adapter — capability-parity acceptance test.
 * Proves the Railway observe adapter (engines/integration-gateway/adapters/
 * railway.ts) normalizes real Railway webhook payloads into the SAME
 * GatewayEvent contract as the existing Vercel adapter, that the gateway
 * surface (gateway/domains.ts) exposes the same preview→token→execute
 * actions for both providers, and that every failure path fails closed.
 * No network, no database, no credentials — pure logic + local token store.
 * Run: npx tsx scripts/railway-adapter-test.ts
 */
import { normalizeRailwayWebhook, railwayWebhookTypeToStatus, isRailwayTerminalStatus } from "@/engines/integration-gateway/adapters/railway";
import { isGatewayEvent } from "@/engines/integration-gateway/contracts/event";
import { ADAPTERS } from "@/engines/integration-gateway/selfDescription";
import * as gatewayDomains from "@/gateway/domains";
import * as railwayBinding from "@/engines/domains/railway-binding";
import { testConnector } from "@/engines/connectors/tester";

let pass = 0;
let fail = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

console.log("\nRailway deployment adapter capability-parity tests\n" + "=".repeat(60));

// 1. Real documented payload shape (docs.railway.com/observability/webhooks)
//    normalizes into the same contract as the Vercel adapter.
const realPayload = {
  type: "Deployment.failed",
  details: {
    id: "8107edff-4b8e-44fc-b43a-04566e847a2a",
    source: "GitHub",
    status: "SUCCESS",
    branch: "main",
    commitHash: "abc1234def5678",
    commitAuthor: "เฮีย",
    commitMessage: "fix: gate",
  },
  resource: {
    workspace: { id: "ws-1", name: "dna-os" },
    project: { id: "prj-1", name: "dna-os-core" },
    environment: { id: "env-1", name: "production", isEphemeral: false },
    service: { id: "svc-1", name: "api" },
    deployment: { id: "dep-1" },
  },
  severity: "WARNING",
  timestamp: "2026-09-18T00:00:00.000Z",
};
const evt = normalizeRailwayWebhook(realPayload);
check("normalizes real payload into a GatewayEvent", evt !== null);
if (evt) {
  check("isGatewayEvent() accepts the normalized event", isGatewayEvent(evt) === true);
  check("provider is railway", evt.provider === "railway");
  check("capability is deployment.status.observed (same contract as Vercel)", evt.capability === "deployment.status.observed");
  check("channel is observe, action is observe", evt.channel === "observe" && evt.action === "observe");
  check("change_id carries the real commitHash", evt.change_id === "abc1234def5678");
  const ev = evt.evidence as Record<string, unknown>;
  check("evidence keeps deployment_id / status / terminal / service / project", ev.deployment_id === "8107edff-4b8e-44fc-b43a-04566e847a2a" && ev.status === "FAILED" && ev.terminal === true && ev.service_name === "api" && ev.project_name === "dna-os-core");
  check("requested_effect is none and no owner approval required (observe-only)", evt.requested_effect === "none" && evt.requires_owner_approval === false);
}

// 2. Status mapping table — real enum members pass through, documented
//    aliases map onto the real family, non-deployment types are dropped.
check("Deployment.success → SUCCESS (terminal)", railwayWebhookTypeToStatus("Deployment.success") === "SUCCESS" && isRailwayTerminalStatus("SUCCESS"));
check("Deployment.building → BUILDING (non-terminal)", railwayWebhookTypeToStatus("Deployment.building") === "BUILDING" && !isRailwayTerminalStatus("BUILDING"));
check("Deployment.started → BUILDING alias", railwayWebhookTypeToStatus("Deployment.started") === "BUILDING");
check("Deployment.crashed → CRASHED (terminal)", railwayWebhookTypeToStatus("Deployment.crashed") === "CRASHED" && isRailwayTerminalStatus("CRASHED"));
check("Deployment.queued → QUEUED (non-terminal)", railwayWebhookTypeToStatus("Deployment.queued") === "QUEUED" && !isRailwayTerminalStatus("QUEUED"));
check("Alert.* / non-deployment types → null", railwayWebhookTypeToStatus("Alert.cpu") === null);
check("unknown Deployment.* suffix → null (honest drop)", railwayWebhookTypeToStatus("Deployment.someNewThing") === null);
check("unknown top-level type → normalize returns null", normalizeRailwayWebhook({ type: "Volume.usage", details: {} }) === null);
check("missing type → normalize returns null", normalizeRailwayWebhook({}) === null);
const bare = normalizeRailwayWebhook({ type: "Deployment.success" });
check("bare payload does not crash and nulls unknown fields", bare !== null && (bare.evidence as Record<string, unknown>).deployment_id === null);

// 3. Vercel adapter is NOT removed — parity, not replacement.
const adapters = Object.fromEntries(ADAPTERS.map((a) => [a.provider, a]));
check("selfDescription still lists vercel", adapters["vercel"]?.ingress === "webhook");
check("selfDescription now lists railway (webhook ingress)", adapters["railway"]?.ingress === "webhook");

// 4. Gateway surface parity: same preview→token→execute actions exist for
//    vercel and railway (surface check only — no network, no credentials).
check("previewVercelDomainAdd / previewRailwayDomainAdd both exist", typeof gatewayDomains.previewVercelDomainAdd === "function" && typeof gatewayDomains.previewRailwayDomainAdd === "function");
check("previewVercelDomainRemove / previewRailwayDomainRemove both exist", typeof gatewayDomains.previewVercelDomainRemove === "function" && typeof gatewayDomains.previewRailwayDomainRemove === "function");

const addPreview = gatewayDomains.previewRailwayDomainAdd("app.example.com");
check("railway.domain.add preview issues a real token", addPreview.ok === true && addPreview.mode === "preview" && addPreview.action === "railway.domain.add" && typeof addPreview.preview_token === "string" && addPreview.preview_token.length > 0);
const removePreview = gatewayDomains.previewRailwayDomainRemove("app.example.com");
check("railway.domain.remove preview issues a real token", removePreview.ok === true && removePreview.action === "railway.domain.remove" && typeof removePreview.preview_token === "string");

// 5. Fail-closed: executing with a wrong/forged token is rejected before
//    any adapter call (no connector lookup, no network).
async function main() {
  const forged = await gatewayDomains.executeRailwayDomainAdd("forged-token");
  check("executeRailwayDomainAdd with forged token fails closed", forged.ok === false && typeof forged.error === "string" && forged.error.includes("preview_token"));
  const forgedRemove = await gatewayDomains.executeRailwayDomainRemove("forged-token");
  check("executeRailwayDomainRemove with forged token fails closed", forgedRemove.ok === false && typeof forgedRemove.error === "string");

  // 6. Resource discovery (STEP 4 — the system finds Project/Service/
  //    Environment ids; the owner only selects) + the Railway-shaped
  //    connector test path.
  check("discoverResources() exists as the canonical discovery function", typeof railwayBinding.discoverResources === "function");
  // Fail-closed proof without depending on live network: an unroutable
  // endpoint must yield a clean failed TestResult, never a fabricated pass.
  const dead = await testConnector("token", { base_url: "https://127.0.0.1:9/graphql/v2" }, { token: "test-token" });
  check("Railway-shaped tester fails closed on unreachable endpoint", dead.ok === false && typeof dead.error === "string");

  console.log("\n" + "=".repeat(60));
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
