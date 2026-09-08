/**
 * Replacement-environment reconstruction of the DNA OS control runtime
 * from registered canonical git source. Proof mechanism is git clone /
 * checkout of committed source, never a copy of machine-local JSONL,
 * Keychain, or .env.
 *
 * Input: canonical git source + empty destination root.
 * Output: reconstruction report with explicit state classes.
 * Dependency ที่อนุญาต: node:child_process, node:fs, node:path, node:crypto,
 * ./github-permanence.ts, software/repository-registry, connection-registry.
 * สิ่งที่ห้ามแตะ: never copy machine-local evidence stores as authority.
 * never read or write Keychain. never print tokens.
 */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createConnectionRegistryStore, discoverGitRemote } from "../../connections/connection-registry/contract";
import { inspectGithubCredentialBind, type CredentialBindState } from "../../connections/github/credential-rebind";
import { buildRepositoryId, createRepositoryRegistryStore } from "../../software/repository-registry/contract";
import { parseEngineeringCommitMessage } from "./github-permanence";

export const MCP_SELF_REPORTING_TOOL_NAMES = [
  "dna_os.get_system_health",
  "dna_os.get_latest_work",
  "dna_os.get_work_status",
  "dna_os.get_work_evidence",
  "dna_os.get_capability_status",
  "dna_os.get_runtime_identity",
] as const;

export const RECOVERABLE_CANONICAL_STATE = [
  "CONTROL_RUNTIME_SOURCE_TREE",
  "CAPABILITY_REGISTRY_IN_SOURCE",
  "MCP_EXTERNAL_SELF_REPORTING_IN_SOURCE",
  "REGISTERED_REPOSITORY_IDENTITY",
  "PUBLISHED_ENGINEERING_COMMIT_LINEAGE",
  "PACKAGE_LOCK_FOR_DEPENDENCIES",
] as const;

export const REBINDABLE_STATE = [
  "GITHUB_CREDENTIAL_DEVICE_FLOW",
  "OWNER_VERIFIED_SESSION",
  "CONNECTION_CREDENTIAL_REFERENCE",
] as const;

export const MACHINE_LOCAL_NOT_TRANSFERRED = [
  "INSTALLATION_MACHINE_IDENTITY",
  "LOCAL_WORKSPACE_PATHS",
  "RUNTIME_JSONL_EVIDENCE_STORES",
  "KEYCHAIN_SECRET_VALUES",
  "PROCESS_LOCKS",
  "ENV_FILES",
] as const;

export interface RecoveredWorkReference {
  readonly work_id: string;
  readonly command_id: string | null;
  readonly commit_sha: string;
  readonly manifest_id: string | null;
  readonly source: "CANONICAL_GIT_COMMIT_MESSAGE";
}

export interface ControlRuntimeReconstruction {
  readonly ok: boolean;
  readonly destination_root: string;
  readonly source_commit_sha: string | null;
  readonly repository_id: string | null;
  readonly source_authority: string | null;
  readonly default_branch: string | null;
  readonly runtime_identity: {
    readonly dna_os_runtime_id: "runtime://dna-os-infrastructure";
    readonly replacement_instance_id: string;
    readonly previous_machine_identity_copied: false;
    readonly installation_state: "UNINITIALIZED_ON_REPLACEMENT_ENVIRONMENT";
  };
  readonly capability_ids: readonly string[];
  readonly mcp_self_reporting_present: boolean;
  readonly credential_bind_state: CredentialBindState;
  readonly recovered_work_refs: readonly RecoveredWorkReference[];
  readonly workspace_registration_recoverable: boolean;
  readonly copied_opaque_local_state: false;
  readonly credential_secret_exposed: false;
  readonly credential_rebind_required: true;
  readonly full_machine_independence: false;
  readonly recoverable_canonical_state: typeof RECOVERABLE_CANONICAL_STATE;
  readonly rebindable_state: typeof REBINDABLE_STATE;
  readonly machine_local_not_transferred: typeof MACHINE_LOCAL_NOT_TRANSFERRED;
  readonly detail: string;
}

