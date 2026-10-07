/**
 * Deterministic Owner Surface path: POST /chat carries Owner-presented
 * engineering_coding_intent into submitOwnerCommand. Fail-closed missing
 * tests must not reach GitHub. Isolated checkout is used when cwd is dirty.
 *
 * How to run:
 *   npx tsx control/owner-command/tests/owner-surface-engineering-path.test.ts
 */

import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleChat } from "../../../transport/owner-command-http/server";
import { isCanonicalWorkId, latestWorkForIdentity, submitOwnerCommand } from "../contract";
import { getLatestWorkContinuity } from "../../conversation-runtime/self-work-ledger";
import { authoritativeWorkingTreeDirty, resolveIsolatedEngineeringCheckout, removePublicationProofCheckout } from "../../engineering-runtime/contract";
import { registerIdentity } from "../../../permissions/access-control/identity-registry";
import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";

declare const process: { cwd(): string; exitCode?: number; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const OWNER_ID = `owner-surface-e2e-${Date.now()}`;

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  await check("dirty authoritative checkout isolates via publication proof worktree", async () => {
    const isolated = await resolveIsolatedEngineeringCheckout(process.cwd());
    assert(isolated.ok, isolated.ok ? "" : `${isolated.reason_code} ${isolated.detail}`);
    if (!isolated.ok) return;
    if (authoritativeWorkingTreeDirty(process.cwd())) {
      assert(isolated.isolated === true, "dirty tree must isolate");
      assert(isolated.checkout_root.includes(".dna-os-publication-checkouts"), isolated.checkout_root);
      assert(isolated.checkout_root !== process.cwd(), "must not use dirty cwd");
      if (isolated.proof) removePublicationProofCheckout(isolated.proof);
    } else {
      assert(isolated.isolated === false, "clean tree uses the registered checkout");
      assert(isolated.checkout_root === process.cwd() || isolated.proof === null, isolated.checkout_root);
    }
  });

  await check("submitOwnerCommand carries Owner-presented coding intent and fail-closes missing tests", async () => {
    const identityId = `identity-owner-surface-submit-${Date.now()}`;
    registerIdentity({ identity_id: identityId, kind: "human", display_name: "Owner Surface submit" });
    const owner: EnvelopeIdentity = {
      identity_id: identityId,
      acting_as_account_id: "account-owner-surface-submit",
      acting_as_tenant_id: "tenant-owner-surface-submit",
      software_id: "software-owner-surface-submit",
      kind: "human",
    };
    const outcome = await submitOwnerCommand(
      "zzqegate fixture marker scoped coding completion fixtures",
      owner,
      {
        envelope_payload: {
          engineering_coding_intent: {
            authority: "ENGINEERING",
            allowed_paths: ["control/engineering-runtime/fixtures/completion/code-target.txt"],
            allowed_symbols: [],
            required_tests: [],
            forbidden_paths: ["package.json"],
            requested_function: "owner surface e2e",
            requested_change: "prove fail-closed",
            target_domain: "control/engineering-runtime/fixtures/completion",
            owner_intent: "owner surface e2e",
          },
        },
      },
      { enabled: false },
    );
    assert(isCanonicalWorkId(outcome.work_id), outcome.work_id);
    assert(outcome.result.status === "BLOCKED", outcome.result.status);
    const notes = outcome.result.evidence.map((row) => row.note).join("\n");
    assert(notes.includes("MISSING_REQUIRED_TESTS") || notes.includes("engineering_status=BLOCKED"), notes.slice(0, 500));
    assert(!notes.includes("github_publish_status=VERIFIED"), "missing tests must not publish");
    const pointer = latestWorkForIdentity(identityId);
    assert(pointer?.work_id === outcome.work_id, String(pointer?.work_id));
    assert(typeof pointer?.execution_stage === "string" && pointer.execution_stage.length > 0, String(pointer?.execution_stage));
    const ledger = getLatestWorkContinuity(identityId);
    assert(ledger?.WORK_ID === outcome.work_id, String(ledger?.WORK_ID));
    assert(typeof ledger?.CURRENT_STAGE === "string" && ledger.CURRENT_STAGE.length > 0, String(ledger?.CURRENT_STAGE));
  });

  await check("Owner Surface /chat fail-closed missing tests still uses one canonical work_id", async () => {
    const res = mockRes();
    await handleChat(mockReq({
    message: "zzqegate fixture marker scoped coding completion fixtures",
      ownerIdentity: { id: OWNER_ID, email: "owner-surface-e2e@local" },
      payload: {
        engineering_coding_intent: {
          authority: "ENGINEERING",
          allowed_paths: ["control/engineering-runtime/fixtures/completion/code-target.txt"],
          allowed_symbols: [],
          required_tests: [],
          forbidden_paths: ["package.json"],
          requested_function: "owner surface e2e",
          requested_change: "prove fail-closed",
          target_domain: "control/engineering-runtime/fixtures/completion",
          owner_intent: "owner surface e2e",
        },
      },
    }), res);
    const body = res.json as {
      layer?: string;
      execution_started?: boolean;
      mcp?: { dna_os_work_id?: string; dna_os_command_id?: string; dna_os_result_status?: string; evidence?: { note?: string }[]; result?: { evidence?: { note?: string }[] } };
    };
    assert(res.statusCode === 200, `status ${res.statusCode} ${JSON.stringify(body).slice(0, 400)}`);
    assert(body.layer === "RAW_CHAT_INTAKE", String(body.layer));
    assert(body.execution_started === true, "Owner Surface must submit the command");
    assert(isCanonicalWorkId(body.mcp?.dna_os_work_id), String(body.mcp?.dna_os_work_id));
    assert(body.mcp?.dna_os_result_status === "BLOCKED", String(body.mcp?.dna_os_result_status));
    const notes = (body.mcp?.evidence ?? body.mcp?.result?.evidence ?? []).map((row) => row.note ?? "").join("\n");
    assert(notes.includes("MISSING_REQUIRED_TESTS") || notes.includes("engineering_status=BLOCKED"), notes.slice(0, 500));
    const identityId = `supabase-${OWNER_ID}`;
    const pointer = latestWorkForIdentity(identityId);
    assert(pointer?.work_id === body.mcp?.dna_os_work_id, String(pointer?.work_id));
    const ledger = getLatestWorkContinuity(identityId);
    assert(ledger?.WORK_ID === body.mcp?.dna_os_work_id, String(ledger?.WORK_ID));
    assert(typeof ledger?.CURRENT_STAGE === "string" && ledger.CURRENT_STAGE.length > 0, String(ledger?.CURRENT_STAGE));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  process.exit(failed > 0 ? 1 : 0);
}

main();
