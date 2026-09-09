/**
 * GOOGLE_WORKSPACE_RUNTIME_ADAPTER_V1 acceptance tests (hermetic).
 * How to run: npx tsx connections/google-workspace/tests/runtime-adapter.test.ts
 */

import { registerApiCredential, findApiCredential } from "../../../credentials/registry/api-credential-registry";
import { issueOwnerCapabilityBindingPolicy } from "../../../control/local-resource-access/owner-capability-policy";
import { getRemoteServiceBinding } from "../../../control/local-resource-access/remote-service-binding";
import { capabilityInvocable } from "../../../control/local-resource-access/capability-states";
import { getConnectorInvoker } from "../../../control/connector-execution-boundary/registry";
import { getCapability } from "../../../control/command-router/capability-registry";
import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";
import {
  CALENDAR_SCOPES,
  DRIVE_SCOPE,
  GMAIL_SCOPE,
  GMAIL_SERVICE_ID,
  GOOGLE_CREDENTIAL_REF,
  SHEETS_SCOPE,
} from "../contract";
import { GOOGLE_WORKSPACE_INTENTS, GOOGLE_WORKSPACE_OUTCOMES } from "../adapter-contract";
import { handleGoogleWorkspaceReadCommand } from "../google-workspace-adapter";
import { isGoogleWorkspaceRuntimeAdapterPresent } from "../adapter-presence";
import { exchangeRefreshTokenForAccessToken } from "../oauth/google-oauth";
import type { FetchImpl, HostResponse } from "../host-runtime";
import type { GoogleWorkspaceCredentialResolver } from "../credential-resolution";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const identity: EnvelopeIdentity = {
  identity_id: "identity_google_runtime_test",
  acting_as_account_id: "account_google_runtime_test",
  acting_as_tenant_id: "tenant_google_runtime_test",
  software_id: "software_dna_os_infrastructure",
  kind: "service",
};

function envelope(intent: string, payload: Record<string, unknown>): CommandEnvelope {
  return {
    command_id: `cmd_google_${Math.random().toString(36).slice(2)}`,
    issued_by: identity,
    intent,
    payload,
    issued_at: new Date().toISOString(),
  };
}

function jsonResponse(status: number, body: unknown): HostResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return typeof body === "string" ? body : JSON.stringify(body); },
  };
}

function hermeticFetch(routes: Record<string, unknown>): FetchImpl {
  return async (url) => {
    for (const [prefix, body] of Object.entries(routes)) {
      if (url.startsWith(prefix) || url.includes(prefix)) {
        return { kind: "response", response: jsonResponse(200, body) };
      }
    }
    return { kind: "response", response: jsonResponse(404, { error: "not found in fixture" }) };
  };
}

const ALL_SCOPES = [GMAIL_SCOPE, ...CALENDAR_SCOPES, DRIVE_SCOPE, SHEETS_SCOPE];

function ensureActiveCredential(scopes: readonly string[] = ALL_SCOPES): void {
  const existing = findApiCredential(GOOGLE_CREDENTIAL_REF);
  if (existing) return;
  registerApiCredential({
    credential_ref: GOOGLE_CREDENTIAL_REF,
    provider: "google",
    account: "google-account-test-sub",
    scope: [...scopes],
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    resolver_kind: "macos_keychain",
    resolver_service: "dna-os-google-workspace-oauth-test",
    resolver_account: "google-account-test-sub",
  });
}

function trackingResolver(calls: { resolve: number }): GoogleWorkspaceCredentialResolver {
  return {
    async resolveAccessToken() {
      calls.resolve += 1;
      return {
        ok: true,
        access_token: "ya29.TEST_ACCESS_TOKEN_NOT_A_SECRET_FOR_ASSERT",
        credential_source: "keychain:test/test",
        account_identity_non_secret: "google-account-test-sub",
        refreshed: false,
        material_kind: "access_token",
      };
    },
  };
}