function parseGithubRemote(url: string): { owner: string; repository: string } | null {
  const httpsMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (httpsMatch) return { owner: httpsMatch[1]!, repository: httpsMatch[2]! };
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (sshMatch) return { owner: sshMatch[1]!, repository: sshMatch[2]! };
  return null;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function cloneCanonicalSource(source: string, destination: string, branch?: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  const args = ["clone", "--quiet"];
  if (branch) args.push("--branch", branch, "--single-branch");
  args.push(source, destination);
  execFileSync("git", args, { encoding: "utf8", timeout: 120_000 });
}

function capabilityIdsFromSource(root: string): readonly string[] {
  const file = join(root, "control/command-router/capability-registry.ts");
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  const ids = new Set<string>();
  for (const match of text.matchAll(/capability_id:\s*"([^"]+)"/g)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids].sort();
}

function recoveredWorkFromGitLog(root: string): readonly RecoveredWorkReference[] {
  let raw = "";
  try {
    raw = git(root, ["log", "-n", "200", "--grep=work_id:", "--format=%H%x1f%B%x1e"]);
  } catch {
    return [];
  }
  const rows: RecoveredWorkReference[] = [];
  const seen = new Set<string>();
  for (const chunk of raw.split("\x1e")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const [sha, ...bodyParts] = trimmed.split("\x1f");
    if (!sha || !/^[0-9a-f]{40}$/i.test(sha.trim())) continue;
    const parsed = parseEngineeringCommitMessage(bodyParts.join("\x1f"));
    if (!parsed.work_id || !parsed.work_id.startsWith("work-")) continue;
    if (seen.has(parsed.work_id)) continue;
    seen.add(parsed.work_id);
    rows.push({
      work_id: parsed.work_id,
      command_id: parsed.command_id,
      commit_sha: sha.trim().toLowerCase(),
      manifest_id: parsed.manifest_id,
      source: "CANONICAL_GIT_COMMIT_MESSAGE",
    });
  }
  return rows;
}

function destContainsForbiddenOpaqueCopy(destination: string, sourceRoot: string): boolean {
  const forbidden = [
    join(destination, "control/owner-command/data/latest-work.jsonl"),
    join(destination, ".env"),
    join(destination, ".env.local"),
  ];
  if (forbidden.some((path) => existsSync(path))) {
    const sourceLatest = join(sourceRoot, "control/owner-command/data/latest-work.jsonl");
    const destLatest = join(destination, "control/owner-command/data/latest-work.jsonl");
    if (existsSync(destLatest) && existsSync(sourceLatest)) {
      const a = readFileSync(destLatest);
      const b = readFileSync(sourceLatest);
      if (a.equals(b) && a.length > 0) return true;
    }
    if (existsSync(join(destination, ".env")) || existsSync(join(destination, ".env.local"))) return true;
  }
  return false;
}

function scanForCredentialMaterial(root: string): boolean {
  const files: string[] = [];
  for (const name of [".env", ".env.local"]) {
    const path = join(root, name);
    if (existsSync(path)) files.push(path);
  }
  const credRoot = join(root, "credentials");
  if (existsSync(credRoot)) {
    const stack = [credRoot];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.isFile()) files.push(full);
        }
      } catch {
        continue;
      }
    }
  }
  for (const file of files) {
    try {
      const text = readFileSync(file, "utf8");
      if (/\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----)/.test(text)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export async function reconstructControlRuntime(input: {
  readonly canonical_source: string;
  readonly destination_root: string;
  readonly branch?: string;
  readonly checkout_sha?: string;
}): Promise<ControlRuntimeReconstruction> {
  const destination = resolve(input.destination_root);
  const source = resolve(input.canonical_source);
  const replacement_instance_id = `recovery-${randomUUID()}`;
  const fail = (detail: string): ControlRuntimeReconstruction => ({
    ok: false,
    destination_root: destination,
    source_commit_sha: null,
    repository_id: null,
    source_authority: null,
    default_branch: null,
    runtime_identity: {
      dna_os_runtime_id: "runtime://dna-os-infrastructure",
      replacement_instance_id,
      previous_machine_identity_copied: false,
      installation_state: "UNINITIALIZED_ON_REPLACEMENT_ENVIRONMENT",
    },
    capability_ids: [],
    mcp_self_reporting_present: false,
    credential_bind_state: "UNBOUND",
    recovered_work_refs: [],
    workspace_registration_recoverable: false,
    copied_opaque_local_state: false,
    credential_secret_exposed: false,
    credential_rebind_required: true,
    full_machine_independence: false,
    recoverable_canonical_state: RECOVERABLE_CANONICAL_STATE,
    rebindable_state: REBINDABLE_STATE,
    machine_local_not_transferred: MACHINE_LOCAL_NOT_TRANSFERRED,
    detail,
  });

  if (existsSync(destination) && readdirSync(destination).length > 0) {
    return fail("destination_root must be empty — reconstruction refuses to overlay an existing tree");
  }
  try {
    cloneCanonicalSource(source, destination, input.branch);
    try {
      const upstream = git(source, ["remote", "get-url", "origin"]);
      if (upstream.startsWith("http") || upstream.startsWith("git@")) {
        git(destination, ["remote", "set-url", "origin", upstream]);
      }
    } catch {
      // Canonical source may itself be a freshly initialized repo.
    }
    if (input.checkout_sha && /^[0-9a-f]{40}$/i.test(input.checkout_sha)) {
      git(destination, ["checkout", "-B", "dna-os-reconstructed", input.checkout_sha]);
    }
  } catch (error) {
    return fail(`git clone from canonical source failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (destContainsForbiddenOpaqueCopy(destination, source)) {
    return fail("reconstruction refused: destination contains copied machine-local latest-work or env files");
  }
  if (scanForCredentialMaterial(destination)) {
    return fail("reconstruction refused: credential material present in reconstructed tree");
  }

  const sha = git(destination, ["rev-parse", "HEAD"]).toLowerCase();
  let source_authority = "";
  try {
    source_authority = git(destination, ["remote", "get-url", "origin"]);
  } catch {
    source_authority = source;
  }
  const remote = await discoverGitRemote(destination);
  const parsed = remote.ok
    ? { owner: remote.value.owner, repository: remote.value.repository, branch: remote.value.branch }
    : parseGithubRemote(source_authority);
  const branch = remote.ok ? remote.value.branch : input.branch ?? "main";
  const owner = parsed && "owner" in parsed ? parsed.owner : null;
  const repository = parsed && "repository" in parsed ? parsed.repository : null;
  const repository_id = owner && repository ? buildRepositoryId(owner, repository) : null;
  const connStore = createConnectionRegistryStore(join(destination, "connections/connection-registry/data"));
  const githubConnection = owner && repository
    ? connStore.lookupConnection({
      adapter: "github",
      target: { owner, repository, branch: remote.ok ? remote.value.branch : (branch ?? "main") },
    }) ?? connStore.listConnections().find((row) =>
      row.adapter === "github"
      && row.target?.owner === owner
      && row.target?.repository === repository
      && row.credential_ref.kind !== "not_yet_built"
    ) ?? null
    : null;
  const credential_bind_state = inspectGithubCredentialBind(githubConnection).state;
  if (owner && repository) {
    const store = createRepositoryRegistryStore(join(destination, "software/repository-registry/data"));
    const defaultBranch = githubConnection?.target?.branch ?? branch ?? "main";
    store.registerRepository({
      owner,
      repository,
      world: "dna-os-infrastructure",
      source_authority,
      default_branch: defaultBranch,
      repository_root: destination,
      connection_id: githubConnection?.connection_id ?? null,
    });
    if (repository_id) {
      store.rebindRepositoryCheckout(repository_id, {
        repository_root: destination,
        connection_id: githubConnection?.connection_id ?? null,
      });
    }
    try {
      git(destination, ["rev-parse", "--verify", defaultBranch]);
    } catch {
      try {
        git(destination, ["branch", defaultBranch, `origin/${defaultBranch}`]);
      } catch {
        // Replacement clone may not yet have the registered default branch.
      }
    }
  }

  const capability_ids = capabilityIdsFromSource(destination);
  const mcpSource = existsSync(join(destination, "connections/dna-os-mcp/tool-registry.ts"))
    ? readFileSync(join(destination, "connections/dna-os-mcp/tool-registry.ts"), "utf8")
    : "";
  const mcp_self_reporting_present = MCP_SELF_REPORTING_TOOL_NAMES.every((name) => mcpSource.includes(name));
  const recovered_work_refs = recoveredWorkFromGitLog(destination);
  const required_tree = existsSync(join(destination, "control/command-router/capability-registry.ts"))
    && existsSync(join(destination, "connections/dna-os-mcp/tool-registry.ts"))
    && existsSync(join(destination, "control/source-workspace/contract.ts"));
  const workspace_registration_recoverable = existsSync(join(destination, "control/source-workspace/contract.ts"));

  return {
    ok: required_tree && sha.length === 40 && mcp_self_reporting_present && capability_ids.length > 0,
    destination_root: destination,
    source_commit_sha: sha,
    repository_id,
    source_authority,
    default_branch: branch,
    runtime_identity: {
      dna_os_runtime_id: "runtime://dna-os-infrastructure",
      replacement_instance_id,
      previous_machine_identity_copied: false,
      installation_state: "UNINITIALIZED_ON_REPLACEMENT_ENVIRONMENT",
    },
    capability_ids,
    mcp_self_reporting_present,
    credential_bind_state,
    recovered_work_refs,
    workspace_registration_recoverable,
    copied_opaque_local_state: false,
    credential_secret_exposed: false,
    credential_rebind_required: true,
    full_machine_independence: false,
    recoverable_canonical_state: RECOVERABLE_CANONICAL_STATE,
    rebindable_state: REBINDABLE_STATE,
    machine_local_not_transferred: MACHINE_LOCAL_NOT_TRANSFERRED,
    detail: `reconstructed ${sha} via git clone; credentials remain rebindable; installation identity is not copied`,
  };
}

export function reconstructionDigest(row: ControlRuntimeReconstruction): string {
  return createHash("sha256").update(JSON.stringify({
    sha: row.source_commit_sha,
    repository_id: row.repository_id,
    capabilities: row.capability_ids,
    works: row.recovered_work_refs.map((item) => item.work_id),
  })).digest("hex");
}

export function untrackedLifecycleWasNotCopied(sourceRoot: string, destRoot: string): boolean {
  const rel = "control/engineering-runtime/data/lifecycle.jsonl";
  let tracked = true;
  try {
    git(sourceRoot, ["ls-files", "--error-unmatch", rel]);
  } catch {
    tracked = false;
  }
  if (tracked) return true;
  return !existsSync(join(destRoot, rel));
}
