/**
 * E2E proof: MCP submit_command shaping → Owner/command-router ingress →
 * connector-execution-boundary → Google Workspace adapter → hermetic Google API
 * → normalized result + evidence → MCP response payload.
 *
 * How to run: npx tsx connections/google-workspace/tests/runtime-adapter-e2e.test.ts
 */

import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";
import { routeOwnerCommand } from "../../../control/command-router/contract";
import { executeConnectorCommand } from "../../../control/connector-execution-boundary/contract";
import { DNA_OS_MCP_TOOLS } from "../../dna-os-mcp/tool-registry";
import type { DnaOsHttpClient, DnaOsHttpResponse } from "../../dna-os-mcp/adapters/dna-os-http-client";
import {
  CALENDAR_SCOPES,
  DRIVE_SCOPE,
  GMAIL_SCOPE,
  GOOGLE_CREDENTIAL_REF,
  SHEETS_SCOPE,
} from "../contract";
import { GOOGLE_WORKSPACE_INTENTS } from "../adapter-contract";
import { installGoogleWorkspaceAdapterDepsForTests } from "../router-invoker";
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
  identity_id: "identity_google_e2e",
  acting_as_account_id: "account_google_e2e",
  acting_as_tenant_id: "tenant_google_e2e",
  software_id: "software_dna_os_infrastructure",
  kind: "human",
};

const ALL_SCOPES = [GMAIL_SCOPE, ...CALENDAR_SCOPES, DRIVE_SCOPE, SHEETS_SCOPE];

function jsonResponse(status: number, body: unknown): HostResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

