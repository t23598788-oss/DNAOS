/**
 * Hermetic proof:
 * Owner text → persistent conversation runtime → intent classification
 * → canonical Owner command route → Drive discovery → Sheets values
 * → normalized result/evidence → conversation-layer response projection.
 */

import { spawnConversationRuntime } from "../../../control/conversation-runtime/client";
import { classifyCommand, routeOwnerCommand } from "../../../control/command-router/contract";
import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";
import { installGoogleWorkspaceAdapterDepsForTests } from "../router-invoker";
import { GOOGLE_WORKSPACE_INTENTS } from "../adapter-contract";
import { parseSheetsOwnerText } from "../sheets-owner-text";
import {
  DRIVE_SCOPE,
  SHEETS_SCOPE,
} from "../contract";
import type { HostResponse } from "../host-runtime";

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

function response(body: unknown): HostResponse {
  return {
    ok: true,
    status: 200,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

const identity: EnvelopeIdentity = {
  identity_id: "identity_sheets_owner_e2e",
  acting_as_account_id: "account_sheets_owner_e2e",
  acting_as_tenant_id: "tenant_sheets_owner_e2e",
  software_id: "software_dna_os_infrastructure",
  kind: "human",
};

async function main(): Promise<void> {
  const ownerText = "Read A1:B2 from spreadsheet Unique Budget.";
  const observed: string[] = [];
  const conversation = spawnConversationRuntime({ readyTimeoutMs: 20_000 });

  try {
    const interpreted = await conversation.request({
      request_id: "req_sheets_owner_e2e",
      trace_id: "trace_sheets_owner_e2e",
      owner_identity: { identity_id: identity.identity_id, kind: identity.kind },
      text: ownerText,
    }, 30_000);
    ok("conversation child ready", conversation.isReady());
    ok("conversation returned a real result", interpreted.request_id === "req_sheets_owner_e2e");

    const classified = classifyCommand(ownerText);
    ok(
      "Owner text classified as google-workspace",
      classified.status === "MATCHED" && classified.capability.capability_id === "google-workspace",
    );

    const parsed = parseSheetsOwnerText(ownerText);
    ok("spreadsheet name parsed", parsed.spreadsheet_name === "Unique Budget");
    ok("explicit range preserved", parsed.range === "A1:B2");

    installGoogleWorkspaceAdapterDepsForTests({
      evaluateOwnerPolicy(input) {
        observed.push(input.binding_id.endsWith("/drive") ? "owner_policy_drive" : "owner_policy_sheets");
        return { decision: "ALLOW", reason_code: "TEST", owner_enabled: true };
      },
      readCredentialMeta() {
        observed.push("credential_meta");
        return {
          present: true,
          status: "ACTIVE",
          account: "fixture-account",
          granted_scopes: [DRIVE_SCOPE, SHEETS_SCOPE],
        };
      },
      credentialResolver: {
        async resolveAccessToken() {
          observed.push("credential_resolve");
          return {
            ok: true,
            access_token: "fixture-token-must-not-leak",
            credential_source: "hermetic:keychain",
            account_identity_non_secret: "fixture-account",
            refreshed: false,
            material_kind: "access_token",
          };
        },
      },
      fetchImpl: async (url) => {
        if (url.includes("/drive/v3/files")) {
          observed.push("drive_api");
          return {
            kind: "response",
            response: response({
              files: [{
                id: "sheet_unique_123",
                name: "Unique Budget",
                mimeType: "application/vnd.google-apps.spreadsheet",
                modifiedTime: "2026-09-01T00:00:00Z",
              }],
            }),
          };
        }
        if (url.includes("/values/")) {
          observed.push("sheets_api");
          return {
            kind: "response",
            response: response({
              range: "A1:B2",
              majorDimension: "ROWS",
              values: [["h1", "h2"], ["v1", "v2"]],
            }),
          };
        }
        return { kind: "response", response: { ...response({}), ok: false, status: 404 } };
      },
    });

    const envelope: CommandEnvelope = {
      command_id: "cmd_sheets_owner_e2e",
      issued_by: identity,
      intent: GOOGLE_WORKSPACE_INTENTS.sheetsValues,
      payload: {
        ai_identity: "sheets-owner-e2e",
        session_id: "sheets-session-e2e",
        owner_text: ownerText,
        spreadsheet_name: parsed.spreadsheet_name ?? undefined,
        range: parsed.range ?? undefined,
      },
      issued_at: new Date().toISOString(),
    };
    const routed = await routeOwnerCommand(envelope, ownerText, {
      steps: [{
        capability_id: "google-workspace",
        intent: GOOGLE_WORKSPACE_INTENTS.sheetsValues,
        payload: envelope.payload,
      }],
    });

    ok("canonical route completed", routed.status === "COMPLETED", routed.summary);
    ok("canonical connector used", routed.capability_id === "google-workspace");
    ok("Drive discovery called once", observed.filter((s) => s === "drive_api").length === 1);
    ok("Sheets values called once", observed.filter((s) => s === "sheets_api").length === 1);
    ok("normalized evidence returned", routed.evidence.some((e) => e.source === "google-workspace.normalize"));
    ok("conversation response can carry canonical summary", routed.summary.includes("google.sheets.values.read"));
    ok("secret absent from result/evidence", !JSON.stringify(routed).includes("fixture-token-must-not-leak"));

    const evidenceSources = routed.evidence.map((e) => e.source);
    const stageOrder = [
      "owner_policy_sheets",
      "owner_policy_drive",
      "credential_meta",
      "credential_resolve",
      "owner_policy_drive",
      "drive_api",
      "sheets_api",
    ];
    ok("provider call order observed", stageOrder.every((stage, i) => observed[i] === stage), observed.join(" → "));
    const expectedEvidenceOrder = [
      "google-workspace.owner_policy",
      "google-workspace.owner_policy",
      "google-workspace.scope",
      "google-workspace.scope",
      "google-workspace.credential_meta",
      "google-workspace.credential_resolve",
    ];
    ok(
      "fail-closed evidence order",
      expectedEvidenceOrder.every((source, i) => evidenceSources[i + 2] === source),
      evidenceSources.join(" → "),
    );
    console.log(`OBSERVED_RUNTIME_ORDER: ${observed.join(" → ")}`);
    console.log(`OBSERVED_EVIDENCE: ${evidenceSources.join(" → ")}`);
  } finally {
    installGoogleWorkspaceAdapterDepsForTests(null);
    conversation.stop();
  }

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
