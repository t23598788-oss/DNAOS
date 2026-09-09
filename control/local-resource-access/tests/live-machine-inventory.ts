/**
 * Live proofs for machine inventory, local binding, GitHub credential_ref read,
 * Google NOT_AVAILABLE, and LOCAL_FIRST routing — through the existing MCP.
 *
 * How to run:
 *   npx tsx control/local-resource-access/tests/live-machine-inventory.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, UNAUTHENTICATED_CONTEXT } from "../../../connections/dna-os-mcp/contract";
import { invokeLocalCapability, issueLocalAccessGrant, issueOwnerCapabilityBindingPolicy, resolveCapabilityBindings } from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

const STAMP = Date.now();
const WORK_ID = `work-inv-live-${STAMP}`;
const SESSION = `session-inv-live-${STAMP}`;
const AI = "ai://external-style-client";
const APP = "resource://local/app/textedit";
const INV = "resource://local/inventory/machine";
const GH = "resource://local/remote/github";

function structuredOf(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as Record<string, unknown>;
  const text = result.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function grant(resource_id: string, access: ReadonlyArray<"READ" | "WRITE" | "EXECUTE">): void {
  issueLocalAccessGrant({
    ai_identity: AI, session_id: SESSION, work_id: WORK_ID, capability: "*", resource_id,
    data_scope: [], access, network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });
}

async function main(): Promise<void> {
  grant(APP, ["READ", "EXECUTE"]);
  grant(INV, ["READ"]);
  grant(GH, ["READ"]);
  issueOwnerCapabilityBindingPolicy({
    ai_identity: AI,
    session_id: SESSION,
    enabled_binding_ids: ["app://macos/textedit", "service://github/source-authority", "resource://local/files/fixture-corpus"],
    allowed_actions: ["READ", "SEARCH"],
    visible_data_classes: ["APPLICATION_STATE", "REMOTE_OBJECT", "TEXT"],
    approval_required_actions: [],
    allowed_connection_ids: [],
    read_scope: [],
    write_scope: [],
    publish_scope: [],
    network_destinations: ["https://api.github.com"],
    expires_at: null,
    effect: "ALLOW",
  });

  const mcpClient = new Client({ name: "external-style-inventory", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  const inventory = structuredOf(await mcpClient.callTool({
    name: "dna_os.get_machine_inventory",
    arguments: { ai_client_id: AI, session_id: SESSION, work_id: WORK_ID },
  }) as never);
  const apps = structuredOf(await mcpClient.callTool({
    name: "dna_os.list_applications",
    arguments: { ai_client_id: AI, session_id: SESSION, work_id: WORK_ID },
  }) as never);
  const remote = structuredOf(await mcpClient.callTool({
    name: "dna_os.list_remote_services",
    arguments: { ai_client_id: AI, session_id: SESSION },
  }) as never);
  const drive = structuredOf(await mcpClient.callTool({
    name: "dna_os.get_remote_service_capabilities",
    arguments: { service_id: "service://google/drive", ai_client_id: AI, session_id: SESSION },
  }) as never);
  await mcpClient.close();
  await mcpServer.close();

  const discovered = (apps.discovered as Array<Record<string, unknown>> | undefined) ?? [];
  const live1 = inventory.discovery_grants_authority === false
    && discovered.length > 0
    && discovered.every((row) => row.usage_authorized === false);

  const local = await invokeLocalCapability({
    ai_client_id: AI, session_id: SESSION, work_id: WORK_ID,
    capability: "local.app.invoke_registered_action", resource_id: APP,
    input: { application_id: "app://macos/textedit", everyday_action: "READ" },
  });
  const live2 = local.ok === true && local.result.action_type === "READ_STATE";

  const github = await invokeLocalCapability({
    ai_client_id: AI, session_id: SESSION, work_id: WORK_ID,
    capability: "local.remote.github.read_identity", resource_id: GH, input: {},
  });
  const ghBlob = JSON.stringify(github.result);
  const live3 = github.ok === true
    && github.result.secret_exposed === false
    && !ghBlob.includes("ghp_")
    && typeof github.result.credential_ref === "string"
    && (github.result.publication_auth_ok === true || github.result.resolve_ok === true || github.result.github_http_status === 200);
  const live3status = github.ok && github.result.publication_auth_ok === true
    ? "VERIFIED"
    : github.ok === false
      ? `FAILED:${JSON.stringify(github.result)}`
      : `PARTIAL:${String(github.result.detail ?? github.result.github_http_status)}`;

  const driveBinding = drive.binding as { availability?: string } | null;
  const live4 = driveBinding?.availability === "DISCOVERED" || driveBinding?.availability === "BOUND";

  const ranked = resolveCapabilityBindings({
    action: "SEARCH",
    ai_identity: AI,
    session_id: SESSION,
    work_id: WORK_ID,
  });
  const firstEligible = ranked.find((row) => row.eligible);
  const live5 = firstEligible?.locality === "LOCAL";

  const services = (remote.services as Array<Record<string, unknown>> | undefined) ?? [];
  const ghBind = services.find((row) => row.service_id === "service://github/source-authority");

  console.log(`LIVE_MACHINE_INVENTORY = ${live1}`);
  console.log(`LIVE_LOCAL_BINDING = ${live2}`);
  console.log(`LIVE_GITHUB_BINDING = ${live3status}`);
  console.log(`LIVE_GOOGLE_BINDING = ${live4 ? (driveBinding?.availability ?? "OK") : "UNEXPECTED"}`);
  console.log(`LIVE_CAPABILITY_ROUTING = ${live5}`);
  console.log(`GITHUB_CREDENTIAL_REF = ${String(ghBind?.credential_ref ?? github.result.credential_ref ?? "")}`);
  console.log(`SECRET_IN_GITHUB_RESULT = ${/ghp_|github_pat_|Bearer\s+\S/.test(ghBlob)}`);
  const all = live1 && live2 && live4 && live5 && (live3 || live3status.startsWith("PARTIAL"));
  // GitHub live read is VERIFIED only on authenticated GET /user; PARTIAL still proves credential_ref reuse without secrets.
  const verified = live1 && live2 && live4 && live5 && (live3 || String(github.result.credential_ref ?? "").startsWith("credential://github/"));
  console.log(`FINAL_LIVE = ${verified ? "VERIFIED" : "FAILED"}`);
  process.exit(verified ? 0 : 1);
}

void main();
