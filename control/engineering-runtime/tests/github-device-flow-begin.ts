/**
 * Start canonical GitHub Device Flow. Prints verification URI and user
 * code only — never an access token.
 *
 * How to run:
 *   npx tsx control/engineering-runtime/tests/github-device-flow-begin.ts
 */

import { beginAuthorization } from "../../../connections/provider-authorization/contract";

declare const process: { cwd(): string; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

async function main(): Promise<void> {
  const begin = await beginAuthorization({ provider: "github", cwd: process.cwd() });
  const configured = begin.ok || begin.reason_code !== "GITHUB_OAUTH_CLIENT_ID_NOT_CONFIGURED";
  const report = begin.ok
    ? {
      DEVICE_FLOW_AVAILABLE: true,
      GITHUB_OAUTH_CLIENT_ID_CONFIGURED: true,
      CLIENT_ID_SOURCE: "software/provider-project-registry identifiers.oauth_app_client_id",
      OWNER_DEVICE_FLOW_STATE: "OWNER_AUTHORIZATION_PENDING",
      connection_id: begin.connection_id,
      verification_uri: begin.verification_uri,
      user_code: begin.user_code,
      expires_in: begin.expires_in,
      interval: begin.interval,
    }
    : {
      DEVICE_FLOW_AVAILABLE: configured,
      GITHUB_OAUTH_CLIENT_ID_CONFIGURED: configured,
      CLIENT_ID_SOURCE: configured ? "software/provider-project-registry identifiers.oauth_app_client_id" : "absent",
      OWNER_DEVICE_FLOW_STATE: "BLOCKED",
      reason_code: begin.reason_code,
      detail: begin.detail,
    };
  console.log(JSON.stringify(report, null, 2));
  process.exit(begin.ok ? 0 : 2);
}

void main();
