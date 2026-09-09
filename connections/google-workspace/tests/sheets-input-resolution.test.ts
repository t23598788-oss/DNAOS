/**
 * SHEETS_LIVE_READ_INPUT_RESOLUTION_V1 acceptance tests (hermetic).
 * How to run: npx tsx connections/google-workspace/tests/sheets-input-resolution.test.ts
 */

import { issueOwnerCapabilityBindingPolicy } from "../../../control/local-resource-access/owner-capability-policy";
import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";
import {
  DRIVE_SCOPE,
  DRIVE_SERVICE_ID,
  GMAIL_SERVICE_ID,
  SHEETS_SCOPE,
  SHEETS_SERVICE_ID,
} from "../contract";
import { GOOGLE_WORKSPACE_INTENTS, GOOGLE_WORKSPACE_OUTCOMES } from "../adapter-contract";
import { handleGoogleWorkspaceReadCommand } from "../google-workspace-adapter";
import { parseSheetsOwnerText } from "../sheets-owner-text";
import { googleWorkspaceWriteIntents } from "../google-workspace-adapter";
import type { FetchImpl, HostResponse } from "../host-runtime";
import type { GoogleWorkspaceCredentialResolver } from "../credential-resolution";

type CredentialMeta = {
  present: boolean;
  status: string | null;
  account: string | null;
  granted_scopes: readonly string[];
};

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
  identity_id: "identity_sheets_resolution_test",
  acting_as_account_id: "account_sheets_resolution_test",
  acting_as_tenant_id: "tenant_sheets_resolution_test",
  software_id: "software_dna_os_infrastructure",
  kind: "service",
};

