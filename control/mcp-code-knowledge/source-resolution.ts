/**
 * Engineering source resolution: a projection over Git, repository-registry,
 * work-session-state, runtime-revision, and the capability registry.
 * Not a second repository index and not an AI memory store.
 *
 * Input: optional work_id / capability_id / include_historical.
 * Output: resolveCurrentSource, lookupCodeReferences, classifyEngineeringSource.
 */

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { getCapability, listCapabilities } from "../command-router/contract";
import { readRuntimeRevision } from "../runtime-revision/contract";
import { getCurrentWorkContext } from "../work-session-state/contract";
import { currentBranch, currentRevision } from "../work-session-state/store";
import {
  classifyRepository,
  listOperationalRepositories,
  listRepositories,
} from "../../software/repository-registry/contract";

export const ENGINEERING_SOURCE_ROLES = [
  "CURRENT_CANONICAL",
  "ACTIVE_WORK",
  "REFERENCE",
  "SNAPSHOT",
  "HISTORICAL",
  "ARCHIVED",
  "EXPERIMENTAL",
  "UNKNOWN",
] as const;

export type EngineeringSourceRole = (typeof ENGINEERING_SOURCE_ROLES)[number];

const HISTORICAL_ONLY: ReadonlySet<EngineeringSourceRole> = new Set([
  "SNAPSHOT",
  "HISTORICAL",
  "ARCHIVED",
]);

const MANAGED_WORKTREE = /\.dna-os-agent-worktrees|\.dna-os-publication-checkouts|\/scratchpad\//;

export interface SourceReference {
  readonly repository_id: string | null;
  readonly source_root: string;
  readonly path: string | null;
  readonly revision: string;
  readonly branch: string | null;
  readonly classification: EngineeringSourceRole;
  readonly current: boolean;
  readonly historical_only: boolean;
  readonly safe_for_current_execution: boolean;
  readonly last_verified_at: string;
  readonly provenance: string;
  readonly related_work_id: string | null;
  readonly related_capability_ids: readonly string[];
  readonly reason: string;
  readonly stale: boolean;
}

export interface CurrentSourceResolution {
  readonly queried_at: string;
  readonly resolution: "RESOLVED" | "UNRESOLVED";
  readonly unresolved_reason: string | null;
  readonly execution: SourceReference;
  readonly registered_canonical: SourceReference | null;
  readonly work_id: string | null;
  readonly next_boundary_id: string | null;
  readonly relevant_files: readonly string[];
  readonly revision_awareness: {
    readonly source_revision: string;
    readonly runtime_revision: string | null;
    readonly checkpoint_revision: string | null;
    readonly checkpoint_stale: boolean;
    readonly runtime_stale: boolean;
  };
  readonly related_snapshots: readonly SourceReference[];
  readonly snapshot_omitted_count: number;
  readonly sources: readonly { readonly fact: string; readonly authority: string; readonly path: string }[];
  readonly interpretation: string | null;
}

export interface CodeReferenceLookup {
  readonly queried_at: string;
  readonly query: string | null;
  readonly capability_id: string | null;
  readonly include_historical: boolean;
  readonly unresolved_reason: string | null;
  readonly current_refs: readonly SourceReference[];
  readonly historical_refs: readonly SourceReference[];
  readonly action_ids: readonly string[];
  readonly SOURCE_SEARCH_REQUIRED: false;
  readonly sources: readonly { readonly fact: string; readonly authority: string; readonly path: string }[];
  readonly interpretation: string | null;
}

function realPath(p: string): string {
  try {
    return existsSync(p) ? realpathSync(p) : p;
  } catch {
    return p;
  }
}

function git(repoRoot: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function gitRemote(repoRoot: string): string | null {
  const raw = git(repoRoot, ["config", "--get", "remote.origin.url"]);
  return raw ? raw.replace(/\.git$/, "") : null;
}

interface GitWorktree {
  readonly source_root: string;
  readonly revision: string;
  readonly branch: string | null;
}

function listGitWorktrees(repoRoot: string): readonly GitWorktree[] {
  const text = git(repoRoot, ["worktree", "list", "--porcelain"]);
  if (!text) return [];
  const out: GitWorktree[] = [];
  let source_root = "";
  let revision = "UNKNOWN_REVISION";
  let branch: string | null = null;
  const flush = (): void => {
    if (!source_root) return;
    out.push({ source_root, revision, branch });
    source_root = "";
    revision = "UNKNOWN_REVISION";
    branch = null;
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      source_root = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      revision = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "detached") {
      branch = null;
    }
  }
  flush();
  return out;
}

