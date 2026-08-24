/**
 * หน้าที่: `decideRelease()` — the one real entry point for Release
 * Authority. Real `RELEASE:<repository_id>` lock (via
 * `execution/process-lock/`) so two concurrent release decisions for the
 * same repository never race. Never re-runs build/test — reads the
 * already-produced `post_commit_verification` Evidence row for this
 * exact `task_id`+`commit_sha` (written by
 * `control/post-commit-verification/resolver.ts`, unmodified, real).
 * Re-checks each declared dependency's CURRENT real version against what
 * was declared — a real, live re-read of `../../software/registry-database/`,
 * never a cached assumption.
 *
 * Input: `ReleaseAuthorityInput`, a real `RegistryStore`.
 * Output: `decideRelease` -> `ReleaseAuthorityResult`.
 * Dependency ที่อนุญาต: ../../control/agent-gateway/contract.ts
 * (loadEvidenceForTask — read-only), ../../software/registry-database/contract.ts
 * (findCapability — read-only), ../../execution/process-lock/contract.ts,
 * ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never call control/post-commit-verification/'s
 * `runPostCommitVerification` here — that would re-run real build/test
 * commands from inside a governance decision, and risks recursively
 * re-triggering `npm run test:integration`. Never return
 * RELEASE_ELIGIBLE without a real, found, VERIFIED post_commit_verification
 * evidence row. Never silently release with a stale dependency.
 */

import { loadEvidenceForTask } from "../../control/agent-gateway/contract";
import { findCapability } from "../../software/registry-database/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import { acquireLock, releaseLock } from "../../execution/process-lock/contract";
import { fileExistsOnDisk, newReleaseDecisionId, nowIso } from "./host-runtime";
import type { ReleaseAuthorityInput, ReleaseAuthorityResult, ReleaseDecisionStatus } from "./types";

interface PostCommitVerificationEvidencePayload {
  commit_sha: string;
  status: "VERIFIED" | "FAILED" | "UNRESOLVED";
  reason_code: string;
}

function finalize(input: ReleaseAuthorityInput, status: ReleaseDecisionStatus, reason: string, staleDependencies: readonly string[] = []): ReleaseAuthorityResult {
  return {
    release_decision_id: newReleaseDecisionId(),
    status,
    reason,
    commit_sha: input.commit_sha,
    repository_id: input.repository_id,
    stale_dependencies: staleDependencies,
    correlation_id: input.correlation_id,
    created_at: nowIso(),
  };
}

export function decideRelease(input: ReleaseAuthorityInput, store: RegistryStore): ReleaseAuthorityResult {
  const lockKey = `RELEASE:${input.repository_id}`;
  const lock = acquireLock({ lock_key: lockKey, holder_id: input.correlation_id, lease_ms: 30_000 });
  if (lock.status !== "ACQUIRED") {
    return finalize(input, "RELEASE_UNRESOLVED", `another release decision is already in progress for repository_id=${input.repository_id} (held by ${lock.held_by?.holder_id ?? "unknown"})`);
  }

  try {
    // Real, already-produced verification evidence — never re-run here.
    const verificationEvidence = loadEvidenceForTask(input.task_id).find((e) => e.kind === "post_commit_verification" && (e.payload as PostCommitVerificationEvidencePayload).commit_sha === input.commit_sha);
    if (!verificationEvidence) {
      return finalize(input, "RELEASE_UNRESOLVED", `no post_commit_verification evidence found for task_id=${input.task_id} commit_sha=${input.commit_sha}`);
    }
    const verification = verificationEvidence.payload as PostCommitVerificationEvidencePayload;
    if (verification.status !== "VERIFIED") {
      return finalize(input, "RELEASE_BLOCKED", `post_commit_verification did not pass: status=${verification.status} reason_code=${verification.reason_code}`);
    }

    // Dependency staleness — real, live re-read, never cached.
    const staleDependencies: string[] = [];
    for (const dependency of input.declared_dependencies) {
      const current = findCapability({ capability_id: dependency.capability_id }, store);
      if (!current) {
        staleDependencies.push(`${dependency.capability_id}:NOT_FOUND`);
        continue;
      }
      if (!current.version.includes(dependency.declared_version)) {
        staleDependencies.push(`${dependency.capability_id}:declared=${dependency.declared_version}:current=${current.version.join(",")}`);
      }
    }
    if (staleDependencies.length > 0) {
      return finalize(input, "RELEASE_BLOCKED", `dependency state changed since build/test — never silently released with mismatched state`, staleDependencies);
    }

    // Required evidence — real files, never trusted by name alone.
    const missingEvidence = input.required_evidence_refs.filter((ref) => !fileExistsOnDisk(ref));
    if (missingEvidence.length > 0) {
      return finalize(input, "RELEASE_UNRESOLVED", `required evidence files missing: ${missingEvidence.join(", ")}`);
    }

    return finalize(input, "RELEASE_ELIGIBLE", "post_commit_verification VERIFIED, no stale dependencies, all required evidence present");
  } finally {
    releaseLock(lockKey, input.correlation_id);
  }
}
