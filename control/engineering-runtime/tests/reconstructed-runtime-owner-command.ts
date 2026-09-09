/**
 * Owner engineering command executed inside a reconstructed control runtime
 * (process.cwd must be the reconstructed clone). Prints one JSON report.
 *
 * How to run (from reconstructed destination):
 *   npx tsx control/engineering-runtime/tests/reconstructed-runtime-owner-command.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, UNAUTHENTICATED_CONTEXT } from "../../../connections/dna-os-mcp/contract";
import { containsCredentialMaterial } from "../../../connections/dna-os-mcp/runtime-facts";
import { cleanupAfterEngineeringVerified } from "../contract";
import { listLocalWorkspaces } from "../../source-workspace/contract";
import { isCanonicalWorkId, submitOwnerCommand } from "../../owner-command/contract";
import { registerIdentity } from "../../../permissions/access-control/identity-registry";
import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

const OWNER_ID = `identity-reconstructed-runtime-${Date.now()}`;
const CODE = "control/engineering-runtime/fixtures/completion/code-target.txt";
const DOC = "control/engineering-runtime/fixtures/completion/HUMAN.md";
const CONTRACT = "control/engineering-runtime/fixtures/completion/contract.json";
const REGISTRY = "control/engineering-runtime/fixtures/completion/registry-record.json";
const UNRELATED = "control/engineering-runtime/fixtures/completion/unrelated.txt";
const CHECKOUT = process.cwd();
const MASTER_CODE = readFileSync(join(CHECKOUT, CODE), "utf8");

function structuredOf(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as Record<string, unknown>;
  const text = result.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  registerIdentity({ identity_id: OWNER_ID, kind: "human", display_name: "Reconstructed runtime Owner" });
  const owner: EnvelopeIdentity = {
    identity_id: OWNER_ID,
    acting_as_account_id: "account-reconstructed-runtime",
    acting_as_tenant_id: "tenant-reconstructed-runtime",
    software_id: "software-reconstructed-runtime",
    kind: "human",
  };
  const outcome = await submitOwnerCommand(
    "zzqegate fixture marker scoped coding completion fixtures reconstructed runtime",
    owner,
    {
      envelope_payload: {
        engineering_coding_intent: {
          authority: "ENGINEERING",
          allowed_paths: [CODE, DOC, CONTRACT, REGISTRY],
          allowed_symbols: [],
          required_tests: ["sandbox.write", "sandbox.readback"],
          forbidden_paths: [UNRELATED, "package.json"],
          requested_function: "zzqegate fixture marker",
          requested_change: "Reconstructed control runtime live proof",
          target_domain: "control/engineering-runtime/fixtures/completion",
          owner_intent: "Reconstructed control runtime live proof",
        },
      },
    },
    { enabled: false },
  );

  const notes = outcome.result.evidence.map((row) => row.note ?? "").join("\n");
  const workId = outcome.work_id ?? "";
  const commandId = outcome.envelope.command_id;
  const published = notes.includes("autonomous_loop_status=VERIFIED") || notes.includes("github_publish_status=VERIFIED");
  const cleanup = isCanonicalWorkId(workId) && commandId
    ? await cleanupAfterEngineeringVerified(workId, commandId)
    : [];
  const leftover = listLocalWorkspaces().filter((row) => row.work_id === workId && row.current_state !== "CLEANED" && row.current_state !== "PRESERVED" && existsSync(row.path_reference));
  const cleanupStatus = leftover.length > 0 ? "BLOCKED" : cleanup.some((row) => row.status === "CLEANED") || listLocalWorkspaces().filter((row) => row.work_id === workId).every((row) => row.current_state === "CLEANED" || row.current_state === "PRESERVED")
    ? "CLEANED"
    : "PRESERVED";

  const mcpClient = new Client({ name: "external-reconstructed-runtime", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  const identity = structuredOf(await mcpClient.callTool({ name: "dna_os.get_runtime_identity", arguments: {} }) as never);
  const health = structuredOf(await mcpClient.callTool({ name: "dna_os.get_system_health", arguments: {} }) as never);
  const status = structuredOf(await mcpClient.callTool({ name: "dna_os.get_work_status", arguments: { work_id: workId } }) as never);
  const evidence = structuredOf(await mcpClient.callTool({ name: "dna_os.get_work_evidence", arguments: { work_id: workId } }) as never);
  await mcpClient.close();
  await mcpServer.close();

  const proof = status.proof as Record<string, unknown> | undefined;
  const report = {
    cwd: CHECKOUT,
    CANONICAL_WORK_ID: workId,
    POST_REBIND_OWNER_COMMAND_VERIFIED: published && isCanonicalWorkId(workId),
    WORKSPACE_CLEANUP: isCanonicalWorkId(workId) ? cleanupStatus : "NOT_RUN",
    EXTERNAL_STATUS_SOURCE: proof?.source ?? "MISSING",
    EXTERNAL_CLIENT_READ_RECONSTRUCTED_RUNTIME: isCanonicalWorkId(workId) && proof?.source === "DNA_OS_RUNTIME" && status.work_id === workId,
    CREDENTIAL_SECRET_EXPOSED: containsCredentialMaterial({ identity, health, status, evidence, notes }),
    OWNER_NOTES_EXCERPT: notes.slice(0, 1200),
    OWNER_SURFACE: String(outcome.result.summary ?? "").slice(0, 200),
    RESULT_STATUS: outcome.result.status,
    FIXTURE_UNCHANGED_AFTER: readFileSync(join(CHECKOUT, CODE), "utf8") === MASTER_CODE,
  };
  console.log(`DNA_OS_RECONSTRUCTED_OWNER_COMMAND ${JSON.stringify(report)}`);
  process.exit(report.POST_REBIND_OWNER_COMMAND_VERIFIED && report.EXTERNAL_CLIENT_READ_RECONSTRUCTED_RUNTIME && !report.CREDENTIAL_SECRET_EXPOSED ? 0 : 2);
}

void main();
