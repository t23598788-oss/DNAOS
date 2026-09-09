/**
 * หน้าที่: live proof of the ENGINEERING coding gate — isolated worktree,
 * explicit allowed paths, Business Runtime exclusion. Does not commit,
 * push, PR, or call continueRegisteredArtifact.
 *
 * How to run: npx tsx control/engineering-runtime/tests/engineering-gate.test.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import { routeOwnerCommand } from "../../command-router/contract";
import { loadReservation, removeWorkspace } from "../../source-workspace/contract";
import { admitEngineeringCoding, runEngineeringCoding } from "../contract";

declare const process: { cwd(): string; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const CHECKOUT = process.cwd();
const ALLOWED = "control/engineering-runtime/fixtures/allowed-target.txt";
const UNRELATED = "control/engineering-runtime/fixtures/unrelated.txt";
const MASTER_ALLOWED = join(CHECKOUT, ALLOWED);
const MASTER_UNRELATED = join(CHECKOUT, UNRELATED);
const MASTER_ALLOWED_BEFORE = readFileSync(MASTER_ALLOWED, "utf8");
const MASTER_UNRELATED_BEFORE = readFileSync(MASTER_UNRELATED, "utf8");

function codingPayload(overrides: Record<string, unknown> = {}) {
  return {
    engineering_coding_intent: {
      authority: "ENGINEERING",
      allowed_paths: [ALLOWED],
      allowed_symbols: [],
      required_tests: ["sandbox.write", "sandbox.readback"],
      forbidden_paths: [UNRELATED, "package.json"],
      requested_function: "zzqegate fixture marker",
      requested_change: "mark allowed-target in isolated worktree",
      target_domain: "control/engineering-runtime/fixtures",
      owner_intent: "engineering gate live proof",
      ...overrides,
    },
  };
}

function envelope(intent: string, payload: unknown): CommandEnvelope {
  return {
    command_id: `cmd_${randomUUID()}`,
    issued_by: {
      identity_id: "identity-engineering-gate-test",
      acting_as_account_id: "account-engineering-gate-test",
      acting_as_tenant_id: "tenant-engineering-gate-test",
      software_id: "software-engineering-gate-test",
      kind: "human",
    },
    intent,
    payload,
    issued_at: new Date().toISOString(),
  };
}

let passed = 0;
let failed = 0;
const live: Record<string, unknown> = {};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function cleanup(reservationId: string | null, repositoryRoot: string | null): Promise<void> {
  if (!reservationId || !repositoryRoot) return;
  const reservation = loadReservation(reservationId);
  if (!reservation) return;
  await removeWorkspace(reservation, repositoryRoot);
}

async function main(): Promise<void> {
  await check("1. allowed file can be modified inside isolated worktree", async () => {
    const commandId = `cmd_eng_ok_${randomUUID()}`;
    const marker = `engineering-gate ${commandId}\n`;
    const result = await runEngineeringCoding({
      command_id: commandId,
      intent_text: "zzqegate fixture marker",
      payload: codingPayload(),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      proposed_content: marker,
    });
    live.proof_1 = {
      command_id: result.lineage.command_id,
      work_id: result.lineage.work_id,
      reservation_id: result.lineage.reservation_id,
      changed_path: result.lineage.changed_path,
      worktree_path: result.lineage.worktree_path,
      repository_id: result.lineage.repository_id,
      status: result.status,
      reason_code: result.reason_code,
    };
    try {
      assert(result.status === "COMPLETED", `expected COMPLETED, got ${result.status} ${result.reason_code} ${result.detail}`);
      assert(result.write_applied === true, "expected write_applied");
      assert(result.lineage.reservation_id !== null, "expected reservation_id");
      assert(result.lineage.worktree_path !== null, "expected worktree_path");
      assert(result.lineage.changed_path === ALLOWED, `expected changed_path ${ALLOWED}, got ${result.lineage.changed_path}`);
      const worktreeFile = join(result.lineage.worktree_path!, ALLOWED);
      assert(existsSync(worktreeFile), `missing worktree file ${worktreeFile}`);
      assert(readFileSync(worktreeFile, "utf8") === marker, "worktree allowed file was not updated");
      assert(readFileSync(MASTER_ALLOWED, "utf8") === MASTER_ALLOWED_BEFORE, "master checkout allowed file must stay untouched");
      assert(result.lineage.worktree_path !== CHECKOUT, "worktree must not be repository_root");
    } finally {
      await cleanup(result.lineage.reservation_id, result.admission.repository_root);
    }
  });

  await check("2. unrelated file modification is rejected", async () => {
    const commandId = `cmd_eng_unrel_${randomUUID()}`;
    const rejected = await runEngineeringCoding({
      command_id: commandId,
      intent_text: "zzqegate fixture marker",
      payload: codingPayload(),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      proposed_write_path: UNRELATED,
    });
    live.proof_2 = {
      command_id: rejected.lineage.command_id,
      work_id: rejected.lineage.work_id,
      reservation_id: rejected.lineage.reservation_id,
      reason_code: rejected.reason_code,
      rejected_write: rejected.rejected_write,
    };
    try {
      assert(rejected.status === "BLOCKED", `expected BLOCKED, got ${rejected.status} ${rejected.detail}`);
      assert(rejected.reason_code === "WRITE_OUT_OF_ALLOWED_SCOPE" || rejected.reason_code === "WRITE_IN_FORBIDDEN_SCOPE", `unexpected reason ${rejected.reason_code}`);
      assert(rejected.write_applied === false, "unrelated write must not apply");
      assert(readFileSync(MASTER_UNRELATED, "utf8") === MASTER_UNRELATED_BEFORE, "master unrelated file must stay untouched");
      if (rejected.lineage.worktree_path) {
        const wtUnrelated = join(rejected.lineage.worktree_path, UNRELATED);
        if (existsSync(wtUnrelated)) {
          assert(readFileSync(wtUnrelated, "utf8") === MASTER_UNRELATED_BEFORE, "worktree unrelated file must stay untouched");
        }
      }
    } finally {
      await cleanup(rejected.lineage.reservation_id, rejected.admission.repository_root);
    }
  });

  await check("3. path outside worktree is rejected", async () => {
    const commandId = `cmd_eng_out_${randomUUID()}`;
    const outside = `/tmp/dna-os-engineering-outside-${commandId}.txt`;
    const result = await runEngineeringCoding({
      command_id: commandId,
      intent_text: "zzqegate fixture marker",
      payload: codingPayload(),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      proposed_write_path: outside,
    });
    live.proof_3 = {
      command_id: result.lineage.command_id,
      work_id: result.lineage.work_id,
      reservation_id: result.lineage.reservation_id,
      reason_code: result.reason_code,
    };
    try {
      assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status} ${result.detail}`);
      assert(result.reason_code === "WRITE_OUTSIDE_WORKTREE", `expected WRITE_OUTSIDE_WORKTREE, got ${result.reason_code}`);
      assert(result.write_applied === false, "outside write must not apply");
      assert(!existsSync(outside), "path outside worktree must not be created");
      assert(readFileSync(MASTER_ALLOWED, "utf8") === MASTER_ALLOWED_BEFORE, "master allowed file must stay untouched");
    } finally {
      await cleanup(result.lineage.reservation_id, result.admission.repository_root);
    }
  });

  await check("4. missing coding scope is rejected", () => {
    const commandId = `cmd_eng_missing_${randomUUID()}`;
    const admission = admitEngineeringCoding({
      command_id: commandId,
      work_id: `work-${randomUUID()}`,
      checkout_root: CHECKOUT,
      payload: codingPayload({ allowed_paths: [] }),
      selected_capability_id: "engineering-runtime",
    });
    live.proof_4 = { command_id: commandId, reason_code: admission.reason_code };
    assert(!admission.admitted, "missing allowed_paths must fail closed");
    assert(admission.reason_code === "MISSING_CODING_SCOPE", `expected MISSING_CODING_SCOPE, got ${admission.reason_code}`);
  });

  await check("5. Business command cannot enter Engineering write path", async () => {
    const env = envelope("ตรวจสถานะ firewall", codingPayload());
    const result = await routeOwnerCommand(env, "ตรวจสถานะ firewall");
    live.proof_5 = {
      command_id: env.command_id,
      capability_id: result.capability_id,
      status: result.status,
      ignored: result.evidence.some((row) => row.note.includes("engineering_coding_intent ignored")),
    };
    assert(result.capability_id === "os-login", `expected os-login, got ${result.capability_id}`);
    assert(result.capability_id !== "engineering-runtime", "Business command must not select engineering-runtime");
    assert(result.evidence.every((row) => row.source !== "engineering-runtime"), "Business path must not emit engineering-runtime evidence");
    assert(readFileSync(MASTER_ALLOWED, "utf8") === MASTER_ALLOWED_BEFORE, "Business command must not write source");
  });

  await check("6. artifact/evidence records command_id → work_id → reservation → changed path", async () => {
    const recorded = live.proof_1 as {
      command_id?: string;
      work_id?: string;
      reservation_id?: string;
      changed_path?: string;
    };
    assert(typeof recorded.command_id === "string" && recorded.command_id.startsWith("cmd_"), "proof 1 command_id");
    assert(typeof recorded.work_id === "string" && recorded.work_id.startsWith("work-"), "proof 1 work_id");
    assert(typeof recorded.reservation_id === "string" && recorded.reservation_id.length > 0, "proof 1 reservation_id");
    assert(recorded.changed_path === ALLOWED, "proof 1 changed_path");
    live.proof_6 = recorded;
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`LIVE_PROOF ${JSON.stringify(live)}`);
  if (failed > 0) process.exitCode = 1;
}

main();