function normalizeRemote(url: string): string {
  return url.replace(/\.git$/, "").replace(/\/$/, "");
}

export function classifyEngineeringSource(input: {
  readonly source_root: string;
  readonly cwd: string;
  readonly registry_status?: string;
  readonly census?: ReturnType<typeof classifyRepository>;
  readonly is_git_worktree_other?: boolean;
  readonly work_bound?: boolean;
}): EngineeringSourceRole {
  const root = realPath(input.source_root);
  const cwd = realPath(input.cwd);
  if (input.registry_status === "SUSPENDED" || input.registry_status === "RETIRED") return "ARCHIVED";
  if (input.census === "UNCLASSIFIED") return "UNKNOWN";
  if (input.census === "TEST_FIXTURE") return "HISTORICAL";
  if (root === cwd && input.census === "OPERATIONAL") return "CURRENT_CANONICAL";
  if (root === cwd && input.work_bound) return "ACTIVE_WORK";
  if (root === cwd) return "EXPERIMENTAL";
  if (input.is_git_worktree_other) return "SNAPSHOT";
  if (input.census === "OPERATIONAL") return "REFERENCE";
  return "UNKNOWN";
}

function roleForRoot(root: string, cwd: string, workBound: boolean): {
  readonly classification: EngineeringSourceRole;
  readonly repository_id: string | null;
  readonly census: ReturnType<typeof classifyRepository> | null;
} {
  const rp = realPath(root);
  const cwdRp = realPath(cwd);
  const rows = listRepositories().filter((row) => realPath(row.repository_root) === rp);
  if (rows.length > 1) {
    return { classification: "UNKNOWN", repository_id: null, census: "UNCLASSIFIED" };
  }
  const row = rows[0];
  if (row) {
    const census = classifyRepository(row);
    return {
      classification: classifyEngineeringSource({
        source_root: rp,
        cwd: cwdRp,
        registry_status: row.status,
        census,
        is_git_worktree_other: rp !== cwdRp,
        work_bound: workBound,
      }),
      repository_id: row.repository_id,
      census,
    };
  }
  return {
    classification: classifyEngineeringSource({
      source_root: rp,
      cwd: cwdRp,
      is_git_worktree_other: rp !== cwdRp,
      work_bound: workBound,
    }),
    repository_id: null,
    census: null,
  };
}

function refFor(input: {
  readonly source_root: string;
  readonly path: string | null;
  readonly revision: string;
  readonly branch: string | null;
  readonly cwd: string;
  readonly work_id: string | null;
  readonly capability_ids: readonly string[];
  readonly reason: string;
  readonly now: string;
  readonly current_sha: string;
}): SourceReference {
  const classified = roleForRoot(input.source_root, input.cwd, Boolean(input.work_id) && realPath(input.source_root) === realPath(input.cwd));
  const current = classified.classification === "CURRENT_CANONICAL" || classified.classification === "ACTIVE_WORK";
  const historical_only = HISTORICAL_ONLY.has(classified.classification);
  return {
    repository_id: classified.repository_id,
    source_root: realPath(input.source_root),
    path: input.path,
    revision: input.revision,
    branch: input.branch,
    classification: classified.classification,
    current,
    historical_only,
    safe_for_current_execution: current && realPath(input.source_root) === realPath(input.cwd),
    last_verified_at: input.now,
    provenance: classified.repository_id ? "software/repository-registry" : "git",
    related_work_id: input.work_id,
    related_capability_ids: input.capability_ids,
    reason: input.reason,
    stale: input.revision !== input.current_sha && input.revision !== "UNKNOWN_REVISION",
  };
}

