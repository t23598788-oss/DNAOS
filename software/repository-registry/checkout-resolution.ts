/**
 * Node-local checkout resolution for an existing RepositoryRegistration.
 * Not a second registry: reads the same JSONL via getRepository /
 * listOperationalRepositories / rebindRepositoryCheckout.
 *
 * Persistence still stores one repository_root per repository_id (latest
 * append wins). This module only answers "does that path exist and match
 * identity on THIS node, else a validated cwd/candidate?" — it does not
 * invent per-node rows.
 *
 * Path is never identity. Registered and candidate checkouts must match
 * source_authority via Git metadata (including linked worktrees).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { getRepository, listOperationalRepositories } from "./registry";
import type { RepositoryRegistration } from "./types";

export type CheckoutResolutionFailureCode =
  | "REPOSITORY_NOT_FOUND"
  | "REPOSITORY_NOT_ACTIVE"
  | "CHECKOUT_MISSING"
  | "CHECKOUT_IDENTITY_MISMATCH"
  | "CONTROL_PLANE_UNRESOLVED"
  | "CONTROL_PLANE_AMBIGUOUS";

export type CheckoutResolution =
  | {
      readonly ok: true;
      readonly repository_id: string;
      readonly repository_root: string;
      readonly source: "registered_checkout" | "node_cwd";
    }
  | {
      readonly ok: false;
      readonly code: CheckoutResolutionFailureCode;
      readonly reason: string;
      readonly repository_id: string | null;
    };

export interface CheckoutResolutionLookup {
  getRepository(repositoryId: string): RepositoryRegistration | null;
  listOperationalRepositories(): readonly RepositoryRegistration[];
}

export interface CheckoutResolutionHost {
  cwd(): string;
  exists(path: string): boolean;
}

let lookupOverride: CheckoutResolutionLookup | undefined;
let hostOverride: CheckoutResolutionHost | undefined;

/** Test-only. Production never calls this. */
export function setCheckoutResolutionForTests(input: {
  readonly lookup?: CheckoutResolutionLookup;
  readonly host?: CheckoutResolutionHost;
} | undefined): void {
  lookupOverride = input?.lookup;
  hostOverride = input?.host;
}

function lookup(): CheckoutResolutionLookup {
  return (
    lookupOverride ?? {
      getRepository,
      listOperationalRepositories,
    }
  );
}

function host(): CheckoutResolutionHost {
  return (
    hostOverride ?? {
      cwd: () => process.cwd(),
      exists: (path) => existsSync(path),
    }
  );
}

function gitMetadataPresentAt(root: string, usedHost: CheckoutResolutionHost): boolean {
  return usedHost.exists(join(root, ".git"));
}

/**
 * Resolve the real gitdir for a checkout.
 * Supports normal `.git/` directories and linked worktrees (`.git` gitfile).
 */
