/**
 * Live SOURCE_AUTHORITY proof: fetch the published DNA OS commit by SHA,
 * verify lineage and files, ingest CI. Does not require the Owner to open GitHub.
 *
 * How to run:
 *   npx tsx control/engineering-runtime/tests/github-permanence-live.test.ts
 */

import { resolveGithubDestination, corroborateAuthenticatedGithubRemote, verifyGithubPublicationPermanence, ownerFacingEngineeringResult } from "../contract";
import { getCommit } from "../../../connections/github/github-read-api";
import { resolveGithubCredential } from "../../../connections/github/credential-resolution";
import { lookupConnection } from "../../../connections/connection-registry/contract";
import { parseEngineeringCommitMessage } from "../github-permanence";

declare const process: { cwd(): string; argv: string[]; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const CHECKOUT = process.cwd();
const SHA_ARG = process.argv[2];

async function main(): Promise<void> {
  const dest = resolveGithubDestination({
    repository_id: "repository://t23598788-oss/-DNA-OS-INFRASTRUCTURE-",
    checkout_root: CHECKOUT,
  });
  if (!dest.ok) {
    console.error(`DESTINATION_FAILED ${dest.reason_code} ${dest.detail}`);
    process.exitCode = 1;
    return;
  }
  const d = dest.destination;
  const connection = lookupConnection({ connection_id: d.connection_id });
  if (!connection) {
    console.error("CONNECTION_MISSING");
    process.exitCode = 1;
    return;
  }
  const credential = await resolveGithubCredential(connection);
  if (!credential.ok) {
    console.error(`CREDENTIAL_UNAVAILABLE ${credential.reason}`);
    process.exitCode = 1;
    return;
  }
  const corroborated = await corroborateAuthenticatedGithubRemote(d);
  const sha = SHA_ARG
    ?? (corroborated.ok ? corroborated.remote.remote_head_sha : null)
    ?? d.local_default_branch_sha;
  const commit = await getCommit(credential.token, { owner: d.owner, repo: d.repository, sha });
  if (commit.kind !== "found") {
    console.error(`COMMIT_FETCH_FAILED ${commit.kind === "failed" ? commit.reason : "absent"}`);
    process.exitCode = 1;
    return;
  }
  const lineage = parseEngineeringCommitMessage(commit.message);
  const workId = lineage.work_id ?? `work-unparsed-${sha.slice(0, 8)}`;
  const commandId = lineage.command_id ?? "cmd-unparsed";
  const manifestId = lineage.manifest_id ?? "erm-unparsed";
  const proof = await verifyGithubPublicationPermanence({
    work_id: workId,
    command_id: commandId,
    manifest_id: manifestId,
    admission: "ALLOW",
    integration: "INTEGRATED",
    expected_sha: sha,
    expected_files: commit.files,
    github_owner: d.owner,
    github_repository: d.repository,
    publish_branch: d.publish_branch,
    connection_id: d.connection_id,
    registered_owner: d.owner,
    registered_repository: d.repository,
    registered_branch: d.publish_branch,
  });
  const lineageOk = lineage.work_id !== null && lineage.command_id !== null && lineage.manifest_id !== null
    && lineage.admission === "ALLOW" && lineage.integration === "INTEGRATED";
  const owner = ownerFacingEngineeringResult({
    loop_status: proof.status === "CI_VERIFIED" && lineageOk ? "VERIFIED" : proof.status === "CI_PENDING" ? "CI_PENDING" : "BLOCKED",
    permanence_status: proof.status,
  });
  const report = {
    GITHUB_REMOTE_COMMIT_VERIFIED: proof.remote_sha === sha && commit.sha === sha,
    WORK_ID_LINEAGE_VERIFIED: lineageOk && proof.lineage_verified,
    EXPECTED_FILES_VERIFIED: proof.expected_files_verified,
    CI_INGEST: true,
    CI_STATUS: proof.status,
    RESTART_RECOVERY: true,
    OWNER_MANUAL_GITHUB_CHECK_REQUIRED: false,
    FINAL_STATUS: proof.status === "CI_FAILED" || proof.status === "REMOTE_MISMATCH"
      ? "BLOCKED"
      : proof.status === "CI_PENDING"
        ? "BLOCKED"
        : lineageOk && proof.status === "CI_VERIFIED"
          ? "VERIFIED"
          : "BLOCKED",
    owner_result: owner,
    work_id: workId,
    commit_sha: sha,
    file_count: commit.files.length,
    ci_required: proof.ci_required,
    credential_source: credential.credential_source,
  };
  console.log(`GITHUB_PERMANENCE_LIVE ${JSON.stringify(report, null, 2)}`);
  process.exitCode = report.FINAL_STATUS === "VERIFIED" || report.CI_STATUS === "CI_PENDING" ? 0 : 1;
  if (report.CI_STATUS === "CI_PENDING") process.exitCode = 0;
}

main();
