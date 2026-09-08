/**
 * Deterministic A–K proofs for the Autonomous Engineering Loop.
 * GitHub publication uses an injected publish seam (no live push).
 *
 * How to run:
 *   npx tsx control/engineering-runtime/tests/autonomous-engineering-loop.test.ts
 */

import { execFileSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  inspectEngineeringRecovery,
  listLifecycle,
  listVerifiedCapabilities,
  persistGithubPublicationProof,
  persistScopeLock,
  recoverEngineeringLoop,
  resolveIsolatedEngineeringCheckout,
  removePublicationProofCheckout,
  runAutonomousEngineeringLoop,
  scriptedWorker,
  transitionLifecycle,
} from "../contract";
import type { GithubPublishDeps } from "../github-publish-authority";
import type { GithubPermanenceInput, GithubPermanenceProof } from "../github-permanence";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const CHECKOUT = process.cwd();
const CODE = "control/engineering-runtime/fixtures/completion/code-target.txt";
const DOC = "control/engineering-runtime/fixtures/completion/HUMAN.md";
const CONTRACT = "control/engineering-runtime/fixtures/completion/contract.json";
const REGISTRY = "control/engineering-runtime/fixtures/completion/registry-record.json";
const UNRELATED = "control/engineering-runtime/fixtures/completion/unrelated.txt";
const STAMP = Date.now();

process.env.ENGINEERING_LIFECYCLE_LOG = `lifecycle-loop-${STAMP}.jsonl`;
process.env.ENGINEERING_SCOPE_LOCK_LOG = `scope-locks-loop-${STAMP}.jsonl`;
process.env.ENGINEERING_VERIFIED_CAPABILITY_LOG = `verified-caps-loop-${STAMP}.jsonl`;
process.env.ENGINEERING_GITHUB_PROOF_LOG = `github-proofs-loop-${STAMP}.jsonl`;

const DATA = join(CHECKOUT, "control/engineering-runtime/data");

function payload(ownerIntent: string) {
  return {
    engineering_coding_intent: {
      authority: "ENGINEERING",
      allowed_paths: [CODE, DOC, CONTRACT, REGISTRY],
      allowed_symbols: [],
      required_tests: ["sandbox.write", "sandbox.readback"],
      forbidden_paths: [UNRELATED, "package.json"],
      requested_function: "zzqegate fixture marker",
      requested_change: ownerIntent,
      target_domain: "control/engineering-runtime/fixtures/completion",
      owner_intent: ownerIntent,
    },
  };
}

function writes(tag: string): readonly ProposedScopedWrite[] {
  return [
    { relative_path: CODE, content: `DNA_OS_LOOP ${tag}\n` },
    { relative_path: DOC, content: `# DNA OS loop ${tag}\n\nAutonomous Engineering Loop fixture.\n` },
    { relative_path: CONTRACT, content: `${JSON.stringify({ document_type: "engineering_fixture_contract", version: 1, proof: "autonomous-loop", tag }, null, 2)}\n` },
    { relative_path: REGISTRY, content: `${JSON.stringify({ record: "autonomous-loop", tag }, null, 2)}\n` },
  ];
}

function workId(): string {
  return `work-${randomUUID()}`;
}

function ciVerifiedPermanence() {
  return async (input: GithubPermanenceInput): Promise<GithubPermanenceProof> => {
    const row: GithubPermanenceProof = {
      work_id: input.work_id,
      command_id: input.command_id,
      status: "CI_VERIFIED",
      reason_code: "ADMITTED",
      detail: "no GitHub Actions workflows on this commit",
      github_owner: input.github_owner,
      github_repository: input.github_repository,
      publish_branch: input.publish_branch,
      remote_sha: input.expected_sha,
      expected_sha: input.expected_sha,
      lineage_verified: true,
      expected_files_verified: true,
      expected_files: input.expected_files,
      observed_files: input.expected_files,
      ci_required: false,
      ci_run_ids: [],
      recorded_at: new Date().toISOString(),
    };
    persistGithubPublicationProof(row);
    return row;
  };
}

