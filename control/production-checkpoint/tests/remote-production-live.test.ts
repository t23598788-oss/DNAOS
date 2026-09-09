/**
 * REMOTE_PRODUCTION_LIVE — PROVIDER_REQUIRED. Not source admission.
 *
 * How to run:
 *   npx tsx control/production-checkpoint/tests/remote-production-live.test.ts
 */

import { discoverExistingRemoteProduction } from "../contract";

declare const process: { exit: (code: number) => void };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

async function main(): Promise<void> {
  try {
    const report = await discoverExistingRemoteProduction();
    if (!report.GITHUB_AUTHENTICATION_READY) {
      console.log("REMOTE_PRODUCTION_LIVE=AUTH_REQUIRED");
      console.log("AUTH_REQUIRED GitHub authenticated read is not ready");
      process.exit(3);
    }
    if (report.EXISTING_REMOTE_DISCOVERY_FIRST === true && report.resources.length >= 1) {
      console.log("REMOTE_PRODUCTION_LIVE=VERIFIED");
      process.exit(0);
    }
    console.log("REMOTE_PRODUCTION_LIVE=NOT_AVAILABLE");
    console.log("NOT_AVAILABLE remote production resources not listed");
    process.exit(4);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/auth|401|unauthorized|credential|token/i.test(detail)) {
      console.log("REMOTE_PRODUCTION_LIVE=AUTH_REQUIRED");
      console.log(`AUTH_REQUIRED ${detail}`);
      process.exit(3);
    }
    console.error(`REMOTE_PRODUCTION_LIVE=FAILED ${detail}`);
    process.exit(1);
  }
}

void main();
