/**
 * Deterministic I–K proofs: external MCP status comes from DNA OS runtime,
 * secrets are not exposed, canonical work_id survives the query.
 *
 * How to run:
 *   npx tsx connections/dna-os-mcp/tests/external-self-reporting.test.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, DNA_OS_MCP_TOOLS, UNAUTHENTICATED_CONTEXT } from "../contract";
import { persistGithubPublicationProof, persistVerifiedCapability, persistPublicationPointer, persistWorkspaceCleanup } from "../../../control/engineering-runtime/persist";
import { persistLifecycle } from "../../../control/engineering-runtime/contract";
import { containsCredentialMaterial } from "../runtime-facts";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
process.env.ENGINEERING_LIFECYCLE_LOG = `lifecycle-mcp-${STAMP}.jsonl`;
process.env.ENGINEERING_GITHUB_PROOF_LOG = `github-proofs-mcp-${STAMP}.jsonl`;
process.env.ENGINEERING_VERIFIED_CAPABILITY_LOG = `verified-caps-mcp-${STAMP}.jsonl`;
process.env.ENGINEERING_PUBLICATION_POINTER_LOG = `pub-ptr-mcp-${STAMP}.jsonl`;
process.env.ENGINEERING_WORKSPACE_CLEANUP_LOG = `ws-clean-mcp-${STAMP}.jsonl`;

const WORK_ID = "work-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const COMMAND_ID = "cmd_external_self_report";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function structuredOf(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as Record<string, unknown>;
  const text = result.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  persistLifecycle({
    work_id: WORK_ID,
    command_id: COMMAND_ID,
    stage: "VERIFIED",
    attempt: 1,
    worker_id: "engineering-worker://local-scoped",
    action_fingerprint: "abc",
    allowed_paths: ["control/engineering-runtime/fixtures/completion/code-target.txt"],
    reservation_id: "wsr-test",
    reason_code: "ADMITTED",
    detail: "verified for mcp proof",
    evidence_ref: "ev-eng-loop-mcp",
    recorded_at: new Date().toISOString(),
  });
  persistGithubPublicationProof({
    work_id: WORK_ID,
    command_id: COMMAND_ID,
    status: "CI_VERIFIED",
    remote_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    lineage_verified: true,
    expected_files_verified: true,
    ci_required: false,
    recorded_at: new Date().toISOString(),
  });
  persistPublicationPointer({
    work_id: WORK_ID,
    command_id: COMMAND_ID,
    dna_os_commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    remote_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    changed_paths: ["control/engineering-runtime/fixtures/completion/code-target.txt"],
    recorded_at: new Date().toISOString(),
    github_owner: "t23598788-oss",
    github_repository: "-DNA-OS-INFRASTRUCTURE-",
  });
  persistVerifiedCapability({ work_id: WORK_ID, capability_id: "engineering-runtime" });
  persistWorkspaceCleanup({
    work_id: WORK_ID,
    command_id: COMMAND_ID,
    workspace_id: "lws-test",
    status: "CLEANED",
    reason_code: "WORKSPACE_CLEANED",
    evidence_id: "ev-ws-clean-mcp",
    recorded_at: new Date().toISOString(),
  });

  const mcpClient = new Client({ name: "external-chatgpt-stand-in", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  await check("I. External MCP status comes from DNA OS runtime/evidence", async () => {
    const { tools } = await mcpClient.listTools();
    const names = new Set(tools.map((tool) => tool.name));
    assert(names.has("dna_os.get_latest_work"), "latest work tool must be externally discoverable");
    assert(names.has("dna_os.get_work_status"), "work status tool must be externally discoverable");
    assert(names.has("dna_os.get_work_evidence"), "work evidence tool must be externally discoverable");
    assert(names.has("dna_os.get_system_health"), "health tool must be externally discoverable");
    assert(!names.has("submit_command"), "mutating Owner command must not be free to an unauthenticated external client");
    const latest = structuredOf(await mcpClient.callTool({ name: "dna_os.get_latest_work", arguments: {} }) as never);
    const proof = latest.proof as Record<string, unknown>;
    assert(proof.source === "DNA_OS_RUNTIME", `source=${String(proof.source)}`);
    assert(latest.work_id === WORK_ID, `work_id ${String(latest.work_id)}`);
    const status = structuredOf(await mcpClient.callTool({ name: "dna_os.get_work_status", arguments: { work_id: WORK_ID } }) as never);
    assert(status.current_stage === "VERIFIED", String(status.current_stage));
    const health = structuredOf(await mcpClient.callTool({ name: "dna_os.get_system_health", arguments: {} }) as never);
    assert((health.proof as Record<string, unknown>).source === "DNA_OS_RUNTIME", "health from DNA OS");
  });

  await check("J. External MCP cannot retrieve credential secrets", async () => {
    const listed = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    assert(!listed.includes("get_secret"), "get_secret must not exist");
    assert(!listed.includes("dna_os.get_secret"), "dna_os.get_secret must not exist");
    const discovered = await mcpClient.listTools();
    assert(!discovered.tools.some((tool) => /secret/i.test(tool.name)), "no secret tool in tools/list");
    try {
      const secretCall = await mcpClient.callTool({ name: "get_secret", arguments: {} });
      assert(secretCall.isError === true || !JSON.stringify(secretCall).includes("password"), "unknown secret tool must not return secrets");
    } catch {
      // unknown tool rejected by MCP
    }
    const evidence = structuredOf(await mcpClient.callTool({ name: "dna_os.get_work_evidence", arguments: { work_id: WORK_ID } }) as never);
    assert(!containsCredentialMaterial(evidence), "evidence must not contain credential material");
    assert(!JSON.stringify(evidence).includes("ghp_"), "no GitHub tokens");
    assert(!JSON.stringify(evidence).toLowerCase().includes("keychain://"), "no Keychain refs");
  });

  await check("K. The same canonical work_id survives engineering, publication, cleanup, and external status query", async () => {
    const evidence = structuredOf(await mcpClient.callTool({ name: "dna_os.get_work_evidence", arguments: { work_id: WORK_ID } }) as never);
    assert(evidence.work_id === WORK_ID, String(evidence.work_id));
    const github = evidence.github_remote_proofs as Array<Record<string, unknown>>;
    const cleanup = evidence.workspace_cleanup_proofs as Array<Record<string, unknown>>;
    assert(github.some((row) => row.work_id === WORK_ID && row.status === "CI_VERIFIED"), "github remote proof for work_id");
    assert(cleanup.some((row) => row.work_id === WORK_ID), "workspace cleanup proof for work_id");
  });

  await mcpClient.close();
  await mcpServer.close();
  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
