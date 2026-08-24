/**
 * หน้าที่: type contracts for Runtime Verification — the final stage
 * before COMPLETE. Proves a real, fresh probe of the capability's actual
 * running behavior exists, never a stale or fabricated evidence file.
 * Deliberately never invokes the capability itself here (no generic
 * "run arbitrary code" primitive exists — `../../execution/run/` is
 * Owner hard-blocked from any `control/` import, see its own
 * `contract.ts` header) — the caller who knows this specific
 * capability's shape performs the real probe and cites the resulting
 * evidence file; this stage's only job is verifying that citation is
 * real and recent, not caller-trusted.
 *
 * Input: none (pure type definitions).
 * Output: `RuntimeVerificationStatus`, `RuntimeVerificationInput`,
 * `RuntimeVerificationResult`.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that lets RUNTIME_VERIFIED be set
 * without an independently-checked, freshly-modified evidence file.
 */

export type RuntimeVerificationStatus = "RUNTIME_VERIFIED" | "RUNTIME_VERIFY_FAILED" | "UNRESOLVED";

export interface RuntimeVerificationInput {
  capability_id: string;
  /** ISO timestamp of the Deploy/Install stage's own completion — the evidence file must be modified at or after this instant to prove it is a fresh, post-install probe, not stale/reused evidence. */
  deploy_install_completed_at: string;
  /** A real file recording the outcome of an actual runtime probe of this capability (e.g. an audit log entry, a live invocation's captured output). */
  runtime_evidence_ref: string;
  correlation_id: string;
}

export interface RuntimeVerificationResult {
  capability_id: string;
  status: RuntimeVerificationStatus;
  reason: string;
  evidence_ref: string;
  verified_at: string;
  correlation_id: string;
}