function envelope(intent: string, payload: Record<string, unknown>): CommandEnvelope {
  return {
    command_id: `cmd_sheets_${Math.random().toString(36).slice(2)}`,
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

function hermeticFetch(router: (url: string) => unknown | null): FetchImpl {
  return async (url) => {
    const body = router(url);
    if (body === null) return { kind: "response", response: jsonResponse(404, { error: "fixture miss" }) };
    return { kind: "response", response: jsonResponse(200, body) };
  };
}

function issuePolicy(ai: string, session: string, bindings: string[]): void {
  issueOwnerCapabilityBindingPolicy({
    ai_identity: ai,
    session_id: session,
    effect: "ALLOW",
    enabled_binding_ids: bindings,
    allowed_actions: ["SEARCH", "READ", "DOWNLOAD"],
    visible_data_classes: ["REMOTE_OBJECT"],
    approval_required_actions: [],
    allowed_connection_ids: ["connection.google.workspace.v1"],
    read_scope: [],
    write_scope: [],
    publish_scope: [],
    network_destinations: ["https://www.googleapis.com", "https://sheets.googleapis.com"],
    expires_at: null,
  });
}

function resolver(): GoogleWorkspaceCredentialResolver {
  return {
    async resolveAccessToken() {
      return {
        ok: true,
        access_token: "test-access-token-not-a-secret-fixture",
        credential_source: "hermetic:fixture",
        account_identity_non_secret: "fixture-account",
        refreshed: false,
      };
    },
  };
}

async function main(): Promise<void> {
  // Parse unit checks
  {
    const p = parseSheetsOwnerText("Read values from spreadsheet ID abcdefghijklmnopqrstuvwxyz012345, range Sheet1!A1:D20.");
    ok("parse explicit id", p.spreadsheet_id === "abcdefghijklmnopqrstuvwxyz012345");
    ok("parse explicit range preserved", p.range === "Sheet1!A1:D20");
  }
  {
    const p = parseSheetsOwnerText("Read Sheet1 from spreadsheet Budget 2026.");
    ok("parse sheet tab", p.sheet_tab === "Sheet1");
    ok("parse spreadsheet name", p.spreadsheet_name === "Budget 2026");
  }
  {
    const p = parseSheetsOwnerText("Read A1:D20 from spreadsheet Budget.");
    ok("parse bare A1 range", p.range === "A1:D20");
    ok("parse name with A1", (p.spreadsheet_name || "").includes("Budget"));
  }

  const AI = `ai-sheets-res-${Date.now()}`;
  const SESSION = `session-sheets-res-${Date.now()}`;
  issuePolicy(AI, SESSION, [SHEETS_SERVICE_ID, DRIVE_SERVICE_ID, GMAIL_SERVICE_ID, "*"]);

  let resolveCalls = 0;
  const countingResolver: GoogleWorkspaceCredentialResolver = {
    async resolveAccessToken() {
      resolveCalls += 1;
      return resolver().resolveAccessToken();
    },
  };

  // 1. Explicit spreadsheet_id + range → success, no Drive search
  {
    let driveHits = 0;
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.sheetsValues, {
        ai_identity: AI,
        session_id: SESSION,
        spreadsheet_id: "ssid_explicit",
        range: "Sheet1!A1:B2",
      }),
      {
        credentialResolver: countingResolver,
        readCredentialMeta: () => ({
          present: true,
          status: "ACTIVE",
          granted_scopes: [SHEETS_SCOPE, DRIVE_SCOPE],
        }),
        fetchImpl: hermeticFetch((url) => {
          if (url.includes("/drive/")) { driveHits += 1; return { files: [] }; }
          if (url.includes("/values/")) return { range: "Sheet1!A1:B2", majorDimension: "ROWS", values: [["a", "b"], ["c", "d"]] };
          return null;
        }),
      },
    );
    ok("1. explicit id+range SUCCESS", outcome.ok === true);
    ok("1b. no Drive discovery", driveHits === 0);
    if (outcome.ok) {
      const data = outcome.event.data.data as { values: unknown[][] };
      ok("1c. values returned", data.values.length === 2);
    }
  }

  // 2. Unique spreadsheet name → Drive → Sheets values
  {
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.sheetsValues, {
        ai_identity: AI,
        session_id: SESSION,
        owner_text: "Read values from spreadsheet Unique Budget.",
      }),
      {
        credentialResolver: resolver(),
        readCredentialMeta: () => ({
          present: true,
          status: "ACTIVE",
          granted_scopes: [SHEETS_SCOPE, DRIVE_SCOPE],
        }),
        fetchImpl: hermeticFetch((url) => {
          if (url.includes("/drive/v3/files")) {
            return {
              files: [{ id: "ssid_unique", name: "Unique Budget", mimeType: "application/vnd.google-apps.spreadsheet", modifiedTime: "2026-09-01T00:00:00Z" }],
            };
          }
          if (url.includes("/spreadsheets/ssid_unique") && !url.includes("/values/")) {
            return { spreadsheetId: "ssid_unique", sheets: [{ properties: { title: "Data" } }] };
          }
          if (url.includes("/values/")) {
            return { range: "Data", majorDimension: "ROWS", values: [[1], [2], [3]] };
          }
          return null;
        }),
      },
    );
    ok("2. unique name SUCCESS", outcome.ok === true, outcome.ok ? "" : outcome.rejection.reason);
    ok("2b. drive discovery evidenced", outcome.evidence.some((e) => String(e.note).includes("drive_discovery") || String(e.source).includes("sheets_input")));
    if (outcome.ok) {
      const data = outcome.event.data.data as { values: unknown[][]; range: string };
      ok("2c. unique sheet used as range", data.range === "Data" && data.values.length === 3);
    }
  }

  // 3. Multiple matches → clarification, no values call
  {
    let valuesHits = 0;
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.sheetsValues, {
        ai_identity: AI,
        session_id: SESSION,
        owner_text: "Read values from spreadsheet Report.",
      }),
      {
        credentialResolver: resolver(),
        readCredentialMeta: () => ({
          present: true,
          status: "ACTIVE",
          granted_scopes: [SHEETS_SCOPE, DRIVE_SCOPE],
        }),
        fetchImpl: hermeticFetch((url) => {
          if (url.includes("/drive/v3/files")) {
            return {
              files: [
                { id: "a", name: "Report Q1", mimeType: "application/vnd.google-apps.spreadsheet", modifiedTime: "2026-01-01T00:00:00Z" },
                { id: "b", name: "Report Q2", mimeType: "application/vnd.google-apps.spreadsheet", modifiedTime: "2026-02-01T00:00:00Z" },
              ],
            };
          }
          if (url.includes("/values/")) { valuesHits += 1; return { values: [] }; }
          return null;
        }),
      },
    );
    ok("3. multiple → CLARIFICATION_REQUIRED", !outcome.ok && outcome.rejection.outcome === GOOGLE_WORKSPACE_OUTCOMES.CLARIFICATION_REQUIRED);
    ok("3b. candidates present", !outcome.ok && (outcome.rejection.clarification_candidates?.length ?? 0) === 2);
    ok("3c. no values call", valuesHits === 0);
  }

  // 4. Missing spreadsheet → NOT_FOUND
  {
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.sheetsValues, {
        ai_identity: AI,
        session_id: SESSION,
        owner_text: "Read values from spreadsheet DoesNotExistXYZ.",
      }),
      {
        credentialResolver: resolver(),
        readCredentialMeta: () => ({
          present: true,
          status: "ACTIVE",
          granted_scopes: [SHEETS_SCOPE, DRIVE_SCOPE],
        }),
        fetchImpl: hermeticFetch((url) => {
          if (url.includes("/drive/v3/files")) return { files: [] };
          return null;
        }),
      },
    );
    ok("4. missing → NOT_FOUND", !outcome.ok && outcome.rejection.outcome === GOOGLE_WORKSPACE_OUTCOMES.NOT_FOUND);
  }

  // 5. Explicit range preserved
  {
    let valuesUrl = "";
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.sheetsValues, {
        ai_identity: AI,
        session_id: SESSION,
        spreadsheet_id: "ssid_r",
        range: "Custom!Z9:Z10",
      }),
      {
        credentialResolver: resolver(),
        readCredentialMeta: () => ({ present: true, status: "ACTIVE", granted_scopes: [SHEETS_SCOPE, DRIVE_SCOPE] }),
        fetchImpl: hermeticFetch((url) => {
          if (url.includes("/values/")) {
            valuesUrl = url;
            return { range: "Custom!Z9:Z10", values: [["x"]] };
          }
          return null;
        }),
      },
    );
    ok("5. SUCCESS with explicit range", outcome.ok === true);
    ok("5b. range preserved in request", decodeURIComponent(valuesUrl).includes("Custom!Z9:Z10"));
  }

  // 6. Missing range requiring clarification → no values call
  {
    let valuesHits = 0;
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.sheetsValues, {
        ai_identity: AI,
        session_id: SESSION,
        spreadsheet_id: "ssid_multi_tab",
        owner_text: "Read values from spreadsheet ID ssid_multi_tabxxxxxxxxxxx00000000000.",
      }),
      {
        credentialResolver: resolver(),
        readCredentialMeta: () => ({ present: true, status: "ACTIVE", granted_scopes: [SHEETS_SCOPE, DRIVE_SCOPE] }),
        fetchImpl: hermeticFetch((url) => {
          if (url.includes("/spreadsheets/") && !url.includes("/values/")) {
            return {
              spreadsheetId: "ssid_multi_tab",
              sheets: [{ properties: { title: "A" } }, { properties: { title: "B" } }],
            };
          }
          if (url.includes("/values/")) { valuesHits += 1; return { values: [] }; }
          return null;
        }),
      },
    );
    ok("6. multi-tab clarification", !outcome.ok && outcome.rejection.outcome === GOOGLE_WORKSPACE_OUTCOMES.CLARIFICATION_REQUIRED);
    ok("6b. no values call", valuesHits === 0);
  }

  // 7. Owner denied → zero Keychain + zero network
  {
    const deniedAi = `${AI}-denied`;
    const deniedSession = `${SESSION}-denied`;
    // no policy issued
    let network = 0;
    let resolves = 0;
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.sheetsValues, {
        ai_identity: deniedAi,
        session_id: deniedSession,
        spreadsheet_id: "x",
        range: "A1",
      }),
      {
        credentialResolver: {
          async resolveAccessToken() {
            resolves += 1;
            return resolver().resolveAccessToken();
          },
        },
        readCredentialMeta: () => ({ present: true, status: "ACTIVE", granted_scopes: [SHEETS_SCOPE, DRIVE_SCOPE] }),
        fetchImpl: async () => {
          network += 1;
          return { kind: "transport_error", reason: "should not run" };
        },
      },
    );
    ok("7. OWNER_DENIED", !outcome.ok && outcome.rejection.outcome === GOOGLE_WORKSPACE_OUTCOMES.OWNER_DENIED);
    ok("7b. zero Keychain", resolves === 0);
    ok("7c. zero network", network === 0);
  }

  // 8. Missing Drive scope during name resolution
  {
    let resolves = 0;
    let network = 0;
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.sheetsValues, {
        ai_identity: AI,
        session_id: SESSION,
        owner_text: "Read values from spreadsheet NeedDrive.",
      }),
      {
        credentialResolver: {
          async resolveAccessToken() {
            resolves += 1;
            return resolver().resolveAccessToken();
          },
        },
        readCredentialMeta: () => ({ present: true, status: "ACTIVE", granted_scopes: [SHEETS_SCOPE] }),
        fetchImpl: async () => {
          network += 1;
          return { kind: "transport_error", reason: "should not run" };
        },
      },
    );
    ok("8. Drive SCOPE_REQUIRED", !outcome.ok && outcome.rejection.outcome === GOOGLE_WORKSPACE_OUTCOMES.SCOPE_REQUIRED && outcome.rejection.reason.includes("Drive"));
    ok("8b. zero Keychain", resolves === 0);
    ok("8c. zero network", network === 0);
  }

  // 9. Missing Sheets scope after ID present (range resolution)
  {
    let resolves = 0;
    let network = 0;
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.sheetsValues, {
        ai_identity: AI,
        session_id: SESSION,
        spreadsheet_id: "ssid_only",
        owner_text: "Read values from spreadsheet ID ssid_onlyxxxxxxxxxxxxxxxxxxxx000.",
      }),
      {
        credentialResolver: {
          async resolveAccessToken() {
            resolves += 1;
            return resolver().resolveAccessToken();
          },
        },
        readCredentialMeta: () => ({ present: true, status: "ACTIVE", granted_scopes: [DRIVE_SCOPE] }),
        fetchImpl: async () => {
          network += 1;
          return { kind: "transport_error", reason: "should not run" };
        },
      },
    );
    ok("9. Sheets SCOPE_REQUIRED", !outcome.ok && outcome.rejection.outcome === GOOGLE_WORKSPACE_OUTCOMES.SCOPE_REQUIRED && outcome.rejection.reason.includes("Sheets"));
    ok("9b. zero Keychain", resolves === 0);
    ok("9c. zero network", network === 0);
  }

  // 10. Writes remain blocked
  {
    for (const w of googleWorkspaceWriteIntents().slice(0, 3)) {
      const outcome = await handleGoogleWorkspaceReadCommand(
        envelope(w, { ai_identity: AI, session_id: SESSION }),
        {
          credentialResolver: countingResolver,
          readCredentialMeta: () => ({ present: true, status: "ACTIVE", granted_scopes: [SHEETS_SCOPE, DRIVE_SCOPE] }),
          fetchImpl: async () => ({ kind: "transport_error", reason: "no" }),
        },
      );
      ok(`10. write blocked ${w}`, !outcome.ok && outcome.rejection.outcome === GOOGLE_WORKSPACE_OUTCOMES.UNSUPPORTED_ACTION);
    }
  }

  // 11. No tokens in evidence
  {
    const outcome = await handleGoogleWorkspaceReadCommand(
      envelope(GOOGLE_WORKSPACE_INTENTS.sheetsValues, {
        ai_identity: AI,
        session_id: SESSION,
        spreadsheet_id: "ssid_secret_check",
        range: "A1:A1",
      }),
      {
        credentialResolver: resolver(),
        readCredentialMeta: () => ({ present: true, status: "ACTIVE", granted_scopes: [SHEETS_SCOPE, DRIVE_SCOPE] }),
        fetchImpl: hermeticFetch((url) => {
          if (url.includes("/values/")) return { range: "A1:A1", values: [["ok"]] };
          return null;
        }),
      },
    );
    const blob = JSON.stringify(outcome);
    ok("11. SUCCESS for secret check", outcome.ok === true);
    ok("11b. no access token in blob", !blob.includes("test-access-token"));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
