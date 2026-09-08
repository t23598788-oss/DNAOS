/**
 * Deterministic GitHub permanence proofs A–H.
 *
 * How to run:
 *   npx tsx control/engineering-runtime/tests/github-permanence.test.ts
 */

import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  inspectEngineeringRecovery,
  listVerifiedCapabilities,
  ownerFacingEngineeringResult,
  persistGithubPublicationProof,
  recoverEngineeringLoop,
  resolveGithubDestination,
  transitionLifecycle,
  verifyGithubPublicationPermanence,
  permanenceReadDeps,
} from "../contract";
import type { GithubPermanenceInput } from "../github-permanence";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
process.env.ENGINEERING_LIFECYCLE_LOG = `lifecycle-permanence-${STAMP}.jsonl`;
process.env.ENGINEERING_SCOPE_LOCK_LOG = `scope-permanence-${STAMP}.jsonl`;
process.env.ENGINEERING_VERIFIED_CAPABILITY_LOG = `verified-permanence-${STAMP}.jsonl`;
process.env.ENGINEERING_PUBLICATION_POINTER_LOG = `pointer-permanence-${STAMP}.jsonl`;
process.env.ENGINEERING_GITHUB_PROOF_LOG = `proof-permanence-${STAMP}.jsonl`;

const CHECKOUT = process.cwd();
const FILES = [
  "control/engineering-runtime/fixtures/completion/code-target.txt",
  "control/engineering-runtime/fixtures/completion/HUMAN.md",
  "control/engineering-runtime/fixtures/completion/contract.json",
  "control/engineering-runtime/fixtures/completion/registry-record.json",
];
const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

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

function message(input: { work_id: string; command_id: string; manifest_id: string }): string {
  return [
    "DNA OS Engineering source commit",
    `command_id: ${input.command_id}`,
    `work_id: ${input.work_id}`,
    `manifest_id: ${input.manifest_id}`,
    "admission: ALLOW",
    "integration: INTEGRATED",
  ].join("\n");
}

