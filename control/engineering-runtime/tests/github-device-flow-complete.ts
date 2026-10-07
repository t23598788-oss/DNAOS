/**
 * Complete a pending GitHub Device Flow after Owner browser approval.
 * Prints authorization state and GitHub login only — never an access token.
 *
 * How to run:
 *   npx tsx control/engineering-runtime/tests/github-device-flow-complete.ts <connection_id>
 */

import { completeAuthorization } from "../../../connections/provider-authorization/contract";

declare const process: { argv: string[]; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

async function main(): Promise<void> {
  const connection_id = process.argv[2];
  if (!connection_id) {
    console.log(JSON.stringify({ ok: false, reason_code: "MISSING_CONNECTION_ID" }));
    process.exit(2);
  }
  const result = await completeAuthorization(connection_id);
  if (!result.ok) {
    console.log(JSON.stringify({
      ok: false,
      reason_code: result.reason_code,
      detail: result.detail,
      authorization_state: result.record?.state ?? null,
      credential_ref: result.record?.credential_ref ?? null,
    }, null, 2));
    process.exit(2);
  }
  console.log(JSON.stringify({
    ok: true,
    OWNER_DEVICE_FLOW_COMPLETED: true,
    CREDENTIAL_KEYCHAIN_BOUND: result.record.credential_ref === "credential://github/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/source-authority",
    credential_ref: result.record.credential_ref,
    authorization_state: result.record.state,
    github_login: result.account_verification.login,
    granted_scope: result.record.granted_scope,
  }, null, 2));
  process.exit(0);
}

void main();