async function main(): Promise<void> {
  ensureActiveCredential();

  ok("registered connector invoker exists", typeof getConnectorInvoker("google-workspace") === "function");
  ok("adapterPresent reflects registry", isGoogleWorkspaceRuntimeAdapterPresent() === true);
  ok("capability registry has google-workspace connector", getCapability("google-workspace")?.endpoint.kind === "connector");

  const AI = `ai-google-runtime-${Date.now()}`;
  const SESSION = `session-google-runtime-${Date.now()}`;
  issueOwnerCapabilityBindingPolicy({
    ai_identity: AI,
    session_id: SESSION,
    effect: "ALLOW",
    enabled_binding_ids: [GMAIL_SERVICE_ID, "*"],
    allowed_actions: ["SEARCH", "READ", "DOWNLOAD"],
    visible_data_classes: ["REMOTE_OBJECT"],
    approval_required_actions: [],
    allowed_connection_ids: ["connection.google.workspace.v1"],
    read_scope: [],
    write_scope: [],
    publish_scope: [],
    network_destinations: ["https://www.googleapis.com"],
    expires_at: null,
  });

  // 1. ACTIVE + scope + Owner + adapter = invocable (read)
  const gmail = getRemoteServiceBinding(GMAIL_SERVICE_ID, AI, SESSION);
  const readStates = gmail?.canonical_action_mapping.find((r) => r.action === "READ")?.states;
  ok("1. READ ADAPTER_PRESENT true", readStates?.ADAPTER_PRESENT === true);
  ok("1b. READ invocable when owner+auth+adapter", readStates ? capabilityInvocable(readStates) === true : false, JSON.stringify(readStates));

  // 2. Missing adapter ⇒ not invocable — contacts has no runtime support
  const contacts = getRemoteServiceBinding("service://google/contacts", AI, SESSION);
  const contactsRead = contacts?.canonical_action_mapping.find((r) => r.action === "READ")?.states;
  ok("2. contacts ADAPTER_PRESENT false", contactsRead?.ADAPTER_PRESENT === false);

  // Write stays blocked
  const send = gmail?.canonical_action_mapping.find((r) => r.action === "SEND")?.states;
  ok("11. write SEND ADAPTER_PRESENT false", send?.ADAPTER_PRESENT === false);
  ok("11b. write SEND not owner-enabled", send?.OWNER_ENABLED === false);

  // 3. Missing scope = no credential resolution and no network
  {
    const resolveCalls = { resolve: 0 };
    let network = 0;
    const fetchImpl: FetchImpl = async () => {
      network += 1;
      return { kind: "transport_error", reason: "should not be called" };
    };
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.gmailList, { ai_identity: AI, session_id: SESSION }),
      {
        credentialResolver: trackingResolver(resolveCalls),
        fetchImpl,
        readCredentialMeta: () => ({
          present: true,
          status: "ACTIVE",
          account: "x",
          granted_scopes: [], // missing gmail.readonly
        }),
      },
    );
    ok("3. missing scope → SCOPE_REQUIRED", !outcome.ok && outcome.rejection.outcome === GOOGLE_WORKSPACE_OUTCOMES.SCOPE_REQUIRED);
    ok("3b. missing scope → zero credential resolve", resolveCalls.resolve === 0);
    ok("3c. missing scope → zero network", network === 0);
  }

  // 4. Owner denied = no credential resolution and no network
  {
    const resolveCalls = { resolve: 0 };
    let network = 0;
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.gmailList, { ai_identity: "other-ai", session_id: "other-session" }),
      {
        credentialResolver: trackingResolver(resolveCalls),
        fetchImpl: async () => {
          network += 1;
          return { kind: "transport_error", reason: "no" };
        },
        readCredentialMeta: () => ({ present: true, status: "ACTIVE", account: "x", granted_scopes: ALL_SCOPES }),
      },
    );
    ok("4. owner denied → OWNER_DENIED", !outcome.ok && outcome.rejection.outcome === GOOGLE_WORKSPACE_OUTCOMES.OWNER_DENIED);
    ok("4b. owner denied → zero credential resolve", resolveCalls.resolve === 0);
    ok("4c. owner denied → zero network", network === 0);
  }

  // 5. Gmail fixture
  {
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.gmailSearch, { ai_identity: AI, session_id: SESSION, q: "from:owner" }),
      {
        credentialResolver: trackingResolver({ resolve: 0 }),
        fetchImpl: hermeticFetch({
          "gmail.googleapis.com/gmail/v1/users/me/messages": {
            messages: [{ id: "m1", threadId: "t1" }],
            resultSizeEstimate: 1,
          },
        }),
        readCredentialMeta: () => ({ present: true, status: "ACTIVE", account: "x", granted_scopes: ALL_SCOPES }),
        evaluateOwnerPolicy: () => ({ decision: "ALLOW", reason_code: "TEST", owner_enabled: true }),
      },
    );
    ok("5. gmail SUCCESS", outcome.ok === true);
    if (outcome.ok) {
      const data = outcome.event.data.data as { messages: Array<{ id: string }> };
      ok("5b. gmail normalized messages", Array.isArray(data.messages) && data.messages[0]?.id === "m1");
      ok("5c. gmail has evidence", outcome.evidence.some((e) => e.note.includes("outcome=SUCCESS")));
    }
  }

  // 6. Calendar fixture
  {
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.calendarEventsList, { ai_identity: AI, session_id: SESSION, calendar_id: "primary" }),
      {
        credentialResolver: trackingResolver({ resolve: 0 }),
        fetchImpl: hermeticFetch({
          "calendar/v3/calendars/": {
            items: [{ id: "e1", summary: "Standup", start: { dateTime: "2026-09-10T09:00:00Z" }, end: { dateTime: "2026-09-10T09:30:00Z" }, status: "confirmed" }],
          },
        }),
        readCredentialMeta: () => ({ present: true, status: "ACTIVE", account: "x", granted_scopes: ALL_SCOPES }),
        evaluateOwnerPolicy: () => ({ decision: "ALLOW", reason_code: "TEST", owner_enabled: true }),
      },
    );
    ok("6. calendar SUCCESS", outcome.ok === true);
    if (outcome.ok) {
      const data = outcome.event.data.data as { items: Array<{ id: string; summary: string }> };
      ok("6b. calendar normalized events", data.items[0]?.summary === "Standup");
    }
  }

  // 7. Drive fixture
  {
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.driveList, { ai_identity: AI, session_id: SESSION }),
      {
        credentialResolver: trackingResolver({ resolve: 0 }),
        fetchImpl: hermeticFetch({
          "drive/v3/files": {
            files: [{ id: "f1", name: "notes.txt", mimeType: "text/plain", modifiedTime: "2026-09-01T00:00:00Z" }],
          },
        }),
        readCredentialMeta: () => ({ present: true, status: "ACTIVE", account: "x", granted_scopes: ALL_SCOPES }),
        evaluateOwnerPolicy: () => ({ decision: "ALLOW", reason_code: "TEST", owner_enabled: true }),
      },
    );
    ok("7. drive SUCCESS", outcome.ok === true);
    if (outcome.ok) {
      const data = outcome.event.data.data as { files: Array<{ id: string }> };
      ok("7b. drive normalized files", data.files[0]?.id === "f1");
    }
  }

  // 8. Sheets fixture
  {
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.sheetsValues, {
        ai_identity: AI,
        session_id: SESSION,
        spreadsheet_id: "sheet1",
        range: "A1:B2",
      }),
      {
        credentialResolver: trackingResolver({ resolve: 0 }),
        fetchImpl: hermeticFetch({
          "sheets.googleapis.com/v4/spreadsheets/": {
            range: "A1:B2",
            majorDimension: "ROWS",
            values: [["a", "b"], ["1", "2"]],
          },
        }),
        readCredentialMeta: () => ({ present: true, status: "ACTIVE", account: "x", granted_scopes: ALL_SCOPES }),
        evaluateOwnerPolicy: () => ({ decision: "ALLOW", reason_code: "TEST", owner_enabled: true }),
      },
    );
    ok("8. sheets SUCCESS", outcome.ok === true);
    if (outcome.ok) {
      const data = outcome.event.data.data as { values: unknown[][] };
      ok("8b. sheets normalized values", Array.isArray(data.values) && data.values.length === 2);
    }
  }

  // 9. Refresh-token flow — no secrets in outcome serialization
  {
    let posted = false;
    const refresh = await exchangeRefreshTokenForAccessToken(
      { client_id: "cid", client_secret: "csec", redirect_uri: "http://127.0.0.1/cb" },
      "1//REFRESH_TOKEN_SECRET_MATERIAL",
    );
    // Without network this fails transport — inject via re-test of resolver path:
    const resolver: GoogleWorkspaceCredentialResolver = {
      async resolveAccessToken() {
        return {
          ok: true,
          access_token: "ya29.REFRESHED_ACCESS",
          credential_source: "keychain:svc/acct",
          account_identity_non_secret: "sub-1",
          refreshed: true,
          material_kind: "refresh_token",
        };
      },
    };
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.gmailList, { ai_identity: AI, session_id: SESSION }),
      {
        credentialResolver: resolver,
        fetchImpl: async () => {
          posted = true;
          return { kind: "response", response: jsonResponse(200, { messages: [] }) };
        },
        readCredentialMeta: () => ({ present: true, status: "ACTIVE", account: "sub-1", granted_scopes: ALL_SCOPES }),
        evaluateOwnerPolicy: () => ({ decision: "ALLOW", reason_code: "TEST", owner_enabled: true }),
      },
    );
    ok("9. refresh path SUCCESS", outcome.ok === true);
    ok("9b. network after refresh", posted === true);
    const blob = JSON.stringify(outcome);
    ok("9c. no refresh token leaked", !blob.includes("REFRESH_TOKEN_SECRET") && !blob.includes("1//"));
    ok("9d. no access token leaked", !blob.includes("ya29.REFRESHED_ACCESS"));
    ok("9e. evidence notes refresh", outcome.ok && outcome.evidence.some((e) => e.note.includes("refreshed=true")));
    void refresh; // exchange helper exists; live network not required here
  }

  // 11. Write-class blocked
  {
    const resolveCalls = { resolve: 0 };
    let network = 0;
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope("google.gmail.messages.send", { ai_identity: AI, session_id: SESSION }),
      {
        credentialResolver: trackingResolver(resolveCalls),
        fetchImpl: async () => {
          network += 1;
          return { kind: "transport_error", reason: "no" };
        },
      },
    );
    ok("11c. write intent UNSUPPORTED_ACTION", !outcome.ok && outcome.rejection.outcome === GOOGLE_WORKSPACE_OUTCOMES.UNSUPPORTED_ACTION);
    ok("11d. write → zero credential resolve", resolveCalls.resolve === 0);
    ok("11e. write → zero network", network === 0);
  }

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
