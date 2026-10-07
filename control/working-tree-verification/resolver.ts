/**
 * หน้าที่: `runWorkingTreeVerification()` — resolve the identity of an
 * uncommitted state, run this repo's OWN declared required checks against it,
 * and return a verdict whose authority is explicitly weaker than a commit's.
 *
 * NOT A SECOND CHECK ENGINE. Requirement resolution, check execution and the
 * pass/fail decision are all `../post-commit-verification/`'s, imported through
 * its contract. Nothing here spawns a check, decides what "required" means, or
 * re-implements a status mapping. If that folder's rules change, this entry
 * point changes with them, because it has no rules of its own.
 *
 * Input: `WorkingTreeVerificationInput`.
 * Output: `runWorkingTreeVerification`, `resolveWorkingTreeRevision`.
 * Dependency ที่อนุญาต: ./types.ts, ../post-commit-verification/contract.ts,
 * node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามคืน "VERIFIED", ห้ามสร้าง commit, ห้าม commit/stash/reset
 * เพื่อให้ผ่าน gate — ไฟล์นี้อ่าน git อย่างเดียว.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveRequiredChecks,
  runOneCheck,
  decideVerification,
} from "../post-commit-verification/contract";
import type { CheckResult, CheckType } from "../post-commit-verification/contract";
import type {
  WorkingTreeRevision,
  WorkingTreeVerificationInput,
  WorkingTreeVerificationResult,
  WorkingTreeReasonCode,
  WorkingTreeVerificationStatus,
} from "./types";

/** Read-only git. Every invocation in this file is a query; none mutates the repository. */
function git(repoRoot: string, args: string[]): string {
  return execFileSync("/usr/bin/git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

export function resolveWorkingTreeRevision(repoRoot: string): WorkingTreeRevision | null {
  let head: string;
  let porcelain: string;
  try {
    head = git(repoRoot, ["rev-parse", "HEAD"]);
    // -z + porcelain=v1 so a path containing a space, a quote or a newline is
    // parsed by delimiter rather than by guessing where the filename ends.
    porcelain = execFileSync("/usr/bin/git", ["status", "--porcelain=v1", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }

  const entries: { path: string; status: string; content_sha256: string | null }[] = [];
  const fields = porcelain.split("\0").filter((f) => f.length > 0);
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    const status = field.slice(0, 2);
    const path = field.slice(3);
    // A rename entry is followed by its origin path in the next field.
    if (status[0] === "R" || status[1] === "R") i += 1;
    let contentSha: string | null = null;
    try {
      contentSha = createHash("sha256").update(readFileSync(join(repoRoot, path))).digest("hex");
    } catch {
      contentSha = null; // deleted, or unreadable — recorded as null, not as an empty hash
    }
    entries.push({ path, status, content_sha256: contentSha });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const digest = createHash("sha256")
    .update(head)
    .update("\n")
    .update(entries.map((e) => `${e.status}\t${e.path}\t${e.content_sha256 ?? "ABSENT"}`).join("\n"))
    .digest("hex");

  return { head_sha: head, working_tree_digest: digest, dirty_paths: entries, clean: entries.length === 0 };
}

export interface WorkingTreeVerificationDeps {
  /** Where each check's evidence is written. Injected so this folder owns no evidence store of its own. */
  saveCheckEvidence: (check: CheckResult, correlationId: string) => string;
}

export async function runWorkingTreeVerification(
  input: WorkingTreeVerificationInput,
  deps: WorkingTreeVerificationDeps,
): Promise<WorkingTreeVerificationResult> {
  const created_at = new Date().toISOString();
  const verification_id = `wtv-${randomUUID()}`;
  const base = {
    verification_id,
    authority: "OWNER_TRIGGERED_ONLY" as const,
    created_at,
  };

  const revision = resolveWorkingTreeRevision(input.repo_root);
  if (revision === null) {
    return { ...base, status: "UNRESOLVED", reason_code: "GIT_UNAVAILABLE", revision: null, required_checks: [], checks: [], unverified_claims: input.claimed_changed_paths, created_at };
  }

  // Cross-check the caller's claim against git rather than believing it. A
  // claimed path git does not report dirty is named, and it does not silently
  // become part of what this verification says it covered.
  const dirtyAbs = new Set(revision.dirty_paths.map((d) => join(input.repo_root, d.path)));
  const unverified_claims = input.claimed_changed_paths.filter((p) => !dirtyAbs.has(p));

  if (revision.clean) {
    // Nothing uncommitted: this entry point is not the right authority, and
    // saying so is more useful than verifying a tree that equals HEAD.
    return { ...base, status: "UNRESOLVED", reason_code: "TREE_IS_CLEAN", revision, required_checks: [], checks: [], unverified_claims };
  }

  const requirements = resolveRequiredChecks(input.repo_root);
  if (requirements.length === 0) {
    return { ...base, status: "UNRESOLVED", reason_code: "VERIFICATION_REQUIREMENT_NOT_FOUND", revision, required_checks: [], checks: [], unverified_claims };
  }

  // Sequential, for the same reason post-commit runs them sequentially: some
  // registered commands hold an exclusive lock and must never overlap themselves.
  const checks: CheckResult[] = [];
  for (const requirement of requirements) {
    checks.push(await runOneCheck(requirement, input.correlation_id, {
      saveCheckEvidence: (checkResult) => deps.saveCheckEvidence(checkResult, input.correlation_id),
    }));
  }

  const requiredTypes: CheckType[] = requirements.map((r) => r.check_type);
  const decision = decideVerification(requiredTypes, checks);

  // The one place the two entry points differ in outcome: post-commit's
  // VERIFIED becomes WORKING_TREE_VERIFIED here. FAILED and UNRESOLVED are
  // carried through unchanged — a weaker authority never softens a failure.
  const status: WorkingTreeVerificationStatus =
    decision.status === "VERIFIED" ? "WORKING_TREE_VERIFIED" : decision.status;
  const reason_code: WorkingTreeReasonCode =
    decision.reason_code === "VERIFIED" ? "WORKING_TREE_VERIFIED" : (decision.reason_code as WorkingTreeReasonCode);

  return { ...base, status, reason_code, revision, required_checks: requiredTypes, checks, unverified_claims };
}