function operationalForRemote(remote: string | null) {
  if (!remote) return [];
  const n = normalizeRemote(remote);
  return listOperationalRepositories().filter((row) => normalizeRemote(row.source_authority) === n);
}

export function resolveCurrentSource(workId?: string): CurrentSourceResolution {
  const queried_at = new Date().toISOString();
  const cwd = process.cwd();
  const sha = currentRevision(cwd);
  const branch = currentBranch(cwd);
  const remote = gitRemote(cwd);
  const work = getCurrentWorkContext(workId);
  const runtime = readRuntimeRevision();
  const operational = operationalForRemote(remote);
  const cwdMatches = operational.filter((row) => realPath(row.repository_root) === realPath(cwd));
  let resolution: "RESOLVED" | "UNRESOLVED" = "RESOLVED";
  let unresolved_reason: string | null = null;
  if (operational.length > 1 && cwdMatches.length === 0) {
    resolution = "UNRESOLVED";
    unresolved_reason = "multiple OPERATIONAL registrations share this remote and none match process cwd";
  } else if (cwdMatches.length > 1) {
    resolution = "UNRESOLVED";
    unresolved_reason = "multiple OPERATIONAL registrations resolve to the same cwd";
  }

  const execution = refFor({
    source_root: cwd,
    path: null,
    revision: sha,
    branch,
    cwd,
    work_id: work.work_id,
    capability_ids: work.relevant_capabilities.map((c) => c.capability_id),
    reason: work.work_id ? "process cwd bound to current work journal" : "process cwd git checkout",
    now: queried_at,
    current_sha: sha,
  });

  const registeredRow = cwdMatches[0] ?? (operational.length === 1 ? operational[0] : null);
  const registered_canonical = registeredRow
    ? refFor({
        source_root: registeredRow.repository_root,
        path: null,
        revision: git(registeredRow.repository_root, ["rev-parse", "HEAD"]) ?? "UNKNOWN_REVISION",
        branch: git(registeredRow.repository_root, ["rev-parse", "--abbrev-ref", "HEAD"]),
        cwd,
        work_id: work.work_id,
        capability_ids: work.relevant_capabilities.map((c) => c.capability_id),
        reason: "OPERATIONAL row in software/repository-registry",
        now: queried_at,
        current_sha: sha,
      })
    : null;

  const related_snapshots: SourceReference[] = [];
  let snapshot_omitted_count = 0;
  for (const tree of listGitWorktrees(cwd)) {
    if (realPath(tree.source_root) === realPath(cwd)) continue;
    if (registeredRow && realPath(tree.source_root) === realPath(registeredRow.repository_root)) continue;
    if (MANAGED_WORKTREE.test(tree.source_root)) {
      snapshot_omitted_count += 1;
      continue;
    }
    if (related_snapshots.length >= 8) {
      snapshot_omitted_count += 1;
      continue;
    }
    related_snapshots.push(refFor({
      source_root: tree.source_root,
      path: null,
      revision: tree.revision,
      branch: tree.branch,
      cwd,
      work_id: work.work_id,
      capability_ids: [],
      reason: "git worktree of the same repository — not current execution",
      now: queried_at,
      current_sha: sha,
    }));
  }

  return {
    queried_at,
    resolution,
    unresolved_reason,
    execution,
    registered_canonical,
    work_id: work.work_id,
    next_boundary_id: work.next_boundary?.id ?? null,
    relevant_files: work.relevant_files,
    revision_awareness: work.revision_awareness,
    related_snapshots,
    snapshot_omitted_count,
    sources: [
      { fact: "execution_head", authority: "git", path: "control/work-session-state/store.ts#currentRevision" },
      { fact: "registered_canonical", authority: "repository_registry", path: "software/repository-registry/registry.ts" },
      { fact: "work_progress", authority: "work_session_state", path: "control/work-session-state/contract.ts#getCurrentWorkContext" },
      { fact: "runtime_revision", authority: "runtime", path: "control/runtime-revision/contract.ts#readRuntimeRevision" },
      { fact: "git_worktrees", authority: "git", path: "git worktree list --porcelain" },
    ],
    interpretation: runtime.reason,
  };
}

