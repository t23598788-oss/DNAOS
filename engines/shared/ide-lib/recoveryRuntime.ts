/** Compatibility exports for the existing single recovery-plan store and verifier. */
export { RecoveryError, listRecoveryEvents, createRecoveryPlan, approveRecoveryPlan, markExternallyExecuted, getRecoveryPlan, listRecoveryPlans, __debugRecoveryPlanCount } from "./recoveryPlans";
export type { ApprovalStatus, ExecutionStatus, VerificationStatus, RecoveryPrerequisite, RecoveryVerificationCheck, RecoveryVerificationResult, RecoveryPlan, RecoveryEvent } from "./recoveryPlans";
export { verifyRecovery } from "./recoveryVerification";
