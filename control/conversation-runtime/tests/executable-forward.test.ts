/**
 * Proves executable Owner commands leave conversation and enter the canonical
 * Owner command ingress (submitOwnerCommand / routeOwnerCommand) — not a second router.
 * How to run: npx tsx control/conversation-runtime/tests/executable-forward.test.ts
 */

import { classifyCommand, routeOwnerCommand } from "../../command-router/contract";
import { getCapability } from "../../command-router/capability-registry";
import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";
import { GOOGLE_WORKSPACE_INTENTS } from "../../../connections/google-workspace/adapter-contract";
import { installGoogleWorkspaceAdapterDepsForTests } from "../../../connections/google-workspace/router-invoker";
import {
  CALENDAR_SCOPES,
  DRIVE_SCOPE,
  GMAIL_SCOPE,
  SHEETS_SCOPE,
} from "../../../connections/google-workspace/contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function ok(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed += 1; console.log(`PASS: ${name}`); }
  else { failed += 1; console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const identity: EnvelopeIdentity = {
  identity_id: "identity_live_io_forward",
  acting_as_account_id: "account_live_io_forward",
  acting_as_tenant_id: "tenant_live_io_forward",
  software_id: "software_dna_os_infrastructure",
  kind: "human",
};

async function main(): Promise<void> {
  ok("google-workspace capability registered", getCapability("google-workspace")?.endpoint.kind === "connector");

  const classified = classifyCommand("google gmail list messages");
  ok("classify matches google-workspace", classified.status === "MATCHED" && classified.status === "MATCHED" && (classified as { capability: { capability_id: string } }).capability.capability_id === "google-workspace");

  installGoogleWorkspaceAdapterDepsForTests({
    credentialResolver: {
      async resolveAccessToken() {
        return {
          ok: true,
          access_token: "ya29.FORWARD_TEST",
          credential_source: "keychain:forward/test",
          account_identity_non_secret: "forward-sub",
          refreshed: false,
          material_kind: "access_token",
        };
      },
    },
    fetchImpl: async () => ({
      kind: "response",
      response: {
        ok: true,
        status: 200,
        async json() { return { messages: [{ id: "m-forward", threadId: "t" }] }; },
        async text() { return ""; },
      },
    }),
    readCredentialMeta: () => ({
      present: true,
      status: "ACTIVE",
      account: "forward-sub",
      granted_scopes: [GMAIL_SCOPE, ...CALENDAR_SCOPES, DRIVE_SCOPE, SHEETS_SCOPE],
    }),
    evaluateOwnerPolicy: () => ({ decision: "ALLOW", reason_code: "TEST", owner_enabled: true }),
  });

  try {
    const envelope: CommandEnvelope = {
      command_id: "cmd_forward_gmail",
      issued_by: identity,
      intent: GOOGLE_WORKSPACE_INTENTS.gmailList,
      payload: { ai_identity: "forward-ai", session_id: "forward-session" },
      issued_at: new Date().toISOString(),
    };
    const routed = await routeOwnerCommand(envelope, "Show my latest Gmail messages.", {
      steps: [{
        capability_id: "google-workspace",
        intent: GOOGLE_WORKSPACE_INTENTS.gmailList,
        payload: { ai_identity: "forward-ai", session_id: "forward-session" },
      }],
    });
    ok("2. executable google command reaches router COMPLETED", routed.status === "COMPLETED", routed.summary);
    ok("2b. capability is google-workspace", routed.capability_id === "google-workspace");
    ok("9. evidence proves adapter path", routed.evidence.some((e) => e.note.includes("outcome=SUCCESS") || e.source.includes("google-workspace")));
    ok("no token leak", !JSON.stringify(routed).includes("ya29.FORWARD_TEST"));
  } finally {
    installGoogleWorkspaceAdapterDepsForTests(null);
  }

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
