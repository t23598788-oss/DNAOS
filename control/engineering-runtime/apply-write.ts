/**
 * หน้าที่: apply or refuse a proposed coding write inside an already
 * isolated git worktree. DNA OS chooses whether the path is in scope.
 * The worker cannot expand allowed_paths.
 *
 * Input: admitted coding scope + worktree + proposed path.
 * Output: allow/deny + optional bytes written under the worktree.
 * Dependency ที่อนุญาต: node:fs, node:path, ../work-resolution/contract.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never write outside worktree_path. never write a path
 * outside allowed_paths. never commit/push/PR.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { enforceProposedWrite, type ResolvedWorkContext } from "../work-resolution/contract";
import { isRegisteredManagedWorktree } from "../source-workspace/contract";
import type { EngineeringAdmission, EngineeringGateReason } from "./types";

export interface ScopedWriteDecision {
  readonly allowed: boolean;
  readonly reason_code: EngineeringGateReason;
  readonly detail: string;
  readonly relative_path: string | null;
  readonly absolute_path: string | null;
}

function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

function inScope(relativePath: string, scopes: readonly string[]): boolean {
  return scopes.some((scope) => relativePath === scope || relativePath.startsWith(`${scope}/`));
}

export function evaluateScopedWrite(input: {
  readonly admission: EngineeringAdmission;
  readonly worktree_path: string;
  readonly proposed_path: string;
  readonly proposed_symbols?: readonly string[];
}): ScopedWriteDecision {
  const worktree = resolve(input.worktree_path);
  if (!isRegisteredManagedWorktree(worktree)) {
    return { allowed: false, reason_code: "UNMANAGED_WORKSPACE", detail: "worker cannot write to an unmanaged workspace", relative_path: null, absolute_path: resolve(input.proposed_path) };
  }
  const proposed = resolve(input.proposed_path);
  const rel = toPosix(relative(worktree, proposed));
  if (rel.startsWith("..") || rel === "" || proposed === worktree) {
    return { allowed: false, reason_code: "WRITE_OUTSIDE_WORKTREE", detail: `proposed path is not inside the isolated worktree`, relative_path: rel.startsWith("..") ? null : rel, absolute_path: proposed };
  }
  if (inScope(rel, input.admission.forbidden_paths)) {
    return { allowed: false, reason_code: "WRITE_IN_FORBIDDEN_SCOPE", detail: `"${rel}" is explicitly forbidden`, relative_path: rel, absolute_path: proposed };
  }
  if (!inScope(rel, input.admission.allowed_paths)) {
    return { allowed: false, reason_code: "WRITE_OUT_OF_ALLOWED_SCOPE", detail: `"${rel}" is not in allowed_paths`, relative_path: rel, absolute_path: proposed };
  }
  const enforcement = enforceProposedWrite({
    work_id: input.admission.work_id,
    decision: "MISSING_CONFIRMED",
    existing_resource_id: "UNKNOWN",
    existing_capability_id: "UNKNOWN",
    canonical_name: "engineering-runtime",
    repository: input.admission.repository_id ?? "UNKNOWN",
    source_root: worktree,
    exact_source_paths: [],
    contract_paths: [],
    public_functions: [],
    input_contract: [],
    output_contract: [],
    runtime_owner: "control/engineering-runtime",
    runtime_type: "ENGINEERING",
    service_id: "engineering-runtime",
    credential_boundary: "none",
    dependencies: [],
    consumers: [],
    blueprint_refs: [],
    evidence_refs: [],
    missing_piece: "",
    required_change: "",
    allowed_write_scope: input.admission.allowed_paths,
    forbidden_write_scope: input.admission.forbidden_paths,
    components_to_reuse: [],
    components_not_to_reimplement: [],
    required_imports: [],
    verification_commands: [...input.admission.required_tests],
    completion_conditions: [...input.admission.required_tests],
    next_action: "write only admitted coding paths",
    resolution_path: [],
    dispatchable: true,
    blocking_reason: "",
  } satisfies ResolvedWorkContext, [rel], input.proposed_symbols ?? []);
  if (enforcement.verdict === "BLOCK_WRITE") {
    const reason: EngineeringGateReason = enforcement.reason_code === "IN_FORBIDDEN_SCOPE" ? "WRITE_IN_FORBIDDEN_SCOPE" : "WRITE_OUT_OF_ALLOWED_SCOPE";
    return { allowed: false, reason_code: reason, detail: enforcement.detail, relative_path: rel, absolute_path: proposed };
  }
  return { allowed: true, reason_code: "ADMITTED", detail: enforcement.detail, relative_path: rel, absolute_path: proposed };
}

export function applyScopedWorktreeWrite(decision: ScopedWriteDecision, content: string): { readonly written: boolean; readonly path: string | null } {
  if (!decision.allowed || !decision.absolute_path || !decision.relative_path) return { written: false, path: null };
  mkdirSync(dirname(decision.absolute_path), { recursive: true });
  writeFileSync(decision.absolute_path, content, "utf8");
  return { written: true, path: decision.relative_path.split("/").join(sep) };
}
