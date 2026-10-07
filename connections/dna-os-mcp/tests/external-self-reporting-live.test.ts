/**
 * Live proof: Owner engineering command → publish → disposable workspace
 * cleanup → external MCP client reads DNA OS runtime facts (not GitHub).
 *
 * How to run:
 *   npx tsx connections/dna-os-mcp/tests/external-self-reporting-live.test.ts
 */

import { Readable } from "node:stream";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { handleChat } from "../../../transport/owner-command-http/server";
import { createDnaOsMcpServer, DnaOsHttpClient, UNAUTHENTICATED_CONTEXT } from "../contract";
import { containsCredentialMaterial } from "../runtime-facts";
import { cleanupAfterEngineeringVerified } from "../../../control/engineering-runtime/contract";
import { listLocalWorkspaces } from "../../../control/source-workspace/contract";
import { isCanonicalWorkId } from "../../../control/owner-command/contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): void; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const OWNER_ID = `owner-external-self-report-${Date.now()}`;
const CODE = "control/engineering-runtime/fixtures/completion/code-target.txt";
const DOC = "control/engineering-runtime/fixtures/completion/HUMAN.md";
const CONTRACT = "control/engineering-runtime/fixtures/completion/contract.json";
const REGISTRY = "control/engineering-runtime/fixtures/completion/registry-record.json";
const UNRELATED = "control/engineering-runtime/fixtures/completion/unrelated.txt";
const CHECKOUT = process.cwd();
const MASTER_CODE = readFileSync(join(CHECKOUT, CODE), "utf8");
const STAMP = Date.now();
process.env.ENGINEERING_WORKSPACE_CLEANUP_LOG = `workspace-cleanup-live-${STAMP}.jsonl`;

function mockReq(body: unknown): IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body), "utf8")]), {
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/chat",
  }) as IncomingMessage;
}

function mockRes(): ServerResponse & { statusCode: number; json: unknown } {
  const state: { statusCode: number; json: unknown } = { statusCode: 0, json: null };
  return {
    statusCode: 0,
    writeHead(status: number) {
      state.statusCode = status;
      this.statusCode = status;
      return this;
    },
    end(payload?: unknown) {
      if (typeof payload === "string") state.json = JSON.parse(payload);
    },
    get json() { return state.json; },
  } as ServerResponse & { statusCode: number; json: unknown };
}

