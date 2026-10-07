/**
 * หน้าที่: live proof of Engineering completion — manifest, admission,
 * DNA OS integration. Does not push, PR, deploy, or call
 * continueRegisteredArtifact.
 *
 * How to run: npx tsx control/engineering-runtime/tests/engineering-completion.test.ts
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import { routeOwnerCommand } from "../../command-router/contract";
import { loadReservation, removeWorkspace } from "../../source-workspace/contract";
import { completeEngineeringWork, finalizeEngineeringWork, runEngineeringCoding } from "../contract";

declare const process: { cwd(): string; exitCode?: number; env: Record<string, string | undefined> };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const CHECKOUT = process.cwd();
const CODE = "control/engineering-runtime/fixtures/completion/code-target.txt";
const DOC = "control/engineering-runtime/fixtures/completion/HUMAN.md";
const CONTRACT = "control/engineering-runtime/fixtures/completion/contract.json";
const REGISTRY = "control/engineering-runtime/fixtures/completion/registry-record.json";
const UNRELATED = "control/engineering-runtime/fixtures/completion/unrelated.txt";

const originals: Record<string, string> = {
  [CODE]: readFileSync(join(CHECKOUT, CODE), "utf8"),
  [DOC]: readFileSync(join(CHECKOUT, DOC), "utf8"),
  [CONTRACT]: readFileSync(join(CHECKOUT, CONTRACT), "utf8"),
  [REGISTRY]: readFileSync(join(CHECKOUT, REGISTRY), "utf8"),
  [UNRELATED]: readFileSync(join(CHECKOUT, UNRELATED), "utf8"),
};

function restoreCheckout(): void {
  for (const [rel, content] of Object.entries(originals)) writeFileSync(join(CHECKOUT, rel), content, "utf8");
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    engineering_coding_intent: {
      authority: "ENGINEERING",
      allowed_paths: [CODE, DOC, CONTRACT, REGISTRY],
      allowed_symbols: [],
      required_tests: ["sandbox.write", "sandbox.readback"],
      forbidden_paths: [UNRELATED, "package.json"],
      requested_function: "zzqegate fixture marker",
      requested_change: "completion fixture set",
      target_domain: "control/engineering-runtime/fixtures/completion",
      owner_intent: "engineering completion live proof",
      ...overrides,
    },
  };
}

function writes(commandId: string) {
  return [
    { relative_path: CODE, content: `ENGINEERING_COMPLETION ${commandId}\n` },
    { relative_path: DOC, content: `# Engineering completion ${commandId}\n\nProduced in the same Engineering work order.\n` },
    { relative_path: CONTRACT, content: `${JSON.stringify({ document_type: "engineering_fixture_contract", version: 1, command_id: commandId }, null, 2)}\n` },
    { relative_path: REGISTRY, content: `${JSON.stringify({ record: "verified-completion", command_id: commandId }, null, 2)}\n` },
  ];
}

function envelope(intent: string, body: unknown): CommandEnvelope {
  return {
    command_id: `cmd_${randomUUID()}`,
    issued_by: {
      identity_id: "identity-engineering-completion-test",
      acting_as_account_id: "account-engineering-completion-test",
      acting_as_tenant_id: "tenant-engineering-completion-test",
      software_id: "software-engineering-completion-test",
      kind: "human",
    },
    intent,
    payload: body,
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
  await check("A. scoped code+docs+tests → manifest ALLOW integrate VERIFIED", async () => {
    const commandId = `cmd_eng_complete_a_${randomUUID()}`;
    const result = await completeEngineeringWork({
      command_id: commandId,
      intent_text: "zzqegate fixture marker",
      payload: payload(),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      proposed_writes: writes(commandId),
    });
    live.proof_a = {
      command_id: result.lineage.command_id,
      work_id: result.lineage.work_id,
      repository_id: result.lineage.repository_id,
      reservation_id: result.lineage.reservation_id,
      manifest_id: result.lineage.manifest_id,
      admission_decision: result.lineage.admission_decision,
      integration_status: result.lineage.integration_status,
      changed_paths: result.manifest?.changed_paths,
      status: result.status,
      reason_code: result.reason_code,
    };
    try {
      assert(result.status === "VERIFIED", `expected VERIFIED, got ${result.status} ${result.reason_code} ${result.detail}`);
      assert(result.result_admission.decision === "ALLOW", "expected ALLOW");
      assert(result.manifest !== null, "expected manifest");
      assert(result.integration?.integrated === true, "expected DNA OS integration");
      assert(readFileSync(join(CHECKOUT, CODE), "utf8").includes(commandId), "authoritative checkout missing admitted code");
      assert(readFileSync(join(CHECKOUT, DOC), "utf8").includes(commandId), "authoritative checkout missing admitted documentation");
      assert(readFileSync(join(CHECKOUT, UNRELATED), "utf8") === originals[UNRELATED], "unrelated file must stay unchanged");
      assert(result.manifest!.worker_authority.COMMIT === "DENY", "COMMIT must be DENY");
      assert(result.manifest!.worker_authority.PUSH === "DENY", "PUSH must be DENY");
      assert(result.manifest!.worker_authority.PR === "DENY", "PR must be DENY");
      assert(result.manifest!.worker_authority.DEPLOY === "DENY", "DEPLOY must be DENY");
    } finally {
      restoreCheckout();
      await cleanup(result.lineage.reservation_id, result.coding.admission.repository_root);
    }
  });

  await check("B. undeclared file → admission DENY, checkout unchanged", async () => {
    const commandId = `cmd_eng_complete_b_${randomUUID()}`;
    const coding = await runEngineeringCoding({
      command_id: commandId,
      intent_text: "zzqegate fixture marker",
      payload: payload(),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      proposed_writes: writes(commandId),
    });
    assert(coding.write_applied, `coding failed: ${coding.reason_code} ${coding.detail}`);
    writeFileSync(join(coding.lineage.worktree_path!, "control/engineering-runtime/fixtures/completion/undeclared-escape.txt"), "worker-escape\n", "utf8");
    const result = await finalizeEngineeringWork({ coding, checkout_root: CHECKOUT });
    live.proof_b = { command_id: result.lineage.command_id, reason_code: result.reason_code, admission_decision: result.result_admission.decision, status: result.status };
    try {
      assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}`);
      assert(result.result_admission.decision === "DENY", "expected DENY");
      assert(result.reason_code === "UNDECLARED_FILE_CHANGE", `expected UNDECLARED_FILE_CHANGE, got ${result.reason_code}`);
      assert(result.integration === null || result.integration.integrated === false, "must not integrate");
      assert(readFileSync(join(CHECKOUT, CODE), "utf8") === originals[CODE], "authoritative checkout must stay unchanged");
    } finally {
      restoreCheckout();
      await cleanup(result.lineage.reservation_id, result.coding.admission.repository_root);
    }
  });

  await check("C. fake/incomplete manifest → admission DENY", async () => {
    const commandId = `cmd_eng_complete_c_${randomUUID()}`;
    const result = await completeEngineeringWork({
      command_id: commandId,
      intent_text: "zzqegate fixture marker",
      payload: payload(),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      proposed_writes: writes(commandId),
      claimed_manifest: {
        allowed_paths: [CODE, DOC, CONTRACT, REGISTRY, UNRELATED],
        forbidden_paths: [UNRELATED],
        changed_paths: [CODE],
        repository_id: "repository://forged/not-this-repo",
        reservation_id: "wsr-forged",
        base_commit_sha: "0".repeat(40),
        worker_authority: { COMMIT: "ALLOW", PUSH: "DENY", PR: "DENY", DEPLOY: "DENY" },
        produced_artifacts: [{ path: CODE, sha256: "deadbeef" }],
      },
    });
    live.proof_c = { command_id: result.lineage.command_id, reason_code: result.reason_code, admission_decision: result.result_admission.decision };
    try {
      assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status} ${result.detail}`);
      assert(result.result_admission.decision === "DENY", "expected DENY");
      assert(result.reason_code === "SCOPE_EXPANDED" || result.reason_code === "MANIFEST_SCOPE_MISMATCH", `expected SCOPE_EXPANDED or MANIFEST_SCOPE_MISMATCH, got ${result.reason_code}`);
      assert(readFileSync(join(CHECKOUT, CODE), "utf8") === originals[CODE], "authoritative checkout must stay unchanged");
    } finally {
      restoreCheckout();
      await cleanup(result.lineage.reservation_id, result.coding.admission.repository_root);
    }
  });

  await check("D. required test missing → admission DENY", async () => {
    const commandId = `cmd_eng_complete_d_${randomUUID()}`;
    const result = await completeEngineeringWork({
      command_id: commandId,
      intent_text: "zzqegate fixture marker",
      payload: payload({ required_tests: ["sandbox.write", "unit.missing"] }),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      proposed_writes: writes(commandId),
    });
    live.proof_d = { command_id: result.lineage.command_id, reason_code: result.reason_code };
    try {
      assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}`);
      assert(result.reason_code === "TEST_EVIDENCE_MISSING", `expected TEST_EVIDENCE_MISSING, got ${result.reason_code}`);
      assert(readFileSync(join(CHECKOUT, CODE), "utf8") === originals[CODE], "authoritative checkout must stay unchanged");
    } finally {
      restoreCheckout();
      await cleanup(result.lineage.reservation_id, result.coding.admission.repository_root);
    }
  });

  await check("E. base revision changed → BASE_REVISION_MISMATCH", async () => {
    const commandId = `cmd_eng_complete_e_${randomUUID()}`;
    const coding = await runEngineeringCoding({
      command_id: commandId,
      intent_text: "zzqegate fixture marker",
      payload: payload(),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      proposed_writes: writes(commandId),
    });
    assert(coding.write_applied, `coding failed: ${coding.reason_code} ${coding.detail}`);
    const mainBefore = execFileSync("git", ["rev-parse", "refs/heads/main"], { cwd: CHECKOUT, encoding: "utf8" }).trim();
    let moved = false;
    try {
      const tree = execFileSync("git", ["rev-parse", `${mainBefore}^{tree}`], { cwd: CHECKOUT, encoding: "utf8" }).trim();
      const newSha = execFileSync("git", ["commit-tree", tree, "-p", mainBefore, "-m", `engineering-completion-proof-e ${commandId}`], { cwd: CHECKOUT, encoding: "utf8" }).trim();
      execFileSync("git", ["update-ref", "refs/heads/main", newSha], { cwd: CHECKOUT, encoding: "utf8" });
      moved = true;
      const result = await finalizeEngineeringWork({ coding, checkout_root: CHECKOUT });
      live.proof_e = { command_id: result.lineage.command_id, reason_code: result.reason_code, status: result.status };
      assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status} ${result.detail}`);
      assert(result.reason_code === "BASE_REVISION_MISMATCH", `expected BASE_REVISION_MISMATCH, got ${result.reason_code}`);
      assert(readFileSync(join(CHECKOUT, CODE), "utf8") === originals[CODE], "authoritative checkout must stay unchanged");
      await cleanup(result.lineage.reservation_id, result.coding.admission.repository_root);
    } finally {
      if (moved) {
        execFileSync("git", ["update-ref", "refs/heads/main", mainBefore], { cwd: CHECKOUT, encoding: "utf8" });
      }
      restoreCheckout();
      await cleanup(coding.lineage.reservation_id, coding.admission.repository_root);
    }
  });

  await check("F. Business command never reaches Engineering completion", async () => {
    const env = envelope("ตรวจสถานะ firewall", payload());
    const result = await routeOwnerCommand(env, "ตรวจสถานะ firewall");
    live.proof_f = { command_id: env.command_id, capability_id: result.capability_id, status: result.status };
    assert(result.capability_id === "os-login", `expected os-login, got ${result.capability_id}`);
    assert(result.evidence.every((row) => !row.note.includes("engineering_status=VERIFIED")), "Business path must not complete Engineering");
    assert(result.evidence.every((row) => row.source !== "engineering-runtime" || !row.note.includes("manifest_id=")), "Business path must not emit engineering manifest");
    assert(readFileSync(join(CHECKOUT, CODE), "utf8") === originals[CODE], "Business command must not write source");
  });

  restoreCheckout();
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`LIVE_PROOF ${JSON.stringify(live)}`);
  if (failed > 0) process.exitCode = 1;
}

main();
