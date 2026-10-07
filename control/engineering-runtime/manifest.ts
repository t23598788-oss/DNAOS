/**
 * หน้าที่: DNA OS builds the Engineering Result Manifest from observed
 * worktree facts and the original admitted intent. Worker claims cannot
 * widen allowed_paths, symbols, or worker_authority.
 *
 * Input: original admission + observed diff + tests + lineage.
 * Output: EngineeringResultManifest.
 * Dependency ที่อนุญาต: node:crypto, ./types.ts, ./observe.ts.
 * สิ่งที่ห้ามแตะ: never copy allowed_paths from a worker-supplied object.
 */

import { randomUUID } from "node:crypto";
import { changedSymbolsIn, classifyPath, definitionOfDone, hashChangedArtifacts } from "./observe";
import { WORKER_DENIED_OPERATIONS, type EngineeringAdmission, type EngineeringLineage, type EngineeringResultManifest, type EngineeringTestResult } from "./types";

export function buildEngineeringManifest(input: {
  readonly admission: EngineeringAdmission;
  readonly lineage: EngineeringLineage;
  readonly changed_paths: readonly string[];
  readonly tests: readonly EngineeringTestResult[];
  readonly evidence_refs: readonly string[];
}): EngineeringResultManifest | { readonly ok: false; readonly reason_code: "CODING_INCOMPLETE"; readonly detail: string } {
  const { admission, lineage } = input;
  if (!lineage.reservation_id || !lineage.worktree_path || !lineage.base_commit_sha || !lineage.branch_ref || !admission.repository_id) {
    return { ok: false, reason_code: "CODING_INCOMPLETE", detail: "manifest requires reservation, worktree, base revision, branch, and repository_id" };
  }
  const dod = definitionOfDone({
    admission,
    changed_paths: input.changed_paths,
    tests: input.tests,
    evidence_refs: input.evidence_refs,
  });
  const artifacts = hashChangedArtifacts(lineage.worktree_path, input.changed_paths);
  return {
    manifest_id: `erm-${randomUUID()}`,
    produced_by: "control/engineering-runtime",
    command_id: admission.command_id,
    work_id: admission.work_id,
    repository_id: admission.repository_id,
    reservation_id: lineage.reservation_id,
    base_commit_sha: lineage.base_commit_sha,
    branch_ref: lineage.branch_ref,
    worktree_path: lineage.worktree_path,
    allowed_paths: [...admission.allowed_paths],
    allowed_symbols: [...admission.allowed_symbols],
    changed_paths: [...input.changed_paths],
    changed_symbols: changedSymbolsIn(lineage.worktree_path, input.changed_paths),
    required_tests: [...admission.required_tests],
    actual_test_results: input.tests,
    forbidden_paths: [...admission.forbidden_paths],
    produced_artifacts: artifacts,
    documentation_changed: input.changed_paths.filter((path) => classifyPath(path) === "human_documentation"),
    registry_connection_records_changed: input.changed_paths.filter((path) => classifyPath(path) === "registry_record"),
    completion_timestamp: new Date().toISOString(),
    evidence_refs: [...input.evidence_refs],
    worker_authority: WORKER_DENIED_OPERATIONS,
    definition_of_done: dod.flags,
  };
}
