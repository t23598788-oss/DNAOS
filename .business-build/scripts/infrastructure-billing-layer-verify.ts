/**
 * Infrastructure Control & Billing Layer — Verification (owner,
 * 2026-08-10). Real, read-only smoke check across the 4 new runtime
 * modules this build added (providerRegistryRuntime.ts,
 * computeResourceRegistryRuntime.ts, costLedgerViewRuntime.ts —
 * usageMeterRuntime.ts is exercised separately by
 * digitalocean-worker-live-test.ts since it needs a real DB write).
 * Confirms the real join/derivation logic runs without error against
 * the real, current registry state — not a mock.
 *
 * Run: npx tsx scripts/infrastructure-billing-layer-verify.ts
 */
import { listProviderRegistry } from "../app/api/admin/ide/_lib/providerRegistryRuntime";
import { listComputeResources } from "../app/api/admin/ide/_lib/computeResourceRegistryRuntime";
import { listCostLedgerWithMargin, listProviderPayables } from "../app/api/admin/ide/_lib/costLedgerViewRuntime";

async function main() {
  const providers = await listProviderRegistry();
  console.log(`Real providers joined: ${providers.length}`);
  const digitalocean = providers.find((p) => p.provider === "digitalocean");
  if (!digitalocean) throw new Error("FAIL — digitalocean not found in the real Provider Registry join");
  console.log("\ndigitalocean Provider Registry entry:");
  console.log(JSON.stringify(digitalocean, null, 2));

  const resources = listComputeResources();
  console.log(`\nReal Compute Resource Registry entries: ${resources.length} (expected 0 — no live provider query made this build)`);

  const ledger = await listCostLedgerWithMargin();
  console.log(`Real Cost Ledger entries (with derived margin/THB): ${ledger.length}`);

  const payables = listProviderPayables();
  console.log(`Real Provider Payables computed: ${payables.length}`);

  console.log("\nPASS — all 3 new runtime modules ran against real, current repo state without error.");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
