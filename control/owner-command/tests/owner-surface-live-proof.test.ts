/**
 * Live Owner Surface proof: POST /chat (handleChat) with Owner-presented
 * engineering_coding_intent and proposed_writes. Must not call
 * completeEngineeringWork from this file. GitHub success requires remote
 * SHA match through the existing publish authority.
 *
 * How to run:
 *   npx tsx control/owner-command/tests/owner-surface-live-proof.test.ts
 */

import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleChat } from "../../../transport/owner-command-http/server";
import { isCanonicalWorkId, latestWorkForIdentity, lineageForCommand } from "../contract";
import { getLatestWorkContinuity } from "../../conversation-runtime/self-work-ledger";
import { projectOwnerActivity, listDisplayQueue } from "../../event-pipeline/contract";
import { eventsForCommand } from "../../owner-backbone/contract";

declare const process: { cwd(): string; exitCode?: number; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const OWNER_ID = `owner-surface-live-${Date.now()}`;
const CODE = "control/engineering-runtime/fixtures/completion/code-target.txt";
const DOC = "control/engineering-runtime/fixtures/completion/HUMAN.md";
const CONTRACT = "control/engineering-runtime/fixtures/completion/contract.json";
const REGISTRY = "control/engineering-runtime/fixtures/completion/registry-record.json";
const UNRELATED = "control/engineering-runtime/fixtures/completion/unrelated.txt";
const CHECKOUT = process.cwd();
const MASTER_CODE = readFileSync(join(CHECKOUT, CODE), "utf8");

function payload(commandTag: string) {
  return {
    engineering_coding_intent: {
      authority: "ENGINEERING",
      allowed_paths: [CODE, DOC, CONTRACT, REGISTRY],
      allowed_symbols: [],
      required_tests: ["sandbox.write", "sandbox.readback"],
      forbidden_paths: [UNRELATED, "package.json"],
      requested_function: "zzqegate fixture marker",
      requested_change: "Owner Surface live GitHub publication",
      target_domain: "control/engineering-runtime/fixtures/completion",
      owner_intent: "Owner Surface live GitHub publication",
    },
    proposed_writes: [
      { relative_path: CODE, content: `DNA_OS_OWNER_SURFACE_LIVE ${commandTag}\n` },
      { relative_path: DOC, content: `# DNA OS Owner Surface live ${commandTag}\n\nDisposable Engineering proof from Owner Surface only.\n` },
      { relative_path: CONTRACT, content: `${JSON.stringify({ document_type: "engineering_fixture_contract", version: 1, proof: "owner-surface-live", tag: commandTag }, null, 2)}\n` },
      { relative_path: REGISTRY, content: `${JSON.stringify({ record: "owner-surface-live", tag: commandTag }, null, 2)}\n` },
    ],
  };
}

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

async function main(): Promise<void> {
  const tag = `oslive-${Date.now()}`;
  const res = mockRes();
  await handleChat(mockReq({
    message: "zzqegate fixture marker scoped coding completion fixtures",
    ownerIdentity: { id: OWNER_ID, email: "owner-surface-live@local" },
    payload: payload(tag),
  }), res);

  const body = res.json as {
    layer?: string;
    execution_started?: boolean;
    semantic?: { ok?: boolean };
    mcp?: {
      dna_os_work_id?: string;
      dna_os_command_id?: string;
      dna_os_result_status?: string;
      evidence?: { source?: string; note?: string }[];
      artifacts?: { kind?: string; ref?: string }[];
      result?: { status?: string; evidence?: { note?: string }[]; artifacts?: { kind?: string; ref?: string }[] };
    };
  };

  const mcp = body.mcp;
  const notes = [...(mcp?.evidence ?? []), ...(mcp?.result?.evidence ?? [])].map((row) => row.note ?? "").join("\n");
  const artifacts = [...(mcp?.artifacts ?? []), ...(mcp?.result?.artifacts ?? [])];
  const workId = mcp?.dna_os_work_id ?? "";
  const commandId = mcp?.dna_os_command_id ?? "";
  const commit = artifacts.find((row) => row.kind === "engineering_commit_sha")?.ref ?? null;
  const remote = artifacts.find((row) => row.kind === "engineering_remote_sha")?.ref ?? null;
  const githubVerified = notes.includes("github_publish_status=VERIFIED");
  const shaMatch = Boolean(commit && remote && commit === remote);
  const identityId = `supabase-${OWNER_ID}`;
  const pointer = latestWorkForIdentity(identityId);
  const ledger = getLatestWorkContinuity(identityId);
  const lineage = commandId ? lineageForCommand(commandId) : [];
  const activity = commandId ? projectOwnerActivity(commandId) : null;
  const systemEvents = commandId ? eventsForCommand(commandId) : [];
  const display = commandId ? listDisplayQueue(commandId) : [];
  const authoritativeUntouched = readFileSync(join(CHECKOUT, CODE), "utf8") === MASTER_CODE;

  const proof = {
    OWNER_SURFACE_RECEIVED: body.layer === "RAW_CHAT_INTAKE" && body.execution_started === true,
    CANONICAL_WORK_ID: workId,
    SEMANTIC_RESOLUTION: body.semantic?.ok === true || notes.includes("routing_source="),
    ROUTER_DISPATCH: notes.includes("engineering-runtime") || notes.includes("engineering_status="),
    ENGINEERING_EXECUTION: notes.includes("engineering_status="),
    BUILD_TEST: notes.includes("coding_write_applied=true") || notes.includes("sandbox"),
    GITHUB_PUBLISH: notes.includes("github_publish_status="),
    REMOTE_SHA_MATCH: shaMatch,
    EVIDENCE_RECORDED: lineage.every((row) => row.work_id === workId) && (activity?.work_order_id === workId || githubVerified),
    CONTINUITY_UPDATED: pointer?.work_id === workId && ledger?.WORK_ID === workId,
    RESULT_RETURNED_TO_OWNER_SURFACE: res.statusCode === 200 && Boolean(mcp),
    FINAL_STATUS: githubVerified && shaMatch ? "VERIFIED" : mcp?.dna_os_result_status === "BLOCKED" ? "BLOCKED" : mcp?.dna_os_result_status === "FAILED" ? "FAILED" : "BLOCKED",
    commit_sha: commit,
    remote_sha: remote,
    isolated_checkout: notes.includes("isolated_checkout=true"),
    authoritative_checkout_untouched: authoritativeUntouched,
    github_events: systemEvents.map((event) => event.event_type),
    display_verified: display.some((item) => item.status === "VERIFIED" && item.human_readable === "Commit accepted"),
    notes_excerpt: notes.slice(0, 800),
  };

  console.log(`LIVE_OWNER_SURFACE_PROOF ${JSON.stringify(proof, null, 2)}`);
  process.exit(proof.FINAL_STATUS !== "VERIFIED" ? 1 : 0);
}

main();
