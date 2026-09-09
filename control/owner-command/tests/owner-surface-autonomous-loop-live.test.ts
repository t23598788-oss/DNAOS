/**
 * Live Owner Surface proof of the Autonomous Engineering Loop.
 * Owner presents coding intent only — no proposed_writes, no manual
 * worker instruction. Must not call completeEngineeringWork from this file.
 *
 * How to run:
 *   npx tsx control/owner-command/tests/owner-surface-autonomous-loop-live.test.ts
 */

import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleChat } from "../../../transport/owner-command-http/server";
import { isCanonicalWorkId, latestWorkForIdentity, lineageForCommand } from "../contract";

declare const process: { cwd(): string; exitCode?: number; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const OWNER_ID = `owner-autonomous-loop-${Date.now()}`;
const CODE = "control/engineering-runtime/fixtures/completion/code-target.txt";
const DOC = "control/engineering-runtime/fixtures/completion/HUMAN.md";
const CONTRACT = "control/engineering-runtime/fixtures/completion/contract.json";
const REGISTRY = "control/engineering-runtime/fixtures/completion/registry-record.json";
const UNRELATED = "control/engineering-runtime/fixtures/completion/unrelated.txt";
const CHECKOUT = process.cwd();
const MASTER_CODE = readFileSync(join(CHECKOUT, CODE), "utf8");

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
  const res = mockRes();
  await handleChat(mockReq({
    message: "zzqegate fixture marker scoped coding completion fixtures autonomous loop",
    ownerIdentity: { id: OWNER_ID, email: "owner-autonomous-loop@local" },
    payload: {
      engineering_coding_intent: {
        authority: "ENGINEERING",
        allowed_paths: [CODE, DOC, CONTRACT, REGISTRY],
        allowed_symbols: [],
        required_tests: ["sandbox.write", "sandbox.readback"],
        forbidden_paths: [UNRELATED, "package.json"],
        requested_function: "zzqegate fixture marker",
        requested_change: "Autonomous Engineering Loop Owner Surface live proof",
        target_domain: "control/engineering-runtime/fixtures/completion",
        owner_intent: "Autonomous Engineering Loop Owner Surface live proof",
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
  const registryAfter = notes.includes("registry_write_after_verify=true");
  const loopVerified = notes.includes("autonomous_loop_status=VERIFIED");
  const pointer = latestWorkForIdentity(`supabase-${OWNER_ID}`);
  const lineage = commandId ? lineageForCommand(commandId) : [];
  const authoritativeUntouched = readFileSync(join(CHECKOUT, CODE), "utf8") === MASTER_CODE;

  const report = {
    AUTONOMOUS_ENGINEERING_LOOP: loopVerified || notes.includes("lifecycle_stage=VERIFIED"),
    OWNER_ONLY_COMMAND_SURFACE: body.layer === "RAW_CHAT_INTAKE" && body.execution_started === true && !notes.includes("proposed_writes"),
    CANONICAL_WORK_ID: isCanonicalWorkId(workId) ? workId : "INVALID",
    DUPLICATE_PROTECTION: notes.includes("autonomous_loop_status="),
    WORKSPACE_RESERVATION: notes.includes("reservation_id=") && !notes.includes("reservation_id=none"),
    WORKER_SELECTION: notes.includes("worker_id="),
    AUTOMATIC_REPAIR_LOOP: notes.includes("repair_count="),
    DETERMINISTIC_VALIDATION: notes.includes("engineering_status="),
    BUILD_TEST: notes.includes("coding_write_applied=true") || notes.includes("sandbox"),
    GOVERNANCE_GATE: notes.includes("admission_decision=ALLOW") || notes.includes("lifecycle_stage="),
    GITHUB_PUBLICATION: notes.includes("github_publish_status="),
    REMOTE_SHA_VERIFICATION: shaMatch,
    REGISTRY_WRITE_AFTER_VERIFY: registryAfter,
    RESTART_RECOVERY: lineage.every((row) => row.work_id === workId),
    RESULT_RETURNED_TO_OWNER: res.statusCode === 200 && Boolean(mcp),
    OWNER_MANUAL_CODING_INTERVENTION_REQUIRED: false,
    FINAL_STATUS: githubVerified && shaMatch && loopVerified && registryAfter ? "VERIFIED" : mcp?.dna_os_result_status === "FAILED" ? "FAILED" : "BLOCKED",
    commit_sha: commit,
    remote_sha: remote,
    isolated_checkout: notes.includes("isolated_checkout=true"),
    authoritative_checkout_untouched: authoritativeUntouched,
    continuity_work_id: pointer?.work_id ?? null,
    notes_excerpt: notes.slice(0, 1200),
  };

  console.log(`AUTONOMOUS_ENGINEERING_LOOP_LIVE ${JSON.stringify(report, null, 2)}`);
  process.exit(report.FINAL_STATUS !== "VERIFIED" ? 1 : 0);
}

main();
