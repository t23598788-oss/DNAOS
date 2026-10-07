/**
 * หน้าที่: the real test for `connections/github/`. It constructs
 * `CommandEnvelope`s by hand — `../../control/command-router/` is
 * NOT_YET_BUILT, so there is no caller to drive this adapter yet — and
 * calls the capability's exported functions directly, asserting real
 * behaviour.
 *
 * Two suites:
 * 1. OFFLINE — pure logic and every rejection path. No network, no
 *    credential needed. These prove that a command which is not allowed
 *    never reaches GitHub at all.
 * 2. LIVE — real HTTPS calls to the real GitHub API with the real
 *    credential, against a real repository. Nothing here asserts a result
 *    that was not actually observed.
 *
 * The LIVE suite runs only when the credential env var is present in the
 * process. When it is absent, the run ends with exit code 2 and prints
 * "LIVE SUITE SKIPPED — NOT VERIFIED" — a skipped live suite must never be
 * mistakable for a pass.
 *
 * How to run (no test framework and no package.json exist in this repo
 * yet; this file is a plain program with its own assertions):
 *   GITHUB_PAT_INFRASTRUCTURE=... npx tsx connections/github/adapter.test.ts
 *
 * Input: env vars — the credential MUST be in
 * EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME ("GITHUB_PAT_INFRASTRUCTURE") —
 * this is no longer overridable from the test (Owner, 2026-08-14: single
 * credential channel, enforced in ./credential-resolution.ts, not just in
 * this test) — plus optional GITHUB_ADAPTER_TEST_OWNER / _REPO / _BRANCH
 * to point the live suite at a different repository.
 * Output: PASS/FAIL lines, explicit `credential_source` evidence printed
 * and asserted, live proof of which `X-GitHub-Api-Version` GitHub actually
 * applied (2026-08-14 — see ../CHANGE_PLAN_API_VERSION.md), and a non-zero
 * exit code on any failure.
 * Dependency ที่อนุญาต: every module inside this capability folder, plus
 * `../../contracts/` types.
 * สิ่งที่ห้ามแตะ: **ห้าม print ค่า token** — มี assertion จริงในไฟล์นี้ที่
 * ตรวจว่า serialized event ไม่มี substring ของ token อยู่. ห้าม hardcode
 * ค่า token ลงในไฟล์นี้. ห้ามให้ test เขียนอะไรกลับไปที่ GitHub หรือลง
 * ดิสก์ — ทุก call ในนี้เป็น GET. ห้ามให้ test เปิดช่องให้ resolve
 * credential จาก env var อื่นนอกเหนือจาก
 * EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME ได้อีก
 */

import type { CommandEnvelope } from "../../contracts/command/command-envelope";
import type { ConnectionRegistration } from "../../contracts/connector/connection";
import type { EnvelopeIdentity } from "../../contracts/identity/envelope-identity";
import { EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME, GITHUB_API_BASE_URL, GITHUB_API_VERSION, GITHUB_REQUEST_TIMEOUT_MILLISECONDS } from "./adapter-config";
import { GITHUB_EVENT_TYPES, GITHUB_INTENTS, type GithubAccessCheckResult, type GithubRepoStatusResult } from "./adapter-contract";
import { resolveGithubCredential } from "./credential-resolution";
import { handleGithubCommand } from "./github-adapter";
import { githubHeaders } from "./github-read-api";
import { hostError, hostFetch, hostLog, setHostExitCode } from "./host-runtime";
import { checkRepoPath, encodeRepoPath } from "./repo-path";

declare const process: { env: Record<string, string | undefined> };

/** No longer overridable — the adapter itself refuses any other channel (Owner, 2026-08-14). Testing that rejection is its own offline check below, not a configuration knob. */
const TOKEN_ENV_VAR = EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME;
const EXPECTED_CREDENTIAL_SOURCE = `env:${TOKEN_ENV_VAR}`;
const TEST_OWNER = process.env["GITHUB_ADAPTER_TEST_OWNER"] ?? "t23598788-oss";
const TEST_REPO = process.env["GITHUB_ADAPTER_TEST_REPO"] ?? "-DNA-OS-INFRASTRUCTURE-";
/** Optional. When unset, the live suite uses whatever the repository itself reports as its default branch. */
const TEST_BRANCH_OVERRIDE = process.env["GITHUB_ADAPTER_TEST_BRANCH"] ?? null;

const TEST_ACCOUNT_ID = "account_test_github_adapter";