export function resolveGitDir(root: string, usedHost: CheckoutResolutionHost = host()): string | null {
  const gitPath = join(root, ".git");
  if (!usedHost.exists(gitPath)) return null;
  try {
    const st = statSync(gitPath);
    if (st.isDirectory()) return gitPath;
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  let text: string;
  try {
    text = readFileSync(gitPath, "utf8");
  } catch {
    return null;
  }
  const m = /^gitdir:\s*(.+)$/m.exec(text);
  if (!m) return null;
  const pointed = m[1]!.trim();
  const gitdir = isAbsolute(pointed) ? pointed : resolve(root, pointed);
  if (!usedHost.exists(gitdir)) return null;
  return gitdir;
}

function gitConfigTextAt(root: string, usedHost: CheckoutResolutionHost): string | null {
  const gitdir = resolveGitDir(root, usedHost);
  if (!gitdir) return null;
  const configPath = join(gitdir, "config");
  if (usedHost.exists(configPath)) {
    try {
      return readFileSync(configPath, "utf8");
    } catch {
      // fall through to commondir
    }
  }
  // Linked worktrees keep remotes in the common gitdir.
  const commonPath = join(gitdir, "commondir");
  if (!usedHost.exists(commonPath)) return null;
  try {
    const commonRel = readFileSync(commonPath, "utf8").trim();
    const common = isAbsolute(commonRel) ? commonRel : resolve(gitdir, commonRel);
    const commonConfig = join(common, "config");
    if (!usedHost.exists(commonConfig)) return null;
    return readFileSync(commonConfig, "utf8");
  } catch {
    return null;
  }
}

/**
 * Registered path + `.git` is insufficient.
 * Require source_authority to appear in Git config (worktree-aware).
 */
function identityMatchesWith(root: string, row: RepositoryRegistration, usedHost: CheckoutResolutionHost): boolean {
  if (!usedHost.exists(root) || !gitMetadataPresentAt(root, usedHost)) return false;
  const authority = row.source_authority;
  if (!authority) return false;
  const config = gitConfigTextAt(root, usedHost);
  return config !== null && config.includes(authority);
}

function fail(code: CheckoutResolutionFailureCode, reason: string, repository_id: string | null): CheckoutResolution {
  return { ok: false, code, reason, repository_id };
}

/**
 * Checkout of repository X on THIS node.
 * Prefer the registered/rebound path when it exists and matches identity.
 * Otherwise a validated cwd/candidate of the same identity.
 * Never scans the filesystem for extra roots.
 */
export function resolveRepositoryCheckout(
  repositoryId: string,
  options: {
    readonly nodeCheckoutCandidate?: string;
    readonly lookup?: CheckoutResolutionLookup;
    readonly host?: CheckoutResolutionHost;
  } = {},
): CheckoutResolution {
  const usedLookup = options.lookup ?? lookup();
  const usedHost = options.host ?? host();
  const row = usedLookup.getRepository(repositoryId);
  if (!row) return fail("REPOSITORY_NOT_FOUND", `repository_id "${repositoryId}" is not in the repository registry`, repositoryId);
  if (row.status !== "ACTIVE") {
    return fail("REPOSITORY_NOT_ACTIVE", `repository_id "${repositoryId}" has status=${row.status}`, repositoryId);
  }

  const exists = (path: string) => usedHost.exists(path);
  const registered = resolve(row.repository_root);
  if (exists(registered)) {
    if (!identityMatchesWith(registered, row, usedHost)) {
      return fail(
        "CHECKOUT_IDENTITY_MISMATCH",
        `registered repository_root exists but Git identity does not match source_authority`,
        repositoryId,
      );
    }
    return { ok: true, repository_id: row.repository_id, repository_root: registered, source: "registered_checkout" };
  }

  const candidate = resolve(options.nodeCheckoutCandidate ?? usedHost.cwd());
  if (!exists(candidate)) {
    return fail("CHECKOUT_MISSING", `no local checkout for "${repositoryId}" on this node`, repositoryId);
  }
  if (!identityMatchesWith(candidate, row, usedHost)) {
    return fail(
      "CHECKOUT_IDENTITY_MISMATCH",
      `candidate checkout is not the registered repository identity`,
      repositoryId,
    );
  }
  return { ok: true, repository_id: row.repository_id, repository_root: candidate, source: "node_cwd" };
}

/** Exactly one ACTIVE operational CONTROL_PLANE checkout on this node. */
export function resolveControlPlaneCheckout(
  options: {
    readonly nodeCheckoutCandidate?: string;
    readonly lookup?: CheckoutResolutionLookup;
    readonly host?: CheckoutResolutionHost;
  } = {},
): CheckoutResolution {
  const usedLookup = options.lookup ?? lookup();
  const rows = usedLookup
    .listOperationalRepositories()
    .filter((row) => row.status === "ACTIVE" && row.world === "CONTROL_PLANE");
  if (rows.length === 0) {
    return fail("CONTROL_PLANE_UNRESOLVED", "no ACTIVE CONTROL_PLANE operational repository", null);
  }
  if (rows.length !== 1) {
    return fail(
      "CONTROL_PLANE_AMBIGUOUS",
      `expected exactly one ACTIVE CONTROL_PLANE operational repository, found ${rows.length}`,
      null,
    );
  }
  return resolveRepositoryCheckout(rows[0]!.repository_id, options);
}
