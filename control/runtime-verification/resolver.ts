/**
 * หน้าที่: `verifyRuntime()` — the one real entry point for Runtime
 * Verification. Reads the real filesystem mtime of `runtime_evidence_ref`
 * and requires it to be at or after `deploy_install_completed_at` —
 * proof the probe happened after install, not stale/reused evidence from
 * an unrelated prior run.
 *
 * Input: `RuntimeVerificationInput`.
 * Output: `verifyRuntime` -> `RuntimeVerificationResult`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never mark RUNTIME_VERIFIED when the evidence file is
 * missing or older than deploy_install_completed_at.
 */

import { nowIso, statOrNull } from "./host-runtime";
import type { RuntimeVerificationInput, RuntimeVerificationResult } from "./types";

export function verifyRuntime(input: RuntimeVerificationInput): RuntimeVerificationResult {
  const verified_at = nowIso();
  const stat = statOrNull(input.runtime_evidence_ref);

  if (!stat) {
    return { capability_id: input.capability_id, status: "UNRESOLVED", reason: `runtime_evidence_ref ${input.runtime_evidence_ref} does not exist on disk`, evidence_ref: input.runtime_evidence_ref, verified_at, correlation_id: input.correlation_id };
  }

  const installedAtMs = Date.parse(input.deploy_install_completed_at);
  if (Number.isNaN(installedAtMs)) {
    return { capability_id: input.capability_id, status: "UNRESOLVED", reason: "deploy_install_completed_at is not a valid ISO timestamp", evidence_ref: input.runtime_evidence_ref, verified_at, correlation_id: input.correlation_id };
  }

  if (stat.mtimeMs < installedAtMs) {
    return { capability_id: input.capability_id, status: "RUNTIME_VERIFY_FAILED", reason: "evidence file is older than deploy/install completion — stale evidence, not a fresh runtime probe", evidence_ref: input.runtime_evidence_ref, verified_at, correlation_id: input.correlation_id };
  }

  return { capability_id: input.capability_id, status: "RUNTIME_VERIFIED", reason: "evidence file exists and was modified at or after deploy/install completion — a fresh real runtime probe", evidence_ref: input.runtime_evidence_ref, verified_at, correlation_id: input.correlation_id };
}