const testIdentity: EnvelopeIdentity = {
  identity_id: "identity_test_github_adapter",
  acting_as_account_id: TEST_ACCOUNT_ID,
  acting_as_tenant_id: "tenant_test_github_adapter",
  software_id: "software_dna_os_infrastructure",
  kind: "service",
};

function connectionFixture(overrides: Partial<ConnectionRegistration> = {}): ConnectionRegistration {
  return {
    connection_id: "connection_test_github",
    account_id: TEST_ACCOUNT_ID,
    software_id: "software_dna_os_infrastructure",
    adapter: "github",
    credential_ref: { kind: "env_var", name: TOKEN_ENV_VAR },
    status: "connecting",
    ...overrides,
  };
}

function command(intent: string, payload: unknown, identity: EnvelopeIdentity = testIdentity): CommandEnvelope {
  return {
    command_id: `command_test_${intent}_${String(commandCounter++)}`,
    issued_by: identity,
    intent,
    payload,
    issued_at: new Date().toISOString(),
  };
}

let commandCounter = 0;
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed += 1;
    hostLog(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    hostError(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runOfflineSuite(): Promise<void> {
  hostLog("\n--- OFFLINE SUITE (no network, no credential) ---");

  await check("checkRepoPath accepts a normal repo-relative path", () => {
    const result = checkRepoPath("connections/github/adapter-config.ts");
    assert(result.ok && result.normalized === "connections/github/adapter-config.ts", "expected the path to be accepted unchanged");
  });

  await check("checkRepoPath rejects traversal, absolute, doubled-slash, .git and backslash paths", () => {
    for (const bad of ["../secrets", "connections/../../etc", "/etc/passwd", "a//b", ".git/config", "a\\b", ""]) {
      const result = checkRepoPath(bad);
      assert(!result.ok, `expected "${bad}" to be rejected, but it was accepted`);
    }
  });

  await check('checkRepoPath accepts "" only when allowRoot is set', () => {
    assert(!checkRepoPath("").ok, "empty path must be rejected by default");
    const asRoot = checkRepoPath("", { allowRoot: true });
    assert(asRoot.ok && asRoot.normalized === "", "empty path must be accepted as the repository root when allowRoot is set");
  });

  await check("encodeRepoPath encodes each segment but keeps the / separators", () => {
    assert(encodeRepoPath("docs/a b.md") === "docs/a%20b.md", `expected "docs/a%20b.md", received "${encodeRepoPath("docs/a b.md")}"`);
    assert(!encodeRepoPath("a/b/c.ts").includes("%2F"), "path separators must never be percent-encoded");
  });

  await check("resolveGithubCredential refuses a connection with no real credential reference", async () => {
    const result = await resolveGithubCredential(connectionFixture({ credential_ref: { kind: "not_yet_built" } }));
    assert(!result.ok, "expected refusal for credential_ref.kind = not_yet_built");
  });

  await check("resolveGithubCredential refuses an unset env var and names it without revealing any value", async () => {
    const missingName = "DNA_OS_GITHUB_ADAPTER_DEFINITELY_UNSET_ENV_VAR";
    const result = await resolveGithubCredential(connectionFixture({ credential_ref: { kind: "env_var", name: missingName } }));
    assert(!result.ok, "expected refusal when the env var is not set");
    assert(!result.ok && result.reason.includes(missingName), "the reason must name the env var it looked for");
  });

  await check("resolveGithubCredential refuses an env var that is set but empty", async () => {
    const emptyName = "DNA_OS_GITHUB_ADAPTER_EMPTY_ENV_VAR";
    process.env[emptyName] = "   ";
    const result = await resolveGithubCredential(connectionFixture({ credential_ref: { kind: "env_var", name: emptyName } }));
    process.env[emptyName] = undefined;
    assert(!result.ok, "expected refusal when the env var is set to whitespace only");
  });

  await check("an unknown intent is rejected at the classify stage", async () => {
    const outcome = await handleGithubCommand(command("connector.github.deploy_everything", {}));
    assert(!outcome.ok, "expected a rejection");
    assert(!outcome.ok && outcome.rejection.denied_at_stage === "classify", "expected denied_at_stage = classify");
  });

  await check("a malformed payload is rejected at the classify stage", async () => {
    const outcome = await handleGithubCommand(command(GITHUB_INTENTS.checkAccess, { connection: connectionFixture(), target: { owner: "", repo: "" } }));
    assert(!outcome.ok, "expected a rejection");
    assert(!outcome.ok && outcome.rejection.denied_at_stage === "classify", "expected denied_at_stage = classify");
  });

  await check("a connection for another adapter is rejected at the route stage", async () => {
    const outcome = await handleGithubCommand(
      command(GITHUB_INTENTS.checkAccess, { connection: connectionFixture({ adapter: "vercel" }), target: { owner: TEST_OWNER, repo: TEST_REPO } })
    );
    assert(!outcome.ok, "expected a rejection");
    assert(!outcome.ok && outcome.rejection.denied_at_stage === "route", "expected denied_at_stage = route");
  });

  await check("a connection belonging to another account is rejected at the authorize stage", async () => {
    const outcome = await handleGithubCommand(
      command(GITHUB_INTENTS.checkAccess, {
        connection: connectionFixture({ account_id: "account_someone_else" }),
        target: { owner: TEST_OWNER, repo: TEST_REPO },
      })
    );
    assert(!outcome.ok, "expected a rejection");
    assert(!outcome.ok && outcome.rejection.denied_at_stage === "authorize", "expected denied_at_stage = authorize");
  });

  await check("a command with no resolvable credential is rejected at the authenticate stage, before any network call", async () => {
    const outcome = await handleGithubCommand(
      command(GITHUB_INTENTS.checkAccess, {
        connection: connectionFixture({ credential_ref: { kind: "env_var", name: "DNA_OS_GITHUB_ADAPTER_DEFINITELY_UNSET_ENV_VAR" } }),
        target: { owner: TEST_OWNER, repo: TEST_REPO },
      })
    );
    assert(!outcome.ok, "expected a rejection");
    assert(!outcome.ok && outcome.rejection.denied_at_stage === "authenticate", "expected denied_at_stage = authenticate");
  });

  await check("a read_status command with no branch is rejected — no default branch is ever assumed", async () => {
    const outcome = await handleGithubCommand(
      command(GITHUB_INTENTS.readStatus, { connection: connectionFixture(), target: { owner: TEST_OWNER, repo: TEST_REPO } })
    );
    assert(!outcome.ok, "expected a rejection");
    assert(!outcome.ok && outcome.rejection.reason.includes("branch"), "the reason must say the branch is missing");
  });

  await check("a traversal path inside payload.paths is rejected at the classify stage", async () => {
    const outcome = await handleGithubCommand(
      command(GITHUB_INTENTS.readStatus, {
        connection: connectionFixture(),
        target: { owner: TEST_OWNER, repo: TEST_REPO, branch: "main" },
        paths: ["README.md", "../../etc/passwd"],
      })
    );
    assert(!outcome.ok, "expected a rejection");
    assert(!outcome.ok && outcome.rejection.denied_at_stage === "classify", "expected denied_at_stage = classify");
  });

  await check("a connection naming any env var other than the single enforced credential channel is refused, before any network call", async () => {
    const wrongChannelConnection = connectionFixture({ credential_ref: { kind: "env_var", name: "SOME_OTHER_TOKEN_NAME" } });
    const resolution = await resolveGithubCredential(wrongChannelConnection);
    assert(!resolution.ok, "expected resolution to fail for a non-enforced env var name");
    if (resolution.ok) return;
    assert(resolution.reason.includes(EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME), "the refusal reason must name the one accepted channel");
    assert(resolution.reason.includes("SOME_OTHER_TOKEN_NAME"), "the refusal reason must name the offending channel that was rejected");

    // Same refusal must hold through the real entry point, not just the credential function directly.
    const outcome = await handleGithubCommand(
      command(GITHUB_INTENTS.checkAccess, { connection: wrongChannelConnection, target: { owner: TEST_OWNER, repo: TEST_REPO } })
    );
    assert(!outcome.ok, "expected a rejection via handleGithubCommand too");
    assert(!outcome.ok && outcome.rejection.denied_at_stage === "authenticate", "expected denied_at_stage = authenticate");
  });
}

/**
 * The live suite is target-agnostic on purpose: it discovers the branch
 * from the repository's own `default_branch` and discovers real paths from
 * the repository's own root listing, instead of assuming one repo's
 * layout. That is what lets the same suite verify this adapter against
 * whatever repository the credential in use can actually reach.
 */
async function runLiveSuite(token: string): Promise<"verified" | "blocked"> {
  hostLog(`\n--- LIVE SUITE (real GitHub API, real credential from ${TOKEN_ENV_VAR}) ---`);
  hostLog(`      credential source = ${EXPECTED_CREDENTIAL_SOURCE}  (the only channel this capability accepts — see ./adapter-config.ts)`);
  hostLog(`      target: ${TEST_OWNER}/${TEST_REPO}`);

  // Deliberately independent of TEST_REPO's own reachability (2026-08-14,
  // API-version change-plan prep — see ../CHANGE_PLAN_API_VERSION.md): a
  // fine-grained PAT always has read access to public repositories
  // regardless of its Repository access selection (GitHub's own documented
  // behavior), so this proves the version header mechanism end-to-end even
  // while TEST_REPO itself remains blocked on repository selection.
  await check("the configured GITHUB_API_VERSION is the version GitHub actually confirms it used (checked against a repository always reachable to any valid token)", async () => {
    const outcome = await hostFetch(`${GITHUB_API_BASE_URL}/repos/t23598788-oss/camo`, githubHeaders(token), GITHUB_REQUEST_TIMEOUT_MILLISECONDS);
    assert(outcome.kind === "response", "expected a real HTTP response (not a transport error) for this header check");
    if (outcome.kind !== "response") return;
    const selected = outcome.response.headers.get("x-github-api-version-selected");
    assert(selected !== null, "GitHub did not return x-github-api-version-selected at all — cannot verify which version it used");
    assert(
      selected === GITHUB_API_VERSION,
      `GITHUB_API_VERSION is configured as "${GITHUB_API_VERSION}" but GitHub confirms it actually used "${String(selected)}" — the header is not reaching GitHub as configured`
    );
    hostLog(`      EVIDENCE: GitHub confirms x-github-api-version-selected=${String(selected)} (matches configured GITHUB_API_VERSION="${GITHUB_API_VERSION}")`);
  });

  await check("check_access on a repository this credential cannot see reports 404 as the ambiguity it is", async () => {
    const outcome = await handleGithubCommand(
      command(GITHUB_INTENTS.checkAccess, {
        connection: connectionFixture(),
        target: { owner: TEST_OWNER, repo: "dna-os-adapter-nonexistent-repo-check" },
      })
    );
    assert(outcome.ok, "expected an event (a reachability failure is still a real, reportable result)");
    if (!outcome.ok) return;
    const data = outcome.event.data as GithubAccessCheckResult;
    assert(!data.reachable, "expected reachable = false");
    assert(data.http_status === 404, `expected HTTP 404, received ${String(data.http_status)}`);
    assert(typeof data.reason === "string" && data.reason.includes("does not exist, OR"), "the reason must state that 404 is ambiguous, not claim the repo is absent");
  });

  // Gate, not an assertion: whether this credential has been GRANTED access
  // to the configured repository is a fact about the environment, not about
  // this adapter. If it has not, the run is reported as BLOCKED (nothing
  // verified) rather than as an adapter failure — the adapter reporting
  // "unreachable" correctly is not a defect.
  const probeCommand = command(GITHUB_INTENTS.checkAccess, { connection: connectionFixture(), target: { owner: TEST_OWNER, repo: TEST_REPO } });
  const probe = await handleGithubCommand(probeCommand);
  if (!probe.ok) {
    hostError(`\nLIVE SUITE BLOCKED — the adapter rejected the access-check command: ${probe.rejection.reason}`);
    return "blocked";
  }
  const probeData = probe.event.data as GithubAccessCheckResult;
  if (!probeData.reachable) {
    hostError(`\nLIVE SUITE BLOCKED — the credential in ${TOKEN_ENV_VAR} cannot reach ${TEST_OWNER}/${TEST_REPO}.`);
    hostError(`      adapter reported: HTTP ${String(probeData.http_status)} — ${String(probeData.reason)}`);
    hostError("This is an access-grant fact about the credential, not an adapter failure.");
    hostError("Re-run against a repository this credential can reach:  GITHUB_ADAPTER_TEST_REPO=<repo> npx tsx connections/github/adapter.test.ts");
    return "blocked";
  }

  await check("check_access reaches the configured repository and reports its default branch", () => {
    assert(probe.event.event_type === GITHUB_EVENT_TYPES.accessChecked, "wrong event_type");
    assert(probe.event.caused_by_command_id === probeCommand.command_id, "the event must link back to the command that caused it");
    assert(probe.event.concerns.acting_as_account_id === TEST_ACCOUNT_ID, "the event must concern the issuing account's scope");
    assert(probeData.credential_source === EXPECTED_CREDENTIAL_SOURCE, `the event must record credential_source exactly as "${EXPECTED_CREDENTIAL_SOURCE}", received "${probeData.credential_source}"`);
    assert(probeData.http_status === 200, `expected HTTP 200, received ${String(probeData.http_status)}`);
    assert(typeof probeData.default_branch === "string" && probeData.default_branch.length > 0, "expected a default_branch");
    assert(probeData.reason === null, `expected no failure reason on a reachable repo, received ${String(probeData.reason)}`);
    hostLog(`      observed: default_branch=${String(probeData.default_branch)} visibility=${String(probeData.visibility)}`);
    hostLog(`      EVIDENCE: credential_source=${probeData.credential_source} (matches the single enforced channel)`);
  });

  const branch = TEST_BRANCH_OVERRIDE ?? probeData.default_branch;
  if (branch === null) {
    hostError("\nLIVE SUITE BLOCKED — the repository is reachable but reported no default branch, and no GITHUB_ADAPTER_TEST_BRANCH was given.");
    return "blocked";
  }
  hostLog(`      branch under test: ${branch}`);

  let discoveredFilePath: string | null = null;
  let discoveredDirectoryPath: string | null = null;

  await check("read_status reports the branch head commit and lists the repository root", async () => {
    const outcome = await handleGithubCommand(
      command(GITHUB_INTENTS.readStatus, {
        connection: connectionFixture(),
        target: { owner: TEST_OWNER, repo: TEST_REPO, branch },
        paths: [""],
      })
    );
    assert(outcome.ok, `expected an event, received a rejection: ${outcome.ok ? "" : outcome.rejection.reason}`);
    if (!outcome.ok) return;
    assert(outcome.event.event_type === GITHUB_EVENT_TYPES.statusRead, "wrong event_type");
    const data = outcome.event.data as GithubRepoStatusResult;
    assert(data.reachable, `expected reachable = true, reason: ${String(data.reason)}`);
    assert(data.branch_found, `expected branch_found = true for "${branch}", reason: ${String(data.reason)}`);
    assert(
      typeof data.head_commit_sha === "string" && /^[0-9a-f]{40}$/.test(data.head_commit_sha),
      `expected a 40-hex head commit sha, received ${String(data.head_commit_sha)}`
    );
    assert(data.paths.length === 1, `expected 1 path status, received ${data.paths.length}`);

    const root = data.paths[0];
    assert(root !== undefined && root.kind === "directory", `expected the repository root to be a directory, received ${String(root?.kind)}`);
    if (root === undefined || root.kind !== "directory") return;
    assert(root.entry_count > 0, "expected the repository root to contain at least one entry");

    discoveredFilePath = root.entries.find((entry) => entry.entry_type === "file")?.path ?? null;
    discoveredDirectoryPath = root.entries.find((entry) => entry.entry_type === "dir")?.path ?? null;

    hostLog(`      observed: head_commit_sha=${String(data.head_commit_sha)} at ${String(data.head_commit_at)} protected=${String(data.branch_protected)}`);
    hostLog(`      observed: root has ${root.entry_count} entries; discovered file="${String(discoveredFilePath)}" dir="${String(discoveredDirectoryPath)}"`);
  });

  await check("read_status classifies a real file, a real directory, and a missing path correctly", async () => {
    const requested: string[] = ["no/such/path/here.md"];
    if (discoveredFilePath !== null) requested.unshift(discoveredFilePath);
    if (discoveredDirectoryPath !== null) requested.unshift(discoveredDirectoryPath);
    assert(discoveredFilePath !== null, "no file was discovered in the repository root, so file status could not be exercised");

    const outcome = await handleGithubCommand(
      command(GITHUB_INTENTS.readStatus, {
        connection: connectionFixture(),
        target: { owner: TEST_OWNER, repo: TEST_REPO, branch },
        paths: requested,
      })
    );
    assert(outcome.ok, `expected an event, received a rejection: ${outcome.ok ? "" : outcome.rejection.reason}`);
    if (!outcome.ok) return;
    const data = outcome.event.data as GithubRepoStatusResult;
    const byPath = new Map(data.paths.map((status) => [status.path, status]));

    if (discoveredFilePath !== null) {
      const fileStatus = byPath.get(discoveredFilePath);
      assert(fileStatus !== undefined && fileStatus.kind === "file", `expected "${discoveredFilePath}" to be a file, received ${String(fileStatus?.kind)}`);
      if (fileStatus !== undefined && fileStatus.kind === "file") {
        assert(/^[0-9a-f]{40}$/.test(fileStatus.blob_sha), `expected a 40-hex blob sha, received "${fileStatus.blob_sha}"`);
        assert(fileStatus.size_bytes > 0, "expected a non-zero file size");
      }
    }
    if (discoveredDirectoryPath !== null) {
      const dirStatus = byPath.get(discoveredDirectoryPath);
      assert(dirStatus !== undefined && dirStatus.kind === "directory", `expected "${discoveredDirectoryPath}" to be a directory, received ${String(dirStatus?.kind)}`);
    } else {
      hostLog("      note: repository root has no subdirectory — directory status was exercised on the root only");
    }

    const missing = byPath.get("no/such/path/here.md");
    assert(missing !== undefined && missing.kind === "absent", `expected a missing path to be reported absent, received ${String(missing?.kind)}`);

    for (const status of data.paths) {
      const label =
        status.kind === "file"
          ? `file ${status.size_bytes}B sha=${status.blob_sha.slice(0, 8)}`
          : status.kind === "directory"
            ? `directory ${status.entry_count} entries`
            : status.kind;
      hostLog(`      observed: "${status.path}" -> ${label}`);
    }
  });

  await check("read_status on a branch that does not exist reports branch_found = false, not an invented default", async () => {
    const outcome = await handleGithubCommand(
      command(GITHUB_INTENTS.readStatus, {
        connection: connectionFixture(),
        target: { owner: TEST_OWNER, repo: TEST_REPO, branch: "dna-os-adapter-nonexistent-branch" },
      })
    );
    assert(outcome.ok, "expected an event");
    if (!outcome.ok) return;
    const data = outcome.event.data as GithubRepoStatusResult;
    assert(data.reachable, "the repository itself is still reachable");
    assert(!data.branch_found, "expected branch_found = false");
    assert(typeof data.reason === "string" && data.reason.includes("dna-os-adapter-nonexistent-branch"), "the reason must name the branch that was not found");
  });

  await check("no emitted event contains the credential value anywhere in it", async () => {
    const outcome = await handleGithubCommand(
      command(GITHUB_INTENTS.readStatus, {
        connection: connectionFixture(),
        target: { owner: TEST_OWNER, repo: TEST_REPO, branch },
        paths: [],
      })
    );
    assert(outcome.ok, "expected an event");
    if (!outcome.ok) return;
    const serialized = JSON.stringify(outcome.event);
    assert(!serialized.includes(token), "the emitted event contained the credential value — this is a leak");
    assert(serialized.includes(EXPECTED_CREDENTIAL_SOURCE), `the event should record credential_source="${EXPECTED_CREDENTIAL_SOURCE}" (safe) even though it never carries the value`);
  });

  return "verified";
}

async function main(): Promise<void> {
  hostLog("connections/github/ — capability test");

  await runOfflineSuite();

  const credential = await resolveGithubCredential(connectionFixture());
  if (!credential.ok) {
    hostLog(`\nOFFLINE: ${passed} passed, ${failed} failed`);
    hostError(`\nLIVE SUITE SKIPPED — NOT VERIFIED: ${credential.reason}`);
    hostError(`Set ${TOKEN_ENV_VAR} in the environment and re-run to verify this capability against the real GitHub API.`);
    hostError(`(This LIVE suite's fixture connection uses the TEST/LEGACY env-var channel only — the canonical production channel is a real Keychain-backed connection registered through connections/connection-registry/, see ./credential-resolution.ts.)`);
    setHostExitCode(failed > 0 ? 1 : 2);
    return;
  }
  assert(credential.credential_source === EXPECTED_CREDENTIAL_SOURCE, `resolved credential_source must be exactly "${EXPECTED_CREDENTIAL_SOURCE}"`);
  hostLog(`\nEVIDENCE: credential source = ${credential.credential_source}`);

  const liveOutcome = await runLiveSuite(credential.token);

  hostLog(`\nTOTAL: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    setHostExitCode(1);
    return;
  }
  if (liveOutcome === "blocked") {
    // Exit 3 is neither "pass" nor "adapter failure": every check that ran
    // passed, but the configured repository could not be reached, so the
    // status-read behaviour was NOT verified in this run.
    hostError("VERDICT: adapter checks passed, but repository status reads were NOT VERIFIED against the configured target (see LIVE SUITE BLOCKED above).");
    setHostExitCode(3);
  }
}

void main();