function matchCapabilities(query: string): readonly string[] {
  const q = query.toLowerCase();
  const hits: string[] = [];
  for (const cap of listCapabilities()) {
    if (cap.capability_id === query || cap.capability_id.includes(q)) {
      hits.push(cap.capability_id);
      continue;
    }
    if (cap.match_keyword_sets.some((set) => set.every((token) => q.includes(token.toLowerCase())))) {
      hits.push(cap.capability_id);
    }
  }
  return [...new Set(hits)];
}

export function lookupCodeReferences(input: {
  readonly capability_id?: string;
  readonly query?: string;
  readonly include_historical?: boolean;
  readonly work_id?: string;
}): CodeReferenceLookup {
  const queried_at = new Date().toISOString();
  const cwd = process.cwd();
  const sha = currentRevision(cwd);
  const branch = currentBranch(cwd);
  const work = getCurrentWorkContext(input.work_id);
  const include_historical = input.include_historical === true;
  const query = input.query ?? null;
  let capability_id = input.capability_id ?? null;
  let unresolved_reason: string | null = null;
  if (!capability_id && query) {
    const matches = matchCapabilities(query);
    if (matches.length === 1) capability_id = matches[0]!;
    else if (matches.length > 1) unresolved_reason = `ambiguous capability query; candidates=${matches.join(",")}`;
  }

  const cap = capability_id ? getCapability(capability_id) : undefined;
  const paths: string[] = [];
  if (cap && cap.contract !== "not_yet_built") paths.push(cap.contract);
  if (cap?.endpoint && cap.endpoint.kind !== "not_yet_built") paths.push(cap.endpoint.module);
  if (capability_id && work.relevant_capabilities.some((c) => c.capability_id === capability_id)) {
    for (const file of work.relevant_files) {
      if (!paths.includes(file)) paths.push(file);
    }
  }
  if (!capability_id && query && /owner|authoriz/.test(query.toLowerCase())) {
    for (const file of work.relevant_files) {
      if (/owner-auth|owner-command|owner-authentication/.test(file) && !paths.includes(file)) paths.push(file);
    }
  }
  if (!capability_id && !paths.length && work.relevant_files.length > 0 && !query) {
    paths.push(...work.relevant_files);
  }

  const current_refs = paths.map((path) => refFor({
    source_root: cwd,
    path,
    revision: sha,
    branch,
    cwd,
    work_id: work.work_id,
    capability_ids: capability_id ? [capability_id] : [],
    reason: cap ? "capability registry contract/endpoint" : "current work relevant_files",
    now: queried_at,
    current_sha: sha,
  }));

  const historical_refs: SourceReference[] = [];
  if (include_historical) {
    const resolved = resolveCurrentSource(input.work_id);
    const snapshotRoots = [
      ...(resolved.registered_canonical && realPath(resolved.registered_canonical.source_root) !== realPath(cwd)
        ? [resolved.registered_canonical]
        : []),
      ...resolved.related_snapshots,
    ];
    for (const snap of snapshotRoots) {
      if (!HISTORICAL_ONLY.has(snap.classification) && snap.classification !== "REFERENCE") continue;
      for (const path of paths.length ? paths : [null]) {
        historical_refs.push({
          ...snap,
          path,
          current: false,
          historical_only: true,
          safe_for_current_execution: false,
          classification: snap.classification === "REFERENCE" ? "SNAPSHOT" : snap.classification,
          reason: "explicit historical/snapshot lookup — not current implementation",
        });
      }
    }
  }

  return {
    queried_at,
    query,
    capability_id,
    include_historical,
    unresolved_reason,
    current_refs,
    historical_refs,
    action_ids: cap?.supported_commands ?? [],
    SOURCE_SEARCH_REQUIRED: false,
    sources: [
      { fact: "capability_implementation", authority: "capability_registry", path: "control/command-router/capability-registry.ts" },
      { fact: "work_files", authority: "work_session_state", path: "control/work-session-state/contract.ts#getCurrentWorkContext" },
      { fact: "revision", authority: "git", path: "control/work-session-state/store.ts#currentRevision" },
    ],
    interpretation: null,
  };
}
