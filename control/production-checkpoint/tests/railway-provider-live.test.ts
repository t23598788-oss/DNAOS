/**
 * RAILWAY_PROVIDER_LIVE_TEST — PROVIDER_REQUIRED. Not source admission.
 *
 * How to run:
 *   npx tsx control/production-checkpoint/tests/railway-provider-live.test.ts
 */

import { resolveExistingRailwayServices, verifyRailwayDeployAdapter } from "../contract";

declare const process: { exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

async function main(): Promise<void> {
  try {
    const adapter = await verifyRailwayDeployAdapter();
    if (!adapter.RAILWAY_DEPLOY_AUTH_READY) {
      console.log("RAILWAY_PROVIDER_LIVE=AUTH_REQUIRED");
      console.log("AUTH_REQUIRED Railway deploy auth is not ready");
      process.exit(3);
    }
    const identities = await resolveExistingRailwayServices();
    const names = identities.services.map((row) => row.name);
    if (names.includes("dna-os-circuit") && identities.services.some((row) => row.service_id !== null)) {
      console.log("RAILWAY_PROVIDER_LIVE=VERIFIED");
      process.exit(0);
    }
    console.log("RAILWAY_PROVIDER_LIVE=NOT_AVAILABLE");
    console.log("NOT_AVAILABLE expected Railway services missing from provider listing");
    process.exit(4);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/auth|401|unauthorized|credential|token/i.test(detail)) {
      console.log("RAILWAY_PROVIDER_LIVE=AUTH_REQUIRED");
      console.log(`AUTH_REQUIRED ${detail}`);
      process.exit(3);
    }
    console.error(`RAILWAY_PROVIDER_LIVE=FAILED ${detail}`);
    process.exit(1);
  }
}

void main();