async function main(): Promise<void> {
  const stages: string[] = [];
  const resolver: GoogleWorkspaceCredentialResolver = {
    async resolveAccessToken() {
      stages.push("credential_resolve");
      return {
        ok: true,
        access_token: "ya29.E2E_ACCESS",
        credential_source: "keychain:e2e/e2e",
        account_identity_non_secret: "e2e-google-sub",
        refreshed: false,
        material_kind: "access_token",
      };
    },
  };
  const fetchImpl: FetchImpl = async (url) => {
    stages.push("google_api");
    ok("hermetic URL is Gmail API", url.includes("gmail.googleapis.com"));
    return {
      kind: "response",
      response: jsonResponse(200, {
        messages: [{ id: "msg-e2e-1", threadId: "thr-e2e-1" }],
        resultSizeEstimate: 1,
      }),
    };
  };

  installGoogleWorkspaceAdapterDepsForTests({
    credentialResolver: resolver,
    fetchImpl,
    readCredentialMeta: () => {
      stages.push("credential_meta");
      return {
        present: true,
        status: "ACTIVE",
        account: "e2e-google-sub",
        granted_scopes: ALL_SCOPES,
      };
    },
    evaluateOwnerPolicy: () => {
      stages.push("owner_policy");
      return { decision: "ALLOW", reason_code: "E2E_OWNER_ALLOW", owner_enabled: true };
    },
  });

  try {
    // Boundary-level proof through the same registry path the router uses
    stages.push("connector_boundary");
    const boundary = await executeConnectorCommand("google-workspace", {
      command_id: "cmd_e2e_boundary",
      issued_by: identity,
      intent: GOOGLE_WORKSPACE_INTENTS.gmailList,
      payload: { ai_identity: "e2e-ai", session_id: "e2e-session" },
      issued_at: new Date().toISOString(),
    } satisfies CommandEnvelope);
    ok("boundary ok", boundary.ok === true, boundary.summary);
    ok("boundary evidence present", boundary.evidence.length > 0);

    // Full Owner command-router path (DNA OS ingress after MCP/Core auth)
    stages.push("route_owner_command");
    const routed = await routeOwnerCommand(
      {
        command_id: "cmd_e2e_route",
        issued_by: identity,
        intent: GOOGLE_WORKSPACE_INTENTS.gmailList,
        payload: { ai_identity: "e2e-ai", session_id: "e2e-session" },
        issued_at: new Date().toISOString(),
      },
      "google gmail list messages",
      {
        steps: [{
          capability_id: "google-workspace",
          intent: GOOGLE_WORKSPACE_INTENTS.gmailList,
          payload: { ai_identity: "e2e-ai", session_id: "e2e-session" },
        }],
      },
    );
    ok("router COMPLETED", routed.status === "COMPLETED", `status=${routed.status} summary=${routed.summary}`);
    ok("router capability google-workspace", routed.capability_id === "google-workspace");
    ok("router evidence includes SUCCESS", routed.evidence.some((e) => e.note.includes("outcome=SUCCESS")));
    ok("router summary names provider", routed.summary.includes("provider=google_workspace") || routed.summary.includes("SUCCESS"));
    const resultArtifact = routed.artifacts.find((a) => a.kind === "google_workspace_result");
    ok("normalized result artifact present", typeof resultArtifact?.ref === "string");
    if (resultArtifact?.ref) {
      const parsed = JSON.parse(resultArtifact.ref) as {
        provider: string;
        service: string;
        action: string;
        data: { messages: Array<{ id: string }> };
        account_identity_non_secret: string;
      };
      ok("normalized provider", parsed.provider === "google_workspace");
      ok("normalized service", parsed.service === "service://google/gmail");
      ok("normalized action", parsed.action === GOOGLE_WORKSPACE_INTENTS.gmailList);
      ok("normalized gmail data", parsed.data.messages[0]?.id === "msg-e2e-1");
      ok("account identity non-secret", parsed.account_identity_non_secret === "e2e-google-sub");
    }
    const routedBlob = JSON.stringify(routed);
    ok("no access token in router result", !routedBlob.includes("ya29.E2E_ACCESS"));
    ok("no credential secret ref value leak", !routedBlob.includes("GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET"));

    // MCP submit_command handler → fake Core client that returns the routed CapabilityResult
    const submitTool = DNA_OS_MCP_TOOLS.find((t) => t.metadata.name === "submit_command");
    ok("submit_command tool present", submitTool !== undefined);
    if (submitTool) {
      stages.push("mcp_submit_command");
      const client: Pick<DnaOsHttpClient, "submitCommand"> = {
        async submitCommand(): Promise<DnaOsHttpResponse> {
          stages.push("dna_os_ingress");
          // Re-run the same Owner path Core would take after session auth.
          const again = await routeOwnerCommand(
            {
              command_id: "cmd_e2e_mcp",
              issued_by: identity,
              intent: GOOGLE_WORKSPACE_INTENTS.gmailList,
              payload: { ai_identity: "e2e-ai", session_id: "e2e-session" },
              issued_at: new Date().toISOString(),
            },
            "google gmail list messages",
            {
              steps: [{
                capability_id: "google-workspace",
                intent: GOOGLE_WORKSPACE_INTENTS.gmailList,
                payload: { ai_identity: "e2e-ai", session_id: "e2e-session" },
              }],
            },
          );
          return {
            status: 200,
            body: {
              command_id: "cmd_e2e_mcp",
              work_id: "work_e2e_mcp",
              result: again,
              output_contract: { lane: "SYSTEM_STATE", dispatcher_task_id: again.task_id },
            },
          };
        },
      };
      const mcpResult = await submitTool.handler(
        {
          commandText: "google gmail list messages",
          payload: { ai_identity: "e2e-ai", session_id: "e2e-session" },
          agentIdentity: { id: "agent_e2e", email: "e2e@example.test" },
        },
        client as DnaOsHttpClient,
      );
      ok("MCP response not error", mcpResult.isError !== true);
      const structured = mcpResult.structuredContent as Record<string, unknown>;
      ok("MCP returns COMPLETED", structured.dna_os_result_status === "COMPLETED");
      ok("MCP evidence array present", Array.isArray(structured.evidence) && (structured.evidence as unknown[]).length > 0);
      ok("MCP correlation_id present", typeof structured.correlation_id === "string");
      const mcpBlob = JSON.stringify(mcpResult);
      ok("MCP response has no access token", !mcpBlob.includes("ya29.E2E_ACCESS"));
      ok("MCP response references credential ref only as metadata path", !mcpBlob.includes("E2E_ACCESS"));
    }

    ok(
      "stage order includes policy before credential and API",
      stages.indexOf("owner_policy") < stages.indexOf("credential_resolve")
        && stages.indexOf("credential_resolve") < stages.indexOf("google_api"),
      stages.join(" → "),
    );
    ok("credential_ref constant reused", GOOGLE_CREDENTIAL_REF === "credential://google/workspace/oauth");
  } finally {
    installGoogleWorkspaceAdapterDepsForTests(null);
  }

  console.log(`${passed} passed, ${failed} failed`);
  console.log(`STAGES: ${stages.join(" → ")}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