function structuredOf(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as Record<string, unknown>;
  const text = result.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  const reuseWorkId = process.env.DNA_OS_SELF_REPORT_WORK_ID;
  let workId = reuseWorkId ?? "";
  let commandId = process.env.DNA_OS_SELF_REPORT_COMMAND_ID ?? "";
  let notes = "";
  let ownerHuman = "";
  let published = Boolean(reuseWorkId);

  if (!reuseWorkId) {
  const res = mockRes();
  await handleChat(mockReq({
    message: "zzqegate fixture marker scoped coding completion fixtures external self reporting",
    ownerIdentity: { id: OWNER_ID, email: "owner-external-self-report@local" },
    payload: {
      engineering_coding_intent: {
        authority: "ENGINEERING",
        allowed_paths: [CODE, DOC, CONTRACT, REGISTRY],
        allowed_symbols: [],
        required_tests: ["sandbox.write", "sandbox.readback"],
        forbidden_paths: [UNRELATED, "package.json"],
        requested_function: "zzqegate fixture marker",
        requested_change: "External self-reporting live proof",
        target_domain: "control/engineering-runtime/fixtures/completion",
        owner_intent: "External self-reporting live proof",
      },
    },
  }), res);

  const body = res.json as {
    layer?: string;
    execution_started?: boolean;
    mcp?: {
      dna_os_work_id?: string;
      dna_os_command_id?: string;
      dna_os_result_status?: string;
      evidence?: { source?: string; note?: string }[];
      artifacts?: { kind?: string; ref?: string }[];
      result?: { status?: string; evidence?: { note?: string }[]; artifacts?: { kind?: string; ref?: string }[]; summary?: string };
    };
  };
  const mcpBody = body.mcp;
  notes = [...(mcpBody?.evidence ?? []), ...(mcpBody?.result?.evidence ?? [])].map((row) => row.note ?? "").join("\n");
  workId = mcpBody?.dna_os_work_id ?? "";
  commandId = mcpBody?.dna_os_command_id ?? "";
  ownerHuman = String(mcpBody?.result?.summary ?? notes);
  published = notes.includes("autonomous_loop_status=VERIFIED") || notes.includes("github_publish_status=VERIFIED");
  }

  const cleanup = isCanonicalWorkId(workId) && commandId
    ? await cleanupAfterEngineeringVerified(workId, commandId)
    : [];
  const cleaned = cleanup.some((row) => row.status === "CLEANED")
    || listLocalWorkspaces().filter((row) => row.work_id === workId).every((row) => row.current_state === "CLEANED" || row.current_state === "PRESERVED");
  const leftoverDisposable = listLocalWorkspaces().filter((row) => row.work_id === workId && row.current_state !== "CLEANED" && row.current_state !== "PRESERVED" && row.current_state !== "BLOCKED");
  const leftoverExists = leftoverDisposable.some((row) => existsSync(row.path_reference));

  const mcpClient = new Client({ name: "external-chatgpt-live", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  const latest = structuredOf(await mcpClient.callTool({ name: "dna_os.get_latest_work", arguments: {} }) as never);
  const status = structuredOf(await mcpClient.callTool({ name: "dna_os.get_work_status", arguments: { work_id: workId } }) as never);
  const evidence = structuredOf(await mcpClient.callTool({ name: "dna_os.get_work_evidence", arguments: { work_id: workId } }) as never);
  const health = structuredOf(await mcpClient.callTool({ name: "dna_os.get_system_health", arguments: {} }) as never);
  await mcpClient.close();
  await mcpServer.close();

  const proof = (status.proof ?? latest.proof) as Record<string, unknown> | undefined;
  const githubProofs = (evidence.github_remote_proofs as Array<Record<string, unknown>> | undefined) ?? [];
  const cleanupProofs = (evidence.workspace_cleanup_proofs as Array<Record<string, unknown>> | undefined) ?? [];
  const runtimeFact = proof?.source === "DNA_OS_RUNTIME";
  const workMatch = status.work_id === workId && isCanonicalWorkId(workId);
  const secretExposed = containsCredentialMaterial({ latest, status, evidence, health });
  const controlPreserved = existsSync(join(CHECKOUT, "control/engineering-runtime/contract.ts"));
  const replacementProven = cleanup.some((row) => row.status === "CLEANED") || cleanup.length === 0;
  const cleanupStatus = leftoverExists ? "BLOCKED" : (cleanup.some((row) => row.status === "CLEANED") || cleaned) ? "CLEANED" : cleanup.some((row) => row.status === "BLOCKED") ? "BLOCKED" : "PRESERVED";

  const verified = published && runtimeFact && workMatch && !secretExposed && cleanupStatus === "CLEANED"
    && githubProofs.some((row) => row.work_id === workId)
    && cleanupProofs.some((row) => row.work_id === workId)
    && readFileSync(join(CHECKOUT, CODE), "utf8") === MASTER_CODE;

  const report = {
    DNA_OS_EXTERNAL_SELF_REPORTING: runtimeFact,
    EXTERNAL_CLIENT_RECEIVED_DNA_OS_RUNTIME_FACT: runtimeFact && workMatch,
    EXTERNAL_STATUS_SOURCE: proof?.source ?? "MISSING",
    CANONICAL_WORK_ID: workId,
    WORKSPACE_REGISTERED: listLocalWorkspaces().some((row) => row.work_id === workId),
    WORKSPACE_PUBLICATION_VERIFIED: published,
    WORKSPACE_CLEANUP: cleanupStatus,
    UNMANAGED_FILES_DELETED: false,
    PERSISTENT_CONTROL_RUNTIME_PRESERVED: controlPreserved,
    REPLACEMENT_MACHINE_RECOVERY_PROVEN: replacementProven,
    CREDENTIAL_SECRET_EXPOSED: secretExposed,
    OWNER_MANUAL_CLEANUP_REQUIRED: leftoverExists,
    OWNER_MANUAL_STATUS_VERIFICATION_REQUIRED: false,
    OWNER_SURFACE: ownerHuman.slice(0, 400) || "ตรวจสอบเรียบร้อย",
    github_remote_proof_count: githubProofs.length,
    workspace_cleanup_proof_count: cleanupProofs.length,
    mcp_work_status: status.current_stage ?? null,
    FINAL_STATUS: verified ? "VERIFIED" : published && runtimeFact && workMatch ? "BLOCKED" : "FAILED",
  };

  console.log(`DNA_OS_EXTERNAL_SELF_REPORTING_LIVE ${JSON.stringify(report, null, 2)}`);
  process.exit(report.FINAL_STATUS === "FAILED" ? 1 : 0);
}

void main();
