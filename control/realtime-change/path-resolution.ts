/**
 * หน้าที่: resolves a real filesystem path to the identities the system
 * ALREADY holds for it (Owner, 2026-08-26).
 *
 * IT NEVER MINTS AN IDENTITY. Every id returned here came out of a registry
 * that already had it. When nothing matches, the answer is "unresolved" with
 * the reason — a path that no registry knows is a real, reportable state, and
 * inventing a resource for it would create a second identity for something
 * that may already exist under another path.
 *
 * Two independent lookups, because they answer different questions:
 *   path -> RESOURCE   via software/registry-database's source_location index
 *   path -> CAPABILITY via control/command-router's registered contract paths
 *
 * Input: an absolute or repo-relative path.
 * Output: `PathResolution` — ids with provenance and evidence, or explicit
 * unresolved reasons.
 * Dependency ที่อนุญาต: ../command-router/contract.ts,
 * ../../software/registry-database/contract.ts, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามสร้าง resource_id/capability_id ใหม่จากไฟล์นี้.
 */

declare const require: any;
declare const process: { cwd(): string };

import { listCapabilities } from "../command-router/contract";
import type { RegistryStore } from "../../software/registry-database/contract";

const path = require("node:path");

export interface PathResolution {
  input_path: string;
  repo_relative_path: string;
  resource: { resource_id: string; source_location: string; provenance: string; evidence: readonly string[] } | null;
  capability: { capability_id: string; provenance: string; evidence: readonly string[] } | null;
  unresolved: readonly string[];
}

const REPO_ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";

export function toRepoRelative(inputPath: string): string {
  const absolute = path.isAbsolute(inputPath) ? inputPath : path.join(REPO_ROOT, inputPath);
  const relative = path.relative(REPO_ROOT, absolute);
  return relative.startsWith("..") ? absolute : relative;
}

/**
 * The capability that OWNS a path, decided by the registry's own recorded
 * contract path: a capability's contract lives in its folder, so the folder
 * prefix is the ownership fact the registry already states. Longest prefix
 * wins, so `control/agent-gateway/adapters/x.ts` resolves to agent-gateway and
 * not to some shorter, coincidental match.
 */
export function resolveCapabilityForPath(repoRelativePath: string): PathResolution["capability"] {
  const candidates = listCapabilities()
    .filter((capability) => typeof capability.contract === "string" && capability.contract.includes("/"))
    .map((capability) => ({ capability, folder: path.dirname(capability.contract) }))
    .filter((entry) => entry.folder !== "." && (repoRelativePath === entry.folder || repoRelativePath.startsWith(`${entry.folder}/`)))
    .sort((a, b) => b.folder.length - a.folder.length);

  if (candidates.length === 0) return null;
  const winner = candidates[0];
  return {
    capability_id: winner.capability.capability_id,
    provenance: "REGISTRY",
    evidence: [`control/command-router/capability-registry.ts#${winner.capability.capability_id}`, `owning_folder=${winner.folder}`, `contract=${winner.capability.contract}`],
  };
}

export function resolveResourceForPath(repoRelativePath: string, store: RegistryStore | undefined): { resource: PathResolution["resource"]; unresolvedReason: string | null } {
  if (!store) return { resource: null, unresolvedReason: "no registry store was provided to this resolution" };
  const lookup = store.findResourceBySourceLocation;
  if (typeof lookup !== "function") {
    return { resource: null, unresolvedReason: "this registry store adapter does not implement findResourceBySourceLocation — path lookup unavailable, no identity was invented" };
  }
  // The registry records a resource's source_location the way that registry
  // writes it — measured 2026-08-26: folder-level, with a trailing slash
  // ("control/target-resolution/"). A changed FILE therefore matches its
  // OWNING resource, not an entry of its own. The forms are tried in order of
  // specificity and the one that matched is recorded, so the match is never
  // ambiguous about what it actually found.
  const candidates: { form: string; value: string }[] = [
    { form: "exact-file", value: repoRelativePath },
    { form: "exact-file-with-slash", value: `${repoRelativePath}/` },
    { form: "owning-folder-with-slash", value: `${path.dirname(repoRelativePath)}/` },
    { form: "owning-folder", value: path.dirname(repoRelativePath) },
  ];
  for (const candidate of candidates) {
    const row = lookup.call(store, candidate.value);
    if (!row) continue;
    return {
      resource: {
        resource_id: row.resource_id,
        source_location: row.source_location,
        provenance: "RESOURCE_GRAPH",
        evidence: [`software/registry-database#resource:${row.resource_id}`, `matched_form=${candidate.form}`, `source_location=${row.source_location}`, `content_hash=${row.content_hash}`],
      },
      unresolvedReason: null,
    };
  }
  return { resource: null, unresolvedReason: `no registered resource has source_location "${repoRelativePath}" (tried: ${candidates.map((c) => c.value).join(", ")})` };
}

export function resolvePath(inputPath: string, store: RegistryStore | undefined): PathResolution {
  const repoRelative = toRepoRelative(inputPath);
  const capability = resolveCapabilityForPath(repoRelative);
  const { resource, unresolvedReason } = resolveResourceForPath(repoRelative, store);
  const unresolved: string[] = [];
  if (!capability) unresolved.push(`no registered capability owns "${repoRelative}"`);
  if (unresolvedReason) unresolved.push(unresolvedReason);
  return { input_path: inputPath, repo_relative_path: repoRelative, resource, capability, unresolved };
}
