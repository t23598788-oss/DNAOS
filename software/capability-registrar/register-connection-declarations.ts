/**
 * หน้าที่: PHASE C — ลงทะเบียน connection ที่ "มีอยู่จริง" ผ่านประตูเดิม
 * ทุกค่ามาจาก source/credential registry/probe จริง ไม่มี field ใดถูกเดา
 *
 * Usage: npx tsx software/capability-registrar/register-connection-declarations.ts
 */
import { registerConnectionDeclaration, lookupConnectionDeclaration, buildDeclarationId } from "../../connections/connection-registry/contract";
import type { ConnectionDeclarationInput } from "../../connections/connection-registry/contract";

const SOURCE = "dna-os-infrastructure";

const DECLARATIONS: readonly (readonly [string, ConnectionDeclarationInput])[] = [
  // ── 1. Railway ────────────────────────────────────────────────────────────
  ["Railway", {
    connection_type: "DEPLOYMENT_PLATFORM", direction: "OUTBOUND",
    source_id: SOURCE, provider_id: "railway",
    target_descriptor: { project: "dna-os-infrastructure", environment_id: "4d28eafa-9735-4405-a585-55ea354bafab" },
    canonical_target_id: null, target_resolution: "UNRESOLVED",
    protocol: "HTTPS_GRAPHQL", endpoint: "https://backboard.railway.com/graphql/v2",
    execution_boundary: "connections/railway/router-invoker.ts",
    executor_capability_id: "capability-41d17cbe-fcea-4ca7-b911-a4f49bb5d63a",
    credential_ref: { kind: "keychain_ref", ref: "credential://railway/dna-os-infrastructure/production/project-token" },
    credential_scope: ["READ_PROJECT_STATUS"],
    input_contract: ["CommandEnvelope"], output_contract: ["ConnectorBoundaryOutcome"],
    configuration_source: "connections/railway/router-invoker.ts (GRAPHQL_ENDPOINT, ENVIRONMENT_ID, CREDENTIAL_REF)",
    health_probe: "POST https://backboard.railway.com/graphql/v2",
    verification_method: "unauthenticated reachability probe 2026-09-01 -> http 400 (ปลายทางตอบจริง ยังไม่ยืนยันตัวตน)",
    verification_evidence_id: null, state: "OBSERVED",
  }],
  // ── 2. Supabase ───────────────────────────────────────────────────────────
  ["Supabase", {
    connection_type: "SECRET_PROVISIONING", direction: "OUTBOUND",
    source_id: SOURCE, provider_id: "supabase",
    target_descriptor: { project_ref: "xeytcavxejhyzxwevgto" },
    canonical_target_id: null, target_resolution: "UNRESOLVED",
    protocol: "LOCAL_CLI", endpoint: "supabase secrets set --project-ref xeytcavxejhyzxwevgto --env-file <file>",
    execution_boundary: "credentials/supabase-edge-secret/installer.ts",
    executor_capability_id: "capability-501c546f-8b02-41c6-b206-878329b7cff7",
    credential_ref: { kind: "keychain_ref", ref: "credential://supabase/xeytcavxejhyzxwevgto/PROVIDER_ALERT_EMAIL_READ_SECRET" },
    credential_scope: ["INVOKE_EDGE_FUNCTION"],
    input_contract: ["secret name จาก Process Gate allowlist", "requester identity"],
    output_contract: ["installEdgeFunctionSecret", "verifySupabaseSecretPresent"],
    configuration_source: "execution/run/process-registry.ts (SUPABASE_PRODUCTION_PROJECT_REF, executable supabase.secrets-set closed argv)",
    health_probe: null,
    verification_method: null,
    verification_evidence_id: null, state: "DECLARED",
  }],
  // ── 3. MCP (ขาเข้า — DNA OS เป็นผู้ให้บริการ) ─────────────────────────────
  ["MCP", {
    connection_type: "TOOL_INGRESS", direction: "INBOUND",
    source_id: SOURCE, provider_id: "dna-os",
    target_descriptor: { host: "127.0.0.1", port: "8793", path: "/mcp" },
    canonical_target_id: null, target_resolution: "UNRESOLVED",
    protocol: "HTTP_JSONRPC", endpoint: "http://127.0.0.1:8793/mcp",
    execution_boundary: "connections/dna-os-mcp/server.ts",
    executor_capability_id: "capability-05b9e2ba-ebc3-42fc-9e2b-92a456951ea2",
    credential_ref: null, credential_scope: [],
    input_contract: [], output_contract: [],   // capability ยังไม่ประกาศ — ปล่อยว่างตามความจริง
    configuration_source: "~/Library/LaunchAgents/com.dnaos.dna-os-mcp.plist",
    health_probe: "POST http://127.0.0.1:8793/mcp",
    verification_method: "reachability probe 2026-09-01 -> http 406 (ตอบจริง MCP ต้องการ Accept header เฉพาะ) + launchctl job com.dnaos.dna-os-mcp รันอยู่",
    verification_evidence_id: null, state: "OBSERVED",
  }],
  // ── 4. DigitalOcean ───────────────────────────────────────────────────────
  ["DigitalOcean", {
    connection_type: "INFRASTRUCTURE_PROVIDER", direction: "OUTBOUND",
    source_id: SOURCE, provider_id: "digitalocean",
    target_descriptor: { api_host: "api.digitalocean.com", api_version: "v2" },
    canonical_target_id: null, target_resolution: "UNRESOLVED",
    protocol: "HTTPS_REST", endpoint: "https://api.digitalocean.com/v2",
    execution_boundary: "connections/digitalocean/router-invoker.ts",
    executor_capability_id: "capability-72010057-6a4e-4dd7-a94d-a84504543dca",
    credential_ref: { kind: "not_yet_built" },   // ทะเบียน credential มี digitalocean 0 แถว
    credential_scope: [],
    input_contract: [], output_contract: [],
    configuration_source: "connections/digitalocean/digitalocean-read-api.ts (CORE_V2_BASE_URL) + providers/digitalocean/definition/provider.json",
    health_probe: "GET https://api.digitalocean.com/v2",
    verification_method: "unauthenticated reachability probe 2026-09-01 -> http 403 (ปลายทางตอบจริง ไม่มี credential ลงทะเบียน)",
    verification_evidence_id: null, state: "OBSERVED",
  }],
  // ── 5. GitHub ─────────────────────────────────────────────────────────────
  ["GitHub", {
    connection_type: "SOURCE_AUTHORITY", direction: "OUTBOUND",
    source_id: SOURCE, provider_id: "github",
    target_descriptor: { owner: "t23598788-oss", repository: "-DNA-OS-INFRASTRUCTURE-", branch: "main" },
    canonical_target_id: null, target_resolution: "UNRESOLVED",
    protocol: "HTTPS_REST", endpoint: "https://api.github.com",
    execution_boundary: "connections/github/github-adapter.ts",
    executor_capability_id: null,   // ยังไม่ผูก capability — ไม่เดา
    credential_ref: { kind: "keychain_ref", ref: "credential://github/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/source-authority" },
    credential_scope: ["repo"],
    input_contract: [], output_contract: [],
    configuration_source: "connections/github/adapter-config.ts (GITHUB_API_BASE_URL)",
    health_probe: "GET https://api.github.com/repos/t23598788-oss/-DNA-OS-INFRASTRUCTURE-",
    verification_method: "unauthenticated reachability probe 2026-09-01 -> http 403 (ปลายทางตอบจริง)",
    verification_evidence_id: null, state: "OBSERVED",
  }],
  // ── 6. n8n — เฉพาะ target ที่ประกาศไว้ ห้ามลง :5678 ───────────────────────
  ["n8n", {
    connection_type: "WORKFLOW_CONTROL", direction: "OUTBOUND",
    source_id: SOURCE, provider_id: "n8n",
    target_descriptor: { host: "n8n.srv1740014.hstgr.cloud" },
    canonical_target_id: null, target_resolution: "UNRESOLVED",
    protocol: "HTTPS_WEBHOOK", endpoint: "https://n8n.srv1740014.hstgr.cloud/webhook/",
    execution_boundary: "connections/n8n/outbound-webhook.ts",
    executor_capability_id: "capability-19fb83ac-5dc7-4128-bbd1-e6664803b146",
    credential_ref: { kind: "keychain_ref", ref: "credential://macos-keychain/dna-os/n8n-api-key" },
    credential_scope: ["workflow.read", "workflow.write"],
    input_contract: ["workflow_id?", "workflow_definition (create)"],
    output_contract: ["workflow_list", "workflow_detail", "created_workflow_id"],
    configuration_source: "connections/n8n/outbound-webhook.ts:45 (N8N_BASE_URL — hardcoded constant)",
    health_probe: "GET https://n8n.srv1740014.hstgr.cloud/healthz",
    verification_method: "probe 2026-09-01 -> http 000 UNREACHABLE; พบ process ที่ 127.0.0.1:5678 ตอบ 200 แต่ DNA_OS_USES_5678 = UNKNOWN (ดู connections/n8n/evidence/configuration-drift-reconciliation-2026-09-01.json) จึงไม่ลง :5678 เป็น target",
    verification_evidence_id: null, state: "CONFIGURATION_DRIFT",
  }],
];

function main(): number {
  let registered = 0, duplicate = 0, rejected = 0;
  for (const [label, input] of DECLARATIONS) {
    const result = registerConnectionDeclaration(input);
    const id = buildDeclarationId(input);
    console.log(`\n■ ${label}`);
    console.log(`   status        : ${result.status}`);
    if (result.status === "REJECTED") { rejected++; console.log(`   reasons       : ${result.reasons.join(", ")}`); continue; }
    if (result.status === "DUPLICATE") duplicate++; else registered++;
    console.log(`   connection_id : ${id}`);
    console.log(`   type/dir      : ${input.connection_type} / ${input.direction}`);
    console.log(`   state         : ${input.state}`);
    console.log(`   credential    : ${input.credential_ref ? (input.credential_ref as { kind: string }).kind : "none"}`);
    // READ BACK ผ่าน port เดิม
    const back = lookupConnectionDeclaration(id);
    console.log(`   read back     : ${back ? "OK  target_resolution=" + back.target_resolution : "NOT FOUND"}`);
  }
  console.log(`\nREGISTERED=${registered}  DUPLICATE=${duplicate}  REJECTED=${rejected}`);
  return rejected > 0 ? 1 : 0;
}

process.exit(main());