function mockPublish(checkoutRoot: string, mode: "ok" | "fail_push"): GithubPublishDeps {
  const parent = execFileSync("git", ["rev-parse", "HEAD"], { cwd: checkoutRoot, encoding: "utf8" }).trim();
  let pushed = "";
  return {
    resolveCredential: async () => ({ ok: true, token: "test-token-not-logged", credential_source: "test-seam" }),
    lookupRepo: async () => ({ kind: "found", http_status: 200, default_branch: "main", visibility: "private" }),
    lookupBranch: async () => ({
      kind: "found",
      http_status: 200,
      head_commit_sha: pushed || parent,
      head_commit_at: null,
      branch_protected: false,
    }),
    gitPush: (args) => {
      if (mode === "fail_push") return { ok: false, detail: "injected GitHub push failure" };
      pushed = args.commit_sha;
      return { ok: true, output: "ok" };
    },
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
    console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const isolated = await resolveIsolatedEngineeringCheckout(CHECKOUT);
  assert(isolated.ok, isolated.ok ? "" : `${isolated.reason_code} ${isolated.detail}`);
  if (!isolated.ok) {
    process.exitCode = 1;
    return;
  }
  const proofRoot = isolated.checkout_root;

  await check("A. Owner command creates one engineering lifecycle", async () => {
    const id = workId();
    const intent = `loop-a-${id}`;
    const result = await runAutonomousEngineeringLoop({
      command_id: `cmd_loop_a_${randomUUID()}`,
      work_id: id,
      intent_text: intent,
      payload: payload(intent),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      deps: { worker: scriptedWorker("engineering-worker://a", [[]]), max_repair_attempts: 1 },
    });
    const rows = listLifecycle().filter((row) => row.work_id === id);
    live.A = { work_id: id, status: result.status, requested: rows.filter((row) => row.stage === "REQUESTED").length, stages: rows.map((row) => row.stage) };
    assert(rows.filter((row) => row.stage === "REQUESTED").length === 1, "exactly one REQUESTED");
    assert(result.work_id === id, "canonical work_id");
    assert(result.status === "FAILED", result.status);
  });

  await check("B. valid code → validation → GitHub seam → registry → VERIFIED", async () => {
    const id = workId();
    const intent = `loop-b-${id}`;
    const tag = `b-${id}`;
    const result = await runAutonomousEngineeringLoop({
      command_id: `cmd_loop_b_${randomUUID()}`,
      work_id: id,
      intent_text: intent,
      payload: payload(intent),
      checkout_root: proofRoot,
      selected_capability_id: "engineering-runtime",
      deps: {
        worker: scriptedWorker("engineering-worker://b", [writes(tag)]),
        publish: mockPublish(proofRoot, "ok"),
        verifyPermanence: ciVerifiedPermanence(),
      },
    });
    live.B = { work_id: id, status: result.status, registry_written: result.registry_written, sha: result.publication?.lineage.dna_os_commit_sha ?? null };
    assert(result.status === "VERIFIED", `${result.status} ${result.reason_code} ${result.detail}`);
    assert(result.registry_written === true, "registry after verify");
    assert(result.publication?.status === "VERIFIED", "github verified");
    assert(result.publication?.lineage.dna_os_commit_sha === result.publication?.lineage.post_publish_remote_sha, "remote SHA match");
    assert(listVerifiedCapabilities().some((row) => row.work_id === id), "capability registered");
  });

  await check("C. invalid then automatic repair → VERIFIED without Owner intervention", async () => {
    const id = workId();
    const intent = `loop-c-${id}`;
    const tag = `c-${id}`;
    const result = await runAutonomousEngineeringLoop({
      command_id: `cmd_loop_c_${randomUUID()}`,
      work_id: id,
      intent_text: intent,
      payload: payload(intent),
      checkout_root: proofRoot,
      selected_capability_id: "engineering-runtime",
      deps: {
        worker: scriptedWorker("engineering-worker://c", [
          [{ relative_path: "package.json", content: "bad" }],
          writes(tag),
        ]),
        publish: mockPublish(proofRoot, "ok"),
        verifyPermanence: ciVerifiedPermanence(),
        max_repair_attempts: 3,
      },
    });
    live.C = { work_id: id, status: result.status, repair_count: result.repair_count };
    assert(result.status === "VERIFIED", `${result.status} ${result.detail}`);
    assert(result.repair_count >= 1, "repair ran");
    assert(listLifecycle().some((row) => row.work_id === id && row.stage === "REPAIR_REQUIRED"), "REPAIR_REQUIRED recorded");
  });

  await check("D. repeated invalid → stop, no publish, no registry", async () => {
    let publishCalled = false;
    const id = workId();
    const intent = `loop-d-${id}`;
    const result = await runAutonomousEngineeringLoop({
      command_id: `cmd_loop_d_${randomUUID()}`,
      work_id: id,
      intent_text: intent,
      payload: payload(intent),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      deps: {
        worker: scriptedWorker("engineering-worker://d", [[]]),
        max_repair_attempts: 3,
        publish: {
          gitPush: () => {
            publishCalled = true;
            return { ok: false, detail: "must not run" };
          },
        },
      },
    });
    live.D = { work_id: id, status: result.status, publishCalled, registry: listVerifiedCapabilities().some((row) => row.work_id === id) };
    assert(result.status === "FAILED", result.status);
    assert(result.reason_code === "REPAIR_EXHAUSTED", String(result.reason_code));
    assert(publishCalled === false, "must not publish");
    assert(!listVerifiedCapabilities().some((row) => row.work_id === id), "must not register");
  });

  await check("E. process restart resumes the same canonical work_id", async () => {
    const id = workId();
    const intent = `loop-e-${id}`;
    const fingerprint = (await import("../lifecycle")).fingerprintEngineeringAction(intent, [CODE, DOC, CONTRACT, REGISTRY]);
    const started = transitionLifecycle({
      previous: null,
      next: "REQUESTED",
      work_id: id,
      command_id: `cmd_loop_e_${randomUUID()}`,
      attempt: 0,
      worker_id: null,
      action_fingerprint: fingerprint,
      allowed_paths: [CODE, DOC, CONTRACT, REGISTRY],
      reservation_id: null,
      reason_code: "LIFECYCLE",
      detail: "simulated crash after REQUESTED",
      evidence_ref: "ev-loop-e",
      recorded_at: new Date().toISOString(),
    });
    assert(started.ok, "seed REQUESTED");
    const inspection = inspectEngineeringRecovery(id);
    assert(inspection.safe_to_resume === true, inspection.detail);
    assert(inspection.stage === "REQUESTED", inspection.stage);
    const result = await recoverEngineeringLoop({
      work_id: id,
      command_id: `cmd_loop_e_resume_${randomUUID()}`,
      intent_text: intent,
      payload: payload(intent),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      deps: { worker: scriptedWorker("engineering-worker://e", [[]]), max_repair_attempts: 1 },
    });
    const requested = listLifecycle().filter((row) => row.work_id === id && row.stage === "REQUESTED");
    live.E = { work_id: id, status: result.status, requested: requested.length, resume_stage: inspection.stage };
    assert(result.work_id === id, "same work_id");
    assert(requested.length === 1, `duplicate REQUESTED ${requested.length}`);
    assert(listLifecycle().some((row) => row.work_id === id && row.stage === "SCOPED"), "resumed past REQUESTED");
  });

  await check("F. duplicate Owner command does not start a second lifecycle", async () => {
    const first = workId();
    const intent = `loop-f-${first}`;
    await runAutonomousEngineeringLoop({
      command_id: `cmd_loop_f1_${randomUUID()}`,
      work_id: first,
      intent_text: intent,
      payload: payload(intent),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      deps: { worker: scriptedWorker("engineering-worker://f", [[]]), max_repair_attempts: 3 },
    });
    const second = workId();
    const dup = await runAutonomousEngineeringLoop({
      command_id: `cmd_loop_f2_${randomUUID()}`,
      work_id: second,
      intent_text: intent,
      payload: payload(intent),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      deps: { worker: scriptedWorker("engineering-worker://f2", [[]]), max_repair_attempts: 1 },
    });
    const secondRows = listLifecycle().filter((row) => row.work_id === second);
    live.F = { first, second, dup_status: dup.status, dup_work: dup.work_id, second_rows: secondRows.length };
    assert(dup.work_id === first, "replay canonical work_id");
    assert(secondRows.length === 0, "no lifecycle for duplicate work_id");
  });

  await check("G. two workers cannot modify the same reserved scope", async () => {
    const holder = workId();
    persistScopeLock({ work_id: holder, allowed_paths: [CODE, DOC, CONTRACT, REGISTRY], active: true, recorded_at: new Date().toISOString() });
    const id = workId();
    const intent = `loop-g-${id}`;
    const result = await runAutonomousEngineeringLoop({
      command_id: `cmd_loop_g_${randomUUID()}`,
      work_id: id,
      intent_text: intent,
      payload: payload(intent),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      deps: { worker: scriptedWorker("engineering-worker://g", [writes("g")]), skip_publish: true },
    });
    live.G = { work_id: id, status: result.status, reason_code: result.reason_code };
    assert(result.status === "BLOCKED", result.status);
    assert(result.reason_code === "SCOPE_LOCKED", String(result.reason_code));
    persistScopeLock({ work_id: holder, allowed_paths: [CODE], active: false, recorded_at: new Date().toISOString() });
  });

  await check("H. worker replacement keeps the same work and evidence chain", async () => {
    const id = workId();
    const intent = `loop-h-${id}`;
    const fingerprint = (await import("../lifecycle")).fingerprintEngineeringAction(intent, [CODE, DOC, CONTRACT, REGISTRY]);
    transitionLifecycle({
      previous: null,
      next: "REQUESTED",
      work_id: id,
      command_id: `cmd_loop_h_${randomUUID()}`,
      attempt: 0,
      worker_id: null,
      action_fingerprint: fingerprint,
      allowed_paths: [CODE, DOC, CONTRACT, REGISTRY],
      reservation_id: null,
      reason_code: "LIFECYCLE",
      detail: "awaiting replacement worker",
      evidence_ref: "ev-loop-h",
      recorded_at: new Date().toISOString(),
    });
    const replacement = scriptedWorker("engineering-worker://replacement", [[]]);
    const result = await recoverEngineeringLoop({
      work_id: id,
      command_id: `cmd_loop_h_resume_${randomUUID()}`,
      intent_text: intent,
      payload: payload(intent),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      deps: { worker: replacement, max_repair_attempts: 1 },
    });
    const rows = listLifecycle().filter((row) => row.work_id === id);
    live.H = { work_id: id, worker_id: result.worker_id, stages: rows.map((row) => row.stage) };
    assert(result.work_id === id, "same work_id after replacement");
    assert(result.worker_id === "engineering-worker://replacement", String(result.worker_id));
    assert(rows[0]?.worker_id === null, "first evidence has no worker");
    assert(rows.some((row) => row.worker_id === "engineering-worker://replacement"), "replacement recorded on same chain");
  });

  await check("I. GitHub failure does not cause registry success", async () => {
    const id = workId();
    const intent = `loop-i-${id}`;
    const result = await runAutonomousEngineeringLoop({
      command_id: `cmd_loop_i_${randomUUID()}`,
      work_id: id,
      intent_text: intent,
      payload: payload(intent),
      checkout_root: proofRoot,
      selected_capability_id: "engineering-runtime",
      deps: {
        worker: scriptedWorker("engineering-worker://i", [writes(`i-${id}`)]),
        publish: mockPublish(proofRoot, "fail_push"),
      },
    });
    live.I = { work_id: id, status: result.status, registry_written: result.registry_written };
    assert(result.status === "BLOCKED", result.status);
    assert(result.registry_written === false, "registry must not succeed");
    assert(!listVerifiedCapabilities().some((row) => row.work_id === id), "unverified not registered");
  });

  await check("J. registry failure after GitHub is recorded and recoverable", async () => {
    const id = workId();
    const intent = `loop-j-${id}`;
    let fail = true;
    const registryWrite = () => {
      if (fail) {
        fail = false;
        return { ok: false as const, detail: "injected registry failure" };
      }
      return { ok: true as const };
    };
    const first = await runAutonomousEngineeringLoop({
      command_id: `cmd_loop_j_${randomUUID()}`,
      work_id: id,
      intent_text: intent,
      payload: payload(intent),
      checkout_root: proofRoot,
      selected_capability_id: "engineering-runtime",
      deps: {
        worker: scriptedWorker("engineering-worker://j", [writes(`j-${id}`)]),
        publish: mockPublish(proofRoot, "ok"),
        verifyPermanence: ciVerifiedPermanence(),
        registryWrite,
      },
    });
    assert(first.status === "BLOCKED", first.status);
    assert(first.reason_code === "REGISTRY_WRITE_FAILED", String(first.reason_code));
    assert(first.lifecycle?.stage === "REGISTRY_UPDATE", first.lifecycle?.stage);
    assert(first.registry_written === false, "first registry write failed");
    const recovered = await recoverEngineeringLoop({
      work_id: id,
      command_id: `cmd_loop_j_resume_${randomUUID()}`,
      intent_text: intent,
      payload: payload(intent),
      checkout_root: proofRoot,
      selected_capability_id: "engineering-runtime",
      deps: { registryWrite, publish: mockPublish(proofRoot, "ok"), verifyPermanence: ciVerifiedPermanence() },
    });
    live.J = { work_id: id, first: first.status, recovered: recovered.status, registry_written: recovered.registry_written };
    assert(recovered.work_id === id, "same work_id");
    assert(recovered.status === "VERIFIED", `${recovered.status} ${recovered.detail}`);
    assert(recovered.registry_written === true, "registry recovered");
  });

  await check("K. failed/unverified code is not registered as available capability", () => {
    const registered = listVerifiedCapabilities();
    const failedIds = Object.values(live)
      .map((row) => (row && typeof row === "object" && "work_id" in row ? String((row as { work_id: string }).work_id) : ""))
      .filter(Boolean);
    const d = (live.D as { work_id?: string } | undefined)?.work_id;
    const i = (live.I as { work_id?: string } | undefined)?.work_id;
    const a = (live.A as { work_id?: string } | undefined)?.work_id;
    live.K = { registered: registered.length, denied: [a, d, i] };
    assert(d ? !registered.some((row) => row.work_id === d) : true, "D not registered");
    assert(i ? !registered.some((row) => row.work_id === i) : true, "I not registered");
    assert(a ? !registered.some((row) => row.work_id === a) : true, "A not registered");
    void failedIds;
  });

  if (isolated.proof) removePublicationProofCheckout(isolated.proof);
  for (const file of [
    process.env.ENGINEERING_LIFECYCLE_LOG,
    process.env.ENGINEERING_SCOPE_LOCK_LOG,
    process.env.ENGINEERING_VERIFIED_CAPABILITY_LOG,
    process.env.ENGINEERING_PUBLICATION_POINTER_LOG,
    process.env.ENGINEERING_GITHUB_PROOF_LOG,
  ]) {
    try {
      if (file) unlinkSync(join(DATA, file));
    } catch {
      /* absent is fine */
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`LOOP_PROOF ${JSON.stringify(live, null, 2)}`);
  if (failed > 0) process.exitCode = 1;
}

main();