async function main(): Promise<void> {
  const dest = resolveGithubDestination({
    repository_id: "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-",
    checkout_root: CHECKOUT,
  });
  assert(dest.ok, dest.ok ? "" : dest.detail);
  if (!dest.ok) {
    process.exitCode = 1;
    return;
  }
  const d = dest.destination;

  function base(workId: string, commandId: string, manifestId: string): GithubPermanenceInput {
    return {
      work_id: workId,
      command_id: commandId,
      manifest_id: manifestId,
      admission: "ALLOW",
      integration: "INTEGRATED",
      expected_sha: SHA,
      expected_files: FILES,
      github_owner: d.owner,
      github_repository: d.repository,
      publish_branch: d.publish_branch,
      connection_id: d.connection_id,
      registered_owner: d.owner,
      registered_repository: d.repository,
      registered_branch: d.publish_branch,
    };
  }

  await check("A. published SHA exists remotely", async () => {
    const work_id = `work-${randomUUID()}`;
    const command_id = `cmd_${randomUUID()}`;
    const manifest_id = `erm-${randomUUID()}`;
    const proof = await verifyGithubPublicationPermanence(base(work_id, command_id, manifest_id), permanenceReadDeps({
      sha: SHA,
      message: message({ work_id, command_id, manifest_id }),
      files: FILES,
    }));
    live.A = { status: proof.status, lineage_verified: proof.lineage_verified };
    assert(proof.status === "CI_VERIFIED" || proof.status === "REMOTE_COMMIT_VERIFIED", proof.status);
    assert(proof.remote_sha === SHA, proof.remote_sha);
    assert(proof.lineage_verified === true, "lineage");
  });

  await check("B. wrong SHA is rejected", async () => {
    const work_id = `work-${randomUUID()}`;
    const command_id = `cmd_${randomUUID()}`;
    const manifest_id = `erm-${randomUUID()}`;
    const proof = await verifyGithubPublicationPermanence(base(work_id, command_id, manifest_id), permanenceReadDeps({
      sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      message: message({ work_id, command_id, manifest_id }),
      files: FILES,
    }));
    live.B = { status: proof.status, reason_code: proof.reason_code };
    assert(proof.status === "REMOTE_MISMATCH", proof.status);
  });

  await check("C. wrong repository is rejected", async () => {
    const work_id = `work-${randomUUID()}`;
    const command_id = `cmd_${randomUUID()}`;
    const manifest_id = `erm-${randomUUID()}`;
    const input = { ...base(work_id, command_id, manifest_id), github_owner: "some-other-org" };
    const proof = await verifyGithubPublicationPermanence(input, permanenceReadDeps({
      sha: SHA,
      message: message({ work_id, command_id, manifest_id }),
      files: FILES,
    }));
    live.C = { status: proof.status, reason_code: proof.reason_code };
    assert(proof.status === "REMOTE_MISMATCH", proof.status);
    assert(proof.reason_code === "REMOTE_IDENTITY_MISMATCH", String(proof.reason_code));
  });

  await check("D. missing expected file is rejected", async () => {
    const work_id = `work-${randomUUID()}`;
    const command_id = `cmd_${randomUUID()}`;
    const manifest_id = `erm-${randomUUID()}`;
    const proof = await verifyGithubPublicationPermanence(base(work_id, command_id, manifest_id), permanenceReadDeps({
      sha: SHA,
      message: message({ work_id, command_id, manifest_id }),
      files: FILES.slice(0, 2),
    }));
    live.D = { status: proof.status, reason_code: proof.reason_code };
    assert(proof.status === "REMOTE_MISMATCH", proof.status);
    assert(proof.reason_code === "EXPECTED_FILES_MISSING", String(proof.reason_code));
    assert(proof.expected_files_verified === false, "files");
  });

  await check("E. CI success advances the same work_id", async () => {
    const work_id = `work-${randomUUID()}`;
    const command_id = `cmd_${randomUUID()}`;
    const manifest_id = `erm-${randomUUID()}`;
    const pending = await verifyGithubPublicationPermanence(base(work_id, command_id, manifest_id), permanenceReadDeps({
      sha: SHA,
      message: message({ work_id, command_id, manifest_id }),
      files: FILES,
      checks: { kind: "found", http_status: 200, total: 1, runs: [{ name: "ci", status: "in_progress", conclusion: null, html_url: null }] },
    }));
    assert(pending.status === "CI_PENDING", pending.status);
    const done = await verifyGithubPublicationPermanence(base(work_id, command_id, manifest_id), permanenceReadDeps({
      sha: SHA,
      message: message({ work_id, command_id, manifest_id }),
      files: FILES,
      checks: { kind: "found", http_status: 200, total: 1, runs: [{ name: "ci", status: "completed", conclusion: "success", html_url: null }] },
    }));
    live.E = { work_id, pending: pending.status, done: done.status };
    assert(done.work_id === work_id, "same work_id");
    assert(done.status === "CI_VERIFIED", done.status);
  });

  await check("F. CI failure does not produce VERIFIED", async () => {
    const work_id = `work-${randomUUID()}`;
    const command_id = `cmd_${randomUUID()}`;
    const manifest_id = `erm-${randomUUID()}`;
    const proof = await verifyGithubPublicationPermanence(base(work_id, command_id, manifest_id), permanenceReadDeps({
      sha: SHA,
      message: message({ work_id, command_id, manifest_id }),
      files: FILES,
      workflows: { kind: "found", http_status: 200, runs: [{ id: 1, name: "ci", status: "completed", conclusion: "failure", html_url: null, head_sha: SHA }] },
    }));
    live.F = { status: proof.status, registered: listVerifiedCapabilities().some((row) => row.work_id === work_id) };
    assert(proof.status === "CI_FAILED", proof.status);
    assert(!listVerifiedCapabilities().some((row) => row.work_id === work_id), "must not register");
  });

  await check("G. restart during CI_PENDING resumes the same work", async () => {
    const work_id = `work-${randomUUID()}`;
    const command_id = `cmd_perm_g_${randomUUID()}`;
    const intent = `permanence-g-${work_id}`;
    const fingerprint = (await import("../lifecycle")).fingerprintEngineeringAction(intent, FILES);
    transitionLifecycle({
      previous: null,
      next: "REQUESTED",
      work_id,
      command_id,
      attempt: 0,
      worker_id: null,
      action_fingerprint: fingerprint,
      allowed_paths: FILES,
      reservation_id: null,
      reason_code: "LIFECYCLE",
      detail: "seed",
      evidence_ref: "ev-perm-g-0",
      recorded_at: new Date().toISOString(),
    });
    let previous = (await import("../lifecycle")).latestLifecycleForWork(work_id);
    for (const next of ["SCOPED", "RESERVED", "DISPATCHED", "CODE_PROPOSED", "VALIDATING", "BUILDING", "TESTING", "GOVERNANCE_CHECK", "READY_TO_PUBLISH", "PUBLISHING", "REMOTE_VERIFICATION", "CI_PENDING"] as const) {
      const stepped = transitionLifecycle({
        previous,
        next,
        work_id,
        command_id,
        attempt: 0,
        worker_id: "engineering-worker://g",
        action_fingerprint: fingerprint,
        allowed_paths: FILES,
        reservation_id: null,
        reason_code: next === "CI_PENDING" ? "CI_PENDING" : "ADMITTED",
        detail: next,
        evidence_ref: `ev-perm-g-${next}`,
        recorded_at: new Date().toISOString(),
      });
      assert(stepped.ok, stepped.ok ? "" : stepped.detail);
      previous = stepped.ok ? stepped.record : previous;
    }
    const { persistPublicationPointer } = await import("../persist");
    persistPublicationPointer({
      work_id,
      command_id,
      dna_os_commit_sha: SHA,
      remote_sha: SHA,
      changed_paths: FILES,
      recorded_at: new Date().toISOString(),
      github_owner: d.owner,
      github_repository: d.repository,
      publish_branch: d.publish_branch,
      connection_id: d.connection_id,
      manifest_id: `erm-${work_id}`,
    });
    const inspection = inspectEngineeringRecovery(work_id);
    assert(inspection.safe_to_resume === true, inspection.detail);
    assert(inspection.stage === "CI_PENDING", inspection.stage);
    const recovered = await recoverEngineeringLoop({
      work_id,
      command_id,
      intent_text: intent,
      payload: {
        engineering_coding_intent: {
          authority: "ENGINEERING",
          allowed_paths: FILES,
          allowed_symbols: [],
          required_tests: ["sandbox.write", "sandbox.readback"],
          forbidden_paths: ["package.json"],
          requested_function: "zzqegate fixture marker",
          requested_change: intent,
          target_domain: "control/engineering-runtime/fixtures/completion",
          owner_intent: intent,
        },
      },
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      deps: {
        verifyPermanence: async (input) => {
          const row = {
            work_id: input.work_id,
            command_id: input.command_id,
            status: "CI_VERIFIED" as const,
            reason_code: "ADMITTED" as const,
            detail: "CI completed after restart",
            github_owner: input.github_owner,
            github_repository: input.github_repository,
            publish_branch: input.publish_branch,
            remote_sha: input.expected_sha,
            expected_sha: input.expected_sha,
            lineage_verified: true,
            expected_files_verified: true,
            expected_files: input.expected_files,
            observed_files: input.expected_files,
            ci_required: true,
            ci_run_ids: ["check:0:completed"],
            recorded_at: new Date().toISOString(),
          };
          persistGithubPublicationProof(row);
          return row;
        },
      },
    });
    live.G = { work_id, inspection: inspection.stage, recovered: recovered.status, same: recovered.work_id === work_id };
    assert(recovered.work_id === work_id, "same work_id");
    assert(recovered.status === "VERIFIED", `${recovered.status} ${recovered.detail}`);
  });

  await check("H. Owner result is generated from evidence, not worker claims", () => {
    const pending = ownerFacingEngineeringResult({ loop_status: "CI_PENDING", permanence_status: "CI_PENDING" });
    const ok = ownerFacingEngineeringResult({ loop_status: "VERIFIED", permanence_status: "CI_VERIFIED" });
    const repairing = ownerFacingEngineeringResult({ loop_status: "OWNER_REVIEW", permanence_status: "CI_FAILED", repairing: true });
    const owner = ownerFacingEngineeringResult({ loop_status: "OWNER_REVIEW" });
    live.H = { pending, ok, repairing, owner };
    assert(pending === "กำลังตรวจสอบบน GitHub", pending);
    assert(ok === "ตรวจสอบเรียบร้อย", ok);
    assert(repairing === "ตรวจไม่ผ่านและกำลังแก้ไข", repairing);
    assert(owner === "ต้องการการอนุมัติจาก Owner", owner);
    assert(!ok.includes("sha"), "no sha in owner face");
  });

  for (const file of [
    process.env.ENGINEERING_LIFECYCLE_LOG,
    process.env.ENGINEERING_SCOPE_LOCK_LOG,
    process.env.ENGINEERING_VERIFIED_CAPABILITY_LOG,
    process.env.ENGINEERING_PUBLICATION_POINTER_LOG,
    process.env.ENGINEERING_GITHUB_PROOF_LOG,
  ]) {
    try {
      if (file) unlinkSync(join(CHECKOUT, "control/engineering-runtime/data", file));
    } catch { /* absent */ }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`PERMANENCE_PROOF ${JSON.stringify(live, null, 2)}`);
  if (failed > 0) process.exitCode = 1;
}

main();
