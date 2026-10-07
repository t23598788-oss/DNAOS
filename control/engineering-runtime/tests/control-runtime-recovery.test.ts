/**
 * Deterministic replacement-environment reconstruction of the DNA OS
 * control runtime from canonical git source (git clone, not JSONL copy).
 *
 * How to run:
 *   npx tsx control/engineering-runtime/tests/control-runtime-recovery.test.ts
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { reconstructControlRuntime, untrackedLifecycleWasNotCopied } from "../contract";
import { recreateWorkspaceFromRegisteredSource } from "../../source-workspace/contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
process.env.LOCAL_WORKSPACE_REGISTRY_LOG = join(process.cwd(), "control/source-workspace/data", `local-workspaces-recovery-${STAMP}.jsonl`);
process.env.SOURCE_WORKSPACE_RESERVATION_LOG = join(process.cwd(), "control/source-workspace/data", `reservations-recovery-${STAMP}.jsonl`);

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeCanonicalSource(): { root: string; work_id: string; sha: string } {
  const root = join("tests/__sandbox__", `control-runtime-src-${STAMP}`);
  mkdirSync(root, { recursive: true });
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "test"]);
  mkdirSync(join(root, "control/command-router"), { recursive: true });
  mkdirSync(join(root, "connections/dna-os-mcp"), { recursive: true });
  mkdirSync(join(root, "control/source-workspace"), { recursive: true });
  mkdirSync(join(root, "control/engineering-runtime/data"), { recursive: true });
  writeFileSync(join(root, "control/command-router/capability-registry.ts"), `export const CAPABILITY_REGISTRY = {
  "engineering-runtime": { capability_id: "engineering-runtime", health_status: "CONNECTED" },
  "os-login": { capability_id: "os-login", health_status: "CONNECTED" },
};\n`);
  writeFileSync(join(root, "connections/dna-os-mcp/tool-registry.ts"), `export const DNA_OS_MCP_TOOLS = [
  { metadata: { name: "dna_os.get_system_health" } },
  { metadata: { name: "dna_os.get_latest_work" } },
  { metadata: { name: "dna_os.get_work_status" } },
  { metadata: { name: "dna_os.get_work_evidence" } },
  { metadata: { name: "dna_os.get_capability_status" } },
  { metadata: { name: "dna_os.get_runtime_identity" } },
];\n`);
  mkdirSync(join(root, "connections/connection-registry/data"), { recursive: true });
  writeFileSync(join(root, "connections/connection-registry/data/connections.jsonl"), `${JSON.stringify({
    connection_id: "connection://github/SOURCE_AUTHORITY/test-owner/dna-os-recovery-fixture/main",
    account_id: "test-owner",
    software_id: "dna-os-infrastructure",
    adapter: "github",
    credential_ref: { kind: "keychain_ref", ref: "credential://github/test-owner/dna-os-recovery-fixture/source-authority" },
    status: "connected",
    connection_type: "SOURCE_AUTHORITY",
    target: { owner: "test-owner", repository: "dna-os-recovery-fixture", branch: "main" },
    executor_capability_id: null,
    scope: ["WRITE_SOURCE"],
  })}\n`);
  writeFileSync(join(root, "control/source-workspace/contract.ts"), "export {}\n");
  writeFileSync(join(root, "required.txt"), "canonical-v1\n");
  writeFileSync(join(root, ".env"), "GITHUB_TOKEN=ghp_this_must_not_be_cloned_if_untracked\n");
  writeFileSync(join(root, "control/engineering-runtime/data/lifecycle.jsonl"), "{\"work_id\":\"work-opaque-local-should-not-clone\"}\n");
  git(root, ["add", "control", "connections", "required.txt"]);
  const work_id = `work-aaaaaaaa-bbbb-cccc-dddd-${STAMP.toString(16).padStart(12, "0").slice(-12)}`;
  git(root, [
    "commit",
    "-m",
    `DNA OS Engineering source commit\n\ncommand_id: cmd_recovery_fixture\nwork_id: ${work_id}\nmanifest_id: erm-recovery\nadmission: ALLOW\nintegration: INTEGRATED\n`,
  ]);
  git(root, ["remote", "add", "origin", "https://github.com/test-owner/dna-os-recovery-fixture.git"]);
  const sha = git(root, ["rev-parse", "HEAD"]);
  return { root, work_id, sha };
}

async function main(): Promise<void> {
  const source = makeCanonicalSource();
  const dest = join("tests/__sandbox__", `control-runtime-dest-${STAMP}`);

  await check("reconstructControlRuntime uses git clone, not opaque local JSONL copy", async () => {
    const row = await reconstructControlRuntime({
      canonical_source: source.root,
      destination_root: dest,
      branch: "main",
    });
    assert(row.ok, row.detail);
    assert(row.copied_opaque_local_state === false, "must not copy opaque local state");
    assert(row.credential_secret_exposed === false, "must not expose secrets");
    assert(row.full_machine_independence === false, "credentials remain rebindable");
    assert(row.credential_rebind_required === true, "Keychain/Device Flow must be re-bound");
    assert(row.runtime_identity.previous_machine_identity_copied === false, "must not copy installation identity");
    assert(row.runtime_identity.installation_state === "UNINITIALIZED_ON_REPLACEMENT_ENVIRONMENT", row.runtime_identity.installation_state);
    assert(untrackedLifecycleWasNotCopied(source.root, dest), "untracked lifecycle.jsonl must not appear in reconstruction");
    assert(!existsSync(join(dest, ".env")), "untracked .env must not be cloned");
    assert(row.capability_ids.includes("engineering-runtime"), "capability registry recovered from source");
    assert(row.capability_ids.includes("os-login"), "os-login recovered from source");
    assert(row.mcp_self_reporting_present, "MCP self-reporting source must be present");
    assert(row.credential_bind_state === "REBIND_REQUIRED", `expected REBIND_REQUIRED, got ${row.credential_bind_state}`);
    assert(row.recovered_work_refs.some((item) => item.work_id === source.work_id && item.commit_sha === source.sha.toLowerCase()), "work history recovered from commit message");
    assert(row.recovered_work_refs.every((item) => item.source === "CANONICAL_GIT_COMMIT_MESSAGE"), "work refs must come from git commits");
    assert(row.repository_id === "repository://test-owner/dna-os-recovery-fixture" || (row.repository_id ?? "").includes("test-owner"), `repository_id=${row.repository_id}`);
    assert(!JSON.stringify(row).includes("ghp_"), "report must not include token material");
  });

  await check("execution workspace can be recreated from registered reconstructed source SHA", async () => {
    const recovered = await recreateWorkspaceFromRegisteredSource({
      work_id: source.work_id,
      repository_id: "repository://test-owner/dna-os-recovery-fixture",
      repository_root: dest,
      commit_sha: source.sha,
      base_branch: "main",
    });
    assert(recovered.ok, recovered.ok ? "" : recovered.detail);
    if (recovered.ok) {
      assert(readFileSync(join(recovered.worktree_path, "required.txt"), "utf8") === "canonical-v1\n", "required source restored from reconstructed git object");
    }
  });

  await check("G. reconstructed credential state starts REBIND_REQUIRED and does not copy .env/Keychain secrets", async () => {
    const row = await reconstructControlRuntime({
      canonical_source: source.root,
      destination_root: join("tests/__sandbox__", `control-runtime-dest-unbound-${STAMP}`),
      branch: "main",
    });
    assert(row.credential_bind_state === "REBIND_REQUIRED" || row.credential_bind_state === "UNBOUND", row.credential_bind_state);
    assert(row.copied_opaque_local_state === false, "opaque local state must not be copied");
    assert(!existsSync(join(row.destination_root, ".env")), "must not copy .env");
    assert(!JSON.stringify(row).includes("ghp_"), "reconstruction report must not include token material");
    rmSync(row.destination_root, { recursive: true, force: true });
  });

  rmSync(source.root, { recursive: true, force: true });
  rmSync(dest, { recursive: true, force: true });
  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
