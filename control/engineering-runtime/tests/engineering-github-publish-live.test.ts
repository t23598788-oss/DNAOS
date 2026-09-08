/**
 * หน้าที่: live remote publication proof on a DNA OS clean proof
 * checkout. Does not stash, reset, or discard unrelated files in the
 * authoritative working tree.
 *
 * How to run: npx tsx control/engineering-runtime/tests/engineering-github-publish-live.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { putFileContents } from "../../../connections/github/write-api";
import { GITHUB_INTENTS } from "../../../connections/github/adapter-contract";
import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import { routeOwnerCommand } from "../../command-router/contract";
import { loadReservation, removeWorkspace } from "../../source-workspace/contract";
import {
  completeEngineeringWork,
  corroborateAuthenticatedGithubRemote,
  createPublicationProofCheckout,
  denyWorkerGithubWrite,
  publishDnaOsCommit,
  publishEngineeringSource,
  removePublicationProofCheckout,
  resolveGithubDestination,
  SOURCE_PUBLICATION_INVARIANTS,
  WORKER_DENIED_OPERATIONS,
} from "../contract";
import { projectOwnerActivity, listDisplayQueue } from "../../event-pipeline/contract";
import { eventsForCommand, onSystemEvent } from "../../owner-backbone/contract";
import type { SystemEvent } from "../../owner-backbone/contract";

declare const process: { cwd(): string; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const CHECKOUT = process.cwd();
const REPO_ID = "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-";
const CODE = "control/engineering-runtime/fixtures/completion/code-target.txt";
const DOC = "control/engineering-runtime/fixtures/completion/HUMAN.md";
const CONTRACT = "control/engineering-runtime/fixtures/completion/contract.json";
const REGISTRY = "control/engineering-runtime/fixtures/completion/registry-record.json";
const UNRELATED = "control/engineering-runtime/fixtures/completion/unrelated.txt";

function payload() {
  return {
    engineering_coding_intent: {
      authority: "ENGINEERING",
      allowed_paths: [CODE, DOC, CONTRACT, REGISTRY],
      allowed_symbols: [],
      required_tests: ["sandbox.write", "sandbox.readback"],
      forbidden_paths: [UNRELATED, "package.json"],
      requested_function: "zzqegate fixture marker",
      requested_change: "live GitHub publication proof",
      target_domain: "control/engineering-runtime/fixtures/completion",
      owner_intent: "DNA OS live GitHub publish proof",
    },
  };
}

function writes(commandId: string) {
  return [
    { relative_path: CODE, content: `DNA_OS_LIVE_GITHUB_PUBLISH ${commandId}\n` },
    { relative_path: DOC, content: `# DNA OS live GitHub publish ${commandId}\n\nDisposable Engineering proof produced through DNA OS only.\n` },
    { relative_path: CONTRACT, content: `${JSON.stringify({ document_type: "engineering_fixture_contract", version: 1, command_id: commandId, proof: "live-github-publish" }, null, 2)}\n` },
    { relative_path: REGISTRY, content: `${JSON.stringify({ record: "live-github-publish", command_id: commandId }, null, 2)}\n` },
  ];
}

function envelope(intent: string, body: unknown): CommandEnvelope {
  return {
    command_id: `cmd_${randomUUID()}`,
    issued_by: {
      identity_id: "identity-engineering-publish-live",
      acting_as_account_id: "account-engineering-publish-live",
      acting_as_tenant_id: "tenant-engineering-publish-live",
      software_id: "software-engineering-publish-live",
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
  const destFromAuthoritative = resolveGithubDestination({ repository_id: REPO_ID, checkout_root: CHECKOUT });
  live.registered_destination = destFromAuthoritative.ok
    ? {
        repository_id: destFromAuthoritative.destination.repository_id,
        owner: destFromAuthoritative.destination.owner,
        repository: destFromAuthoritative.destination.repository,
        publish_branch: destFromAuthoritative.destination.publish_branch,
        credential_ref: destFromAuthoritative.destination.credential_ref,
      }
    : { ok: false, reason_code: destFromAuthoritative.reason_code, detail: destFromAuthoritative.detail };

  await check("registered destination resolves from authoritative checkout without mutating it", () => {
    assert(destFromAuthoritative.ok, destFromAuthoritative.ok ? "" : `${destFromAuthoritative.reason_code} ${destFromAuthoritative.detail}`);
  });

  if (!destFromAuthoritative.ok) {
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log(`LIVE_PROOF ${JSON.stringify(live)}`);
    process.exitCode = 1;
    return;
  }

  const auth = await corroborateAuthenticatedGithubRemote(destFromAuthoritative.destination);
  live.authenticated_remote = auth.ok
    ? {
        owner: auth.remote.owner,
        repository: auth.remote.repository,
        branch: auth.remote.branch,
        remote_head_sha: auth.remote.remote_head_sha,
        credential_ref: auth.remote.credential_ref,
        credential_source: auth.remote.credential_source,
        authenticated_login: auth.remote.authenticated_login,
      }
    : { ok: false, reason_code: auth.reason_code, detail: auth.detail };

  await check("Keychain credential authenticates registered GitHub identity or fails closed", () => {
    if (!auth.ok) {
      assert(
        auth.reason_code === "CREDENTIAL_UNAVAILABLE"
          || auth.reason_code === "CREDENTIAL_INVALID"
          || auth.reason_code === "REPOSITORY_NOT_ACCESSIBLE"
          || auth.reason_code === "REMOTE_IDENTITY_MISMATCH"
          || auth.reason_code === "REMOTE_NOT_FOUND",
        `unexpected auth reason ${auth.reason_code}`,
      );
      return;
    }
    assert(auth.remote.owner === "t23598788-oss", auth.remote.owner);
    assert(auth.remote.repository === "-DNA-OS-INFRASTRUCTURE-", auth.remote.repository);
    assert(auth.remote.branch === "main", auth.remote.branch);
    assert(auth.remote.credential_ref === "credential://github/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/source-authority", auth.remote.credential_ref);
    assert(!auth.remote.credential_source.includes("ghp_"), "credential_source must not contain a token");
    assert(auth.remote.remote_head_sha.length === 40, "remote HEAD SHA required");
  });

  const proof = createPublicationProofCheckout({
    repository_id: REPO_ID,
    authoritative_root: CHECKOUT,
    at_commit_sha: auth.ok ? auth.remote.remote_head_sha : undefined,
  });
  live.proof_checkout = proof.ok
    ? { proof_root: proof.checkout.proof_root, base_commit_sha: proof.checkout.base_commit_sha, repository_id: proof.checkout.repository_id }
    : { ok: false, reason_code: proof.reason_code, detail: proof.detail };

  await check("clean publication proof checkout corroborates the same repository_id", () => {
    assert(proof.ok, proof.ok ? "" : `${proof.reason_code} ${proof.detail}`);
    if (!proof.ok) return;
    const dest = resolveGithubDestination({ repository_id: REPO_ID, checkout_root: proof.checkout.proof_root });
    assert(dest.ok, dest.ok ? "" : dest.detail);
    if (!dest.ok) return;
    assert(dest.destination.repository_id === REPO_ID, dest.destination.repository_id);
    assert(dest.destination.owner === "t23598788-oss", dest.destination.owner);
    assert(dest.destination.repository === "-DNA-OS-INFRASTRUCTURE-", dest.destination.repository);
    assert(dest.destination.publish_branch === "main", dest.destination.publish_branch);
    assert(dest.destination.local_default_branch_sha === proof.checkout.base_commit_sha, "proof checkout HEAD must equal publication base");
  });

  if (!proof.ok || !destFromAuthoritative.ok) {
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log(`LIVE_PROOF ${JSON.stringify(live)}`);
    process.exitCode = 1;
    return;
  }

  const destOnProof = resolveGithubDestination({ repository_id: REPO_ID, checkout_root: proof.checkout.proof_root });
  assert(destOnProof.ok, "proof destination must resolve");
  if (!destOnProof.ok) {
    removePublicationProofCheckout(proof.checkout);
    process.exitCode = 1;
    return;
  }

  await check("B. worker/external direct GitHub source write → DENY", async () => {
    assert(WORKER_DENIED_OPERATIONS.PUSH === "DENY", "PUSH");
    const worker = denyWorkerGithubWrite("CODING_WORKER has no GitHub write credential");
    assert(worker.reason_code === "WORKER_GITHUB_WRITE_DENIED", worker.reason_code);
    assert(Object.values(GITHUB_INTENTS).every((intent) => !intent.includes("write")), "adapter read-only");
    const contents = await putFileContents(
      "this-is-not-a-github-token",
      { owner: "t23598788-oss", repo: "-DNA-OS-INFRASTRUCTURE-", branch: "main" },
      "README.md",
      "worker-write",
      "worker commit",
    );
    assert(contents.kind === "failed" && contents.reason.includes("DNA_OS_PUBLISH_AUTHORITY_REQUIRED"), contents.kind === "failed" ? contents.reason : "written");
    live.proof_b = { worker: worker.reason_code, contents: "DNA_OS_PUBLISH_AUTHORITY_REQUIRED" };
  });

  await check("C. alternate repository → DENY", () => {
    const other = resolveGithubDestination({ repository_id: REPO_ID, checkout_root: proof.checkout.proof_root, requested: { owner: "some-other-org" } });
    assert(!other.ok && other.reason_code === "REMOTE_IDENTITY_MISMATCH", other.ok ? "ok" : other.reason_code);
    live.proof_c = { reason_code: other.ok ? "ok" : other.reason_code };
  });

  await check("D. alternate branch → DENY", () => {
    const other = resolveGithubDestination({ repository_id: REPO_ID, checkout_root: proof.checkout.proof_root, requested: { branch: "feature-unregistered" } });
    assert(!other.ok && other.reason_code === "BRANCH_POLICY_DENIED", other.ok ? "ok" : other.reason_code);
    live.proof_d = { reason_code: other.ok ? "ok" : other.reason_code };
  });

  await check("E. unrelated local change on authoritative checkout → DENY", async () => {
    const commandId = `cmd_eng_live_e_${randomUUID()}`;
    const completion = await completeEngineeringWork({
      command_id: commandId,
      intent_text: "zzqegate fixture marker",
      payload: payload(),
      checkout_root: proof.checkout.proof_root,
      selected_capability_id: "engineering-runtime",
      proposed_writes: writes(commandId),
    });
    try {
      assert(completion.status === "VERIFIED", `${completion.status} ${completion.reason_code}`);
      const publication = await publishEngineeringSource({ completion, checkout_root: CHECKOUT });
      live.proof_e = { status: publication.status, reason_code: publication.reason_code };
      assert(publication.status === "BLOCKED", publication.status);
      assert(
        publication.reason_code === "UNRELATED_CHANGE_PRESENT" || publication.reason_code === "BASE_REVISION_MISMATCH",
        publication.reason_code,
      );
    } finally {
      await cleanup(completion.lineage.reservation_id, completion.coding.admission.repository_root);
    }
  });

  await check("F. remote moved → REMOTE_HEAD_MOVED, no force push", async () => {
    let pushCalled = false;
    const result = await publishDnaOsCommit({
      destination: destOnProof.destination,
      commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expected_remote_sha: destOnProof.destination.local_default_branch_sha,
      deps: {
        resolveCredential: async () => ({ ok: true, token: "test-token-not-logged", credential_source: "test-seam" }),
        lookupRepo: async () => ({ kind: "found", http_status: 200, default_branch: "main", visibility: "private" }),
        lookupBranch: async () => ({ kind: "found", http_status: 200, head_commit_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", head_commit_at: null, branch_protected: false }),
        gitPush: () => {
          pushCalled = true;
          return { ok: false, detail: "must not run" };
        },
      },
    });
    live.proof_f = { reason_code: result.reason_code, pushCalled, force_push_attempted: result.force_push_attempted };
    assert(result.reason_code === "REMOTE_HEAD_MOVED", result.reason_code);
    assert(pushCalled === false, "push must not run");
    assert(result.force_push_attempted === false, "no force");
  });

  await check("G. missing credential → CREDENTIAL_UNAVAILABLE", async () => {
    let pushCalled = false;
    const result = await publishDnaOsCommit({
      destination: destOnProof.destination,
      commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expected_remote_sha: destOnProof.destination.local_default_branch_sha,
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
    assert(pushCalled === false, "push must not run");
  });

  await check("H. Business command never reaches publish authority", async () => {
    const env = envelope("ตรวจสถานะ firewall", payload());
    const result = await routeOwnerCommand(env, "ตรวจสถานะ firewall");
    live.proof_h = { command_id: env.command_id, capability_id: result.capability_id };
    assert(result.capability_id === "os-login", String(result.capability_id));
    assert(result.evidence.every((row) => !row.note.includes("github_publish_status=")), "no publish evidence");
  });

  if (auth.ok) {
    if (auth.remote.remote_head_sha !== destOnProof.destination.local_default_branch_sha) {
      live.live_remote_status = "BLOCKED";
      live.blocker = {
        reason_code: "REMOTE_HEAD_MOVED",
        detail: `local main ${destOnProof.destination.local_default_branch_sha} != remote main ${auth.remote.remote_head_sha}`,
      };
      await check("pre-publish SHA corroboration fails closed when local main != remote main", () => {
        assert(auth.remote.remote_head_sha !== destOnProof.destination.local_default_branch_sha, "mismatch already observed");
      });
    } else {
      await check("A. admitted Engineering result → DNA OS commit → live GitHub publish", async () => {
        const commandId = `cmd_eng_live_a_${randomUUID()}`;
        const seen: SystemEvent[] = [];
        const unsubscribe = onSystemEvent((event) => {
          if (event.correlation_id === commandId || event.command_id === commandId) seen.push(event);
        });
        try {
        const completion = await completeEngineeringWork({
          command_id: commandId,
          intent_text: "zzqegate fixture marker",
          payload: payload(),
          checkout_root: proof.checkout.proof_root,
          selected_capability_id: "engineering-runtime",
          proposed_writes: writes(commandId),
        });
        try {
          assert(completion.status === "VERIFIED", `${completion.status} ${completion.reason_code} ${completion.detail}`);
          const publication = await publishEngineeringSource({ completion, checkout_root: proof.checkout.proof_root });
          live.proof_a = {
            command_id: completion.lineage.command_id,
            work_id: completion.lineage.work_id,
            repository_id: completion.lineage.repository_id,
            reservation_id: completion.lineage.reservation_id,
            manifest_id: completion.lineage.manifest_id,
            admission: completion.lineage.admission_decision,
            integration: completion.lineage.integration_status,
            status: publication.status,
            reason_code: publication.reason_code,
            detail: publication.detail,
            dna_os_commit_sha: publication.lineage.dna_os_commit_sha ?? null,
            github_destination: `${publication.lineage.github_owner}/${publication.lineage.github_repository}`,
            pre_publish_remote_sha: publication.lineage.pre_publish_remote_sha ?? null,
            post_publish_remote_sha: publication.lineage.post_publish_remote_sha ?? null,
            sha_match: publication.publish?.published === true
              && publication.commit?.commit_sha === publication.publish.post_publish_remote_sha,
            force_push_attempted: publication.publish?.force_push_attempted ?? false,
          };
          live.live_remote_status = publication.status === "VERIFIED" ? "VERIFIED" : "BLOCKED";
          if (publication.status !== "VERIFIED") live.blocker = { reason_code: publication.reason_code, detail: publication.detail };
          assert(publication.status === "VERIFIED" || publication.status === "BLOCKED", publication.status);
          if (publication.status === "VERIFIED") {
            assert(publication.commit?.commit_sha === publication.publish?.post_publish_remote_sha, "SHA match required");
            assert(publication.publish?.pre_publish_remote_sha === auth.remote.remote_head_sha, "pre-publish SHA");
            assert(publication.publish?.force_push_attempted === false, "no force");
            assert(readFileSync(join(CHECKOUT, CODE), "utf8").includes("DNA_OS_LIVE_GITHUB_PUBLISH") === false, "authoritative checkout fixtures must remain untouched");
            const activity = projectOwnerActivity(completion.lineage.command_id);
            const group = activity.processing_groups.find((row) => row.processing_group_id === `pg-github-publish-${completion.lineage.command_id}`);
            live.owner_activity = {
              schema: activity.schema,
              command_id: activity.command_id,
              work_order_id: activity.work_order_id,
              group_status: group?.status ?? null,
              actor_icon_ref: group?.actor_icon_ref ?? null,
              human_readable: group?.human_readable ?? null,
              details_reference: group?.details_reference ?? null,
              sha_match: true,
            };
            assert(activity.command_id === completion.lineage.command_id, "correlation");
            assert(activity.work_order_id === completion.lineage.work_id, "work order lineage");
            assert(group?.status === "VERIFIED", `owner group ${group?.status}`);
            assert(group?.human_readable === "Commit accepted", group?.human_readable ?? "missing");
            assert(group?.actor_icon_ref === "icon:github", group?.actor_icon_ref ?? "missing icon");
            assert(group?.details_available === true, "details control");
            assert(JSON.stringify(group).includes("github_commit_accepted") === false, "internal action name must not appear on compact group");
            const systemEvents = eventsForCommand(completion.lineage.command_id);
            assert(systemEvents.some((event) => event.event_type === "SOURCE_PUBLISH_REQUESTED"), "publish SystemEvent");
            assert(systemEvents.some((event) => event.event_type === "GITHUB_REMOTE_OBSERVED"), "remote observed SystemEvent");
            assert(systemEvents.some((event) => event.event_type === "GITHUB_COMMIT_ACCEPTED" && event.sha_match === true && event.remote_sha === publication.commit?.commit_sha), "GITHUB_COMMIT_ACCEPTED from remote SHA");
            assert(listDisplayQueue(completion.lineage.command_id).some((item) => item.status === "VERIFIED" && item.human_readable === "Commit accepted"), "display queue GitHub card");
            assert(seen.some((event) => event.event_type === "GITHUB_COMMIT_ACCEPTED"), "realtime SystemEvent fan-out");
          }
        } finally {
          await cleanup(completion.lineage.reservation_id, completion.coding.admission.repository_root);
        }
        } finally {
          unsubscribe();
        }
      });
    }
  } else {
    live.live_remote_status = "BLOCKED";
    live.blocker = { reason_code: auth.reason_code, detail: auth.detail };
  }

  await check("EXTERNAL_AI_SOURCE_WRITE remains DENIED_BY_ARCHITECTURE", () => {
    assert(SOURCE_PUBLICATION_INVARIANTS.EXTERNAL_AI_SOURCE_WRITE === "DENIED_BY_ARCHITECTURE", "invariant");
    assert(SOURCE_PUBLICATION_INVARIANTS.AUTHORITATIVE_GITHUB_WRITE_PATH_COUNT === 1, "write path count");
  });

  removePublicationProofCheckout(proof.checkout);
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`LIVE_PROOF ${JSON.stringify(live)}`);
  if (failed > 0) process.exitCode = 1;
}

main();
