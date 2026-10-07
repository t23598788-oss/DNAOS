/**
 * หน้าที่: DNA OS Integration Authority. After Admission=ALLOW, DNA OS
 * copies admitted artifacts from the isolated worktree into the
 * registered source repository. The coding worker never copies, commits,
 * pushes, opens a PR, or deploys.
 *
 * Input: ALLOW admission + derived manifest + registered repository_root.
 * Output: integration result with copied paths.
 * Dependency ที่อนุญาต: node:fs, node:path, ./observe.ts, ./persist.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never copy a path outside admitted changed_paths.
 * never git push / commit / PR / deploy. never continueRegisteredArtifact.
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { inScope, readRegisteredBaseRevision } from "./observe";
import { ENGINEERING_COMPLETION_REGISTRY_REL, persistCompletionRegistry } from "./persist";
import { resolveCodingRepository } from "./repository";
import { getRepository } from "../../software/repository-registry/contract";
import type { EngineeringAdmission, EngineeringIntegrationResult, EngineeringResultManifest } from "./types";

function posix(path: string): string {
  return path.replaceAll("\\", "/");
}

export function integrateAdmittedEngineering(input: {
  readonly admission: EngineeringAdmission;
  readonly manifest: EngineeringResultManifest;
  readonly checkout_root: string;
}): EngineeringIntegrationResult {
  const repoRoot = input.admission.repository_root;
  if (!repoRoot) {
    return { integrated: false, reason_code: "REPOSITORY_IDENTITY_MISSING", detail: "no repository_root on admission", integrated_paths: [], registry_record_path: null };
  }
  const identity = resolveCodingRepository(input.checkout_root);
  if (!identity.ok) {
    return { integrated: false, reason_code: identity.reason_code, detail: identity.detail, integrated_paths: [], registry_record_path: null };
  }
  const destRoot = resolve(repoRoot);
  if (identity.repository.repository_id !== input.manifest.repository_id) {
    return { integrated: false, reason_code: "REPOSITORY_IDENTITY_MISMATCH", detail: "integration target is not the admitted registered repository", integrated_paths: [], registry_record_path: null };
  }
  if (resolve(input.checkout_root) !== destRoot) {
    return { integrated: false, reason_code: "REPOSITORY_IDENTITY_MISMATCH", detail: "integration checkout_root is not the admitted repository_root", integrated_paths: [], registry_record_path: null };
  }
  const registered = getRepository(identity.repository.repository_id);
  const head = registered ? readRegisteredBaseRevision(repoRoot, registered.default_branch) : null;
  if (!head || head !== input.manifest.base_commit_sha) {
    return { integrated: false, reason_code: "BASE_REVISION_MISMATCH", detail: `base branch ${registered?.default_branch ?? "unknown"} tip ${head ?? "unknown"} != reservation base ${input.manifest.base_commit_sha}`, integrated_paths: [], registry_record_path: null };
  }

  const worktree = resolve(input.manifest.worktree_path);
  if (worktree === destRoot) {
    return { integrated: false, reason_code: "REPOSITORY_ROOT_USED_AS_WRITE_SCOPE", detail: "refusing to treat repository_root as the worktree", integrated_paths: [], registry_record_path: null };
  }

  const copied: string[] = [];
  for (const rel of input.manifest.changed_paths) {
    const normalized = posix(rel);
    if (normalized === "." || normalized.includes("..") || normalized.startsWith("/") || normalized.includes("*")) {
      return { integrated: false, reason_code: "SCOPE_EXPANDED", detail: `refusing integration path ${normalized}`, integrated_paths: copied, registry_record_path: null };
    }
    if (!inScope(normalized, input.admission.allowed_paths) || inScope(normalized, input.admission.forbidden_paths)) {
      return { integrated: false, reason_code: "UNDECLARED_FILE_CHANGE", detail: `integration path not admitted: ${normalized}`, integrated_paths: copied, registry_record_path: null };
    }
    const from = join(worktree, normalized);
    const to = join(destRoot, normalized);
    if (resolve(to) === destRoot || !resolve(to).startsWith(`${destRoot}/`)) {
      return { integrated: false, reason_code: "WRITE_OUTSIDE_WORKTREE", detail: `integration destination escapes repository: ${normalized}`, integrated_paths: copied, registry_record_path: null };
    }
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied.push(normalized);
  }

  const registryPath = persistCompletionRegistry({
    command_id: input.manifest.command_id,
    work_id: input.manifest.work_id,
    repository_id: input.manifest.repository_id,
    reservation_id: input.manifest.reservation_id,
    manifest_id: input.manifest.manifest_id,
    integrated_paths: copied,
    recorded_at: new Date().toISOString(),
    source: "control/engineering-runtime/integrate.ts",
  });

  return {
    integrated: true,
    reason_code: "ADMITTED",
    detail: `DNA OS integrated ${copied.length} admitted path(s)`,
    integrated_paths: copied,
    registry_record_path: posix(ENGINEERING_COMPLETION_REGISTRY_REL) + `:${registryPath}`,
  };
}
