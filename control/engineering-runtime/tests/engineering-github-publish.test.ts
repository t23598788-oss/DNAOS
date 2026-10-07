/**
 * หน้าที่: live proofs for DNA OS Commit Authority and GitHub Publish
 * Authority, plus closed-door denials for direct GitHub source writes.
 *
 * How to run: npx tsx control/engineering-runtime/tests/engineering-github-publish.test.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { putFileContents } from "../../../connections/github/write-api";
import { isRegisteredGithubSourceAuthorityTarget } from "../../../connections/github/authoritative-source";
import { GITHUB_INTENTS } from "../../../connections/github/adapter-contract";
import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import { routeOwnerCommand } from "../../command-router/contract";
import { loadReservation, removeWorkspace } from "../../source-workspace/contract";
import {
  completeEngineeringWork,
  denyWorkerGithubWrite,
  githubGitHttpAuthorizationHeader,
  publishDnaOsCommit,
  publishEngineeringSource,
  resolveGithubDestination,
  SOURCE_PUBLICATION_INVARIANTS,
  WORKER_DENIED_OPERATIONS,
} from "../contract";

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

function payload() {
  return {
    engineering_coding_intent: {
      authority: "ENGINEERING",
      allowed_paths: [CODE, DOC, CONTRACT, REGISTRY],
      allowed_symbols: [],
      required_tests: ["sandbox.write", "sandbox.readback"],
      forbidden_paths: [UNRELATED, "package.json"],
      requested_function: "zzqegate fixture marker",
      requested_change: "github publish fixture set",
      target_domain: "control/engineering-runtime/fixtures/completion",
      owner_intent: "engineering github publish live proof",
    },
  };
}

function writes(commandId: string) {
  return [
    { relative_path: CODE, content: `ENGINEERING_PUBLISH ${commandId}\n` },
    { relative_path: DOC, content: `# Engineering publish ${commandId}\n\nProduced in the same Engineering work order.\n` },
    { relative_path: CONTRACT, content: `${JSON.stringify({ document_type: "engineering_fixture_contract", version: 1, command_id: commandId }, null, 2)}\n` },
    { relative_path: REGISTRY, content: `${JSON.stringify({ record: "verified-publish", command_id: commandId }, null, 2)}\n` },
  ];
}

function envelope(intent: string, body: unknown): CommandEnvelope {
  return {
    command_id: `cmd_${randomUUID()}`,
    issued_by: {
      identity_id: "identity-engineering-publish-test",
      acting_as_account_id: "account-engineering-publish-test",
      acting_as_tenant_id: "tenant-engineering-publish-test",
      software_id: "software-engineering-publish-test",
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

function assert(condition: boolean, message: string): asserts condition {
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
  const dest = resolveGithubDestination({
    repository_id: "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-",
    checkout_root: CHECKOUT,
  });
  live.registered_destination = dest.ok
    ? {
        repository_id: dest.destination.repository_id,
        owner: dest.destination.owner,
        repository: dest.destination.repository,
        publish_branch: dest.destination.publish_branch,
        remote_url: dest.destination.remote_url,
        connection_id: dest.destination.connection_id,
        credential_ref: dest.destination.credential_ref,
        local_default_branch_sha: dest.destination.local_default_branch_sha,
      }
    : { ok: false, reason_code: dest.reason_code, detail: dest.detail };

  await check("git-over-HTTPS uses Basic x-access-token, never Bearer or URL-embedded secrets", () => {
    const token = "test-token-not-logged";
    const header = githubGitHttpAuthorizationHeader(token);
    assert(header.startsWith("Authorization: Basic "), header);
    assert(!header.includes(token), "raw token must not appear in the header string beyond encoding");
    assert(!header.toLowerCase().includes("bearer"), "git HTTP must not use Bearer");
    const encoded = header.slice("Authorization: Basic ".length);
    assert(Buffer.from(encoded, "base64").toString("utf8") === `x-access-token:${token}`, "decoded basic credentials");
  });

  await check("registered GitHub destination resolves from registry only", () => {
    assert(dest.ok, `destination failed: ${!dest.ok ? `${dest.reason_code} ${dest.detail}` : ""}`);
    if (!dest.ok) return;
    assert(dest.destination.owner === "t23598788-oss", "owner mismatch");
    assert(dest.destination.repository === "-DNA-OS-INFRASTRUCTURE-", "repository mismatch");
    assert(dest.destination.publish_branch === "main", "publish branch must be registered default_branch");
    assert(dest.destination.credential_ref.includes("credential://github/") || dest.destination.credential_ref.startsWith("env:"), "credential ref must be a reference, not a secret");
    assert(!dest.destination.credential_ref.includes("ghp_"), "credential ref must not contain a token");
  });

  await check("A. admitted result → DNA OS commit/publish or honest BLOCKED", async () => {
    const commandId = `cmd_eng_publish_a_${randomUUID()}`;
    const completion = await completeEngineeringWork({
      command_id: commandId,
      intent_text: "zzqegate fixture marker",
      payload: payload(),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      proposed_writes: writes(commandId),
    });
    try {
      assert(completion.status === "VERIFIED", `local completion expected VERIFIED, got ${completion.status} ${completion.reason_code} ${completion.detail}`);
      const publication = await publishEngineeringSource({ completion, checkout_root: CHECKOUT });
      live.proof_a = {
        command_id: completion.lineage.command_id,
        work_id: completion.lineage.work_id,
        repository_id: completion.lineage.repository_id,
        reservation_id: completion.lineage.reservation_id,
        manifest_id: completion.lineage.manifest_id,
        local_status: completion.status,
        publish_status: publication.status,
        reason_code: publication.reason_code,
        detail: publication.detail,
        dna_os_commit_sha: publication.lineage.dna_os_commit_sha ?? null,
        github_destination: publication.lineage.github_owner && publication.lineage.github_repository
          ? `${publication.lineage.github_owner}/${publication.lineage.github_repository}`
          : null,
        pre_publish_remote_sha: publication.lineage.pre_publish_remote_sha ?? null,
        post_publish_remote_sha: publication.lineage.post_publish_remote_sha ?? null,
        remote_sha_equals_commit: publication.publish?.published === true
          && publication.publish.post_publish_remote_sha === publication.commit?.commit_sha,
        force_push_attempted: publication.publish?.force_push_attempted ?? false,
      };
      assert(publication.status === "VERIFIED" || publication.status === "BLOCKED", `expected VERIFIED or honest BLOCKED, got ${publication.status}`);
      if (publication.status === "VERIFIED") {
        assert(publication.publish !== null, "VERIFIED requires publish result");
        const published = publication.publish;
        assert(published.published === true, "VERIFIED requires published=true");
        assert(published.post_publish_remote_sha === publication.commit?.commit_sha, "remote SHA must equal DNA OS commit SHA");
        assert(published.force_push_attempted === false, "force push must not be attempted");
      } else {
        assert(
          publication.reason_code === "UNRELATED_CHANGE_PRESENT"
            || publication.reason_code === "CREDENTIAL_UNAVAILABLE"
            || publication.reason_code === "GITHUB_PUBLISH_BLOCKED"
            || publication.reason_code === "REMOTE_HEAD_MOVED"
            || publication.reason_code === "BASE_REVISION_MISMATCH"
            || publication.reason_code === "LOCAL_COMMIT_NOT_ADMITTED",
          `unexpected BLOCKED reason ${publication.reason_code}`,
        );
      }
    } finally {
      restoreCheckout();
      await cleanup(completion.lineage.reservation_id, completion.coding.admission.repository_root);
    }
  });

  await check("B. worker/external direct GitHub source write → DENY", async () => {
    assert(WORKER_DENIED_OPERATIONS.COMMIT === "DENY", "COMMIT");
    assert(WORKER_DENIED_OPERATIONS.PUSH === "DENY", "PUSH");
    const worker = denyWorkerGithubWrite("CODING_WORKER has no GitHub write credential or push authority");
    assert(worker.published === false, "worker publish must be false");
    assert(worker.reason_code === "WORKER_GITHUB_WRITE_DENIED", worker.reason_code);
    assert(worker.force_push_attempted === false, "no force");
    assert(Object.values(GITHUB_INTENTS).every((intent) => !intent.includes("write") && !intent.includes("push") && !intent.includes("commit")), "GitHub adapter intents must remain read-only");
    if (!dest.ok) throw new Error("registered destination required for Contents denial");
    assert(isRegisteredGithubSourceAuthorityTarget({ owner: dest.destination.owner, repo: dest.destination.repository }), "registered target must be Contents-closed");
    const contents = await putFileContents(
      "this-is-not-a-github-token",
      { owner: dest.destination.owner, repo: dest.destination.repository, branch: dest.destination.publish_branch },
      "README.md",
      "worker-write",
      "worker commit",
    );
    assert(contents.kind === "failed", "Contents write must fail closed");
    assert(contents.reason.includes("DNA_OS_PUBLISH_AUTHORITY_REQUIRED"), contents.reason);
    live.proof_b = { worker: worker.reason_code, contents: contents.reason };
  });

  await check("C. publish to another repository → DENY", () => {
    const other = resolveGithubDestination({
      repository_id: "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-",
      checkout_root: CHECKOUT,
      requested: { owner: "some-other-org", repository: "-DNA-OS-INFRASTRUCTURE-" },
    });
    assert(!other.ok, "other-org destination must be denied");
    assert(other.ok === false && other.reason_code === "REMOTE_IDENTITY_MISMATCH", other.ok === false ? other.reason_code : "ok");
    live.proof_c = { reason_code: other.ok === false ? other.reason_code : "ok" };
  });

  await check("D. branch outside registered policy → DENY", () => {
    const other = resolveGithubDestination({
      repository_id: "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-",
      checkout_root: CHECKOUT,
      requested: { branch: "feature-unregistered" },
    });
    assert(!other.ok, "unregistered branch must be denied");
    assert(other.ok === false && other.reason_code === "BRANCH_POLICY_DENIED", other.ok === false ? other.reason_code : "ok");
    live.proof_d = { reason_code: other.ok === false ? other.reason_code : "ok" };
  });

  await check("E. unrelated local modification → commit/publication DENY", async () => {
    const commandId = `cmd_eng_publish_e_${randomUUID()}`;
    const completion = await completeEngineeringWork({
      command_id: commandId,
      intent_text: "zzqegate fixture marker",
      payload: payload(),
      checkout_root: CHECKOUT,
      selected_capability_id: "engineering-runtime",
      proposed_writes: writes(commandId),
    });
    try {
      const publication = await publishEngineeringSource({ completion, checkout_root: CHECKOUT });
      live.proof_e = { status: publication.status, reason_code: publication.reason_code, committed: publication.commit?.committed ?? false };
      assert(publication.status === "BLOCKED", `expected BLOCKED, got ${publication.status} ${publication.reason_code}`);
      assert(publication.reason_code === "UNRELATED_CHANGE_PRESENT" || publication.commit?.reason_code === "UNRELATED_CHANGE_PRESENT", publication.reason_code);
      assert(publication.publish === null || publication.publish.published === false, "must not publish");
    } finally {
      restoreCheckout();
      await cleanup(completion.lineage.reservation_id, completion.coding.admission.repository_root);
    }
  });

  await check("F. remote head moved → REMOTE_HEAD_MOVED, no force push", async () => {
    if (!dest.ok) throw new Error("destination required");
    let pushCalled = false;
    const result = await publishDnaOsCommit({
      destination: dest.destination,
      commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expected_remote_sha: dest.destination.local_default_branch_sha,
      deps: {
        resolveCredential: async () => ({ ok: true, token: "test-token-not-logged", credential_source: "test-seam" }),
        lookupRepo: async () => ({ kind: "found", http_status: 200, default_branch: "main", visibility: "private", repository_id: "1" }),
        lookupBranch: async () => ({ kind: "found", http_status: 200, head_commit_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", head_commit_at: null, branch_protected: false }),
        gitPush: () => {
          pushCalled = true;
          return { ok: false, detail: "push must not run" };
        },
      },
    });
    live.proof_f = { reason_code: result.reason_code, pushCalled, force_push_attempted: result.force_push_attempted };
    assert(result.reason_code === "REMOTE_HEAD_MOVED", result.reason_code);
    assert(result.published === false, "must not publish");
    assert(pushCalled === false, "git push must not run");
    assert(result.force_push_attempted === false, "force push denied");
  });

  await check("G. GitHub credential unavailable → fail closed, no worker fallback", async () => {
    if (!dest.ok) throw new Error("destination required");
    let pushCalled = false;
    const result = await publishDnaOsCommit({
      destination: dest.destination,
      commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expected_remote_sha: dest.destination.local_default_branch_sha,
      deps: {
        resolveCredential: async () => ({ ok: false, reason: "Keychain item missing" }),
        gitPush: () => {
          pushCalled = true;
          return { ok: false, detail: "must not run" };
        },
      },
    });
    live.proof_g = { reason_code: result.reason_code, pushCalled };
    assert(result.reason_code === "CREDENTIAL_UNAVAILABLE", result.reason_code);
    assert(pushCalled === false, "push must not run without credential");
    assert(result.published === false, "must not publish");
  });

  await check("H. Business command never reaches commit or GitHub publication", async () => {
    const env = envelope("ตรวจสถานะ firewall", payload());
    const result = await routeOwnerCommand(env, "ตรวจสถานะ firewall");
    live.proof_h = { command_id: env.command_id, capability_id: result.capability_id, status: result.status };
    assert(result.capability_id === "os-login", `expected os-login, got ${result.capability_id}`);
    assert(result.evidence.every((row) => !row.note.includes("github_publish_status=")), "Business path must not emit github_publish_status");
    assert(result.evidence.every((row) => !row.note.includes("dna_os_commit_sha=")), "Business path must not emit DNA OS commit SHA lineage");
  });

  await check("invariants: EXTERNAL_AI_SOURCE_WRITE denied by architecture", () => {
    assert(SOURCE_PUBLICATION_INVARIANTS.EXTERNAL_AI_SOURCE_WRITE === "DENIED_BY_ARCHITECTURE", "invariant");
    assert(SOURCE_PUBLICATION_INVARIANTS.AUTHORITATIVE_GITHUB_WRITE_PATH_COUNT === 1, "write path count");
    assert(SOURCE_PUBLICATION_INVARIANTS.DEPLOYMENT === "NOT_WIRED", "deploy");
  });

  restoreCheckout();
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`LIVE_PROOF ${JSON.stringify(live)}`);
  if (failed > 0) process.exitCode = 1;
}

main();
