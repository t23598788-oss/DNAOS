/**
 * หน้าที่: the public boundary of `control/incident-remediation/`.
 *
 * Input: re-exports only.
 * Output: the loop entry points + persistence + every type.
 * Dependency ที่อนุญาต: ./remediation.ts, ./persistence.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never export a function that sets a terminal state
 * directly — terminal states are derived inside ./remediation.ts from real
 * evidence, never assigned by a caller.
 */

export { normalizeIncidentSource, asIncidentSource, NOT_APPLICABLE } from "./incident-source";
export type { IncidentSource, ExecutionFailureReport, ExecutionFailureType, NormalizedIncident } from "./incident-source";
export { openRemediation, selectExecutionResource, dispatchRemediation, failoverExecutionResource, observeRemediation, verifyOriginalFault } from "./remediation";
export type { ResourceSelection } from "./remediation";
export { saveRemediation, loadRemediation, loadRemediationByWorkId } from "./persistence";
export { snapshotScope, diffScope, recordObservedChanges, observationsForWork, observationsForExecution, classifyChange } from "./observed-changes";
export type { ChangeClassification, ClassifiedChange } from "./observed-changes";
export { buildEscalationPayload, escalateToOwner, loadDeliveries, retryEscalation, acknowledgeEscalation, MAX_DELIVERY_ATTEMPTS } from "./owner-escalation";
export type { DeliveryRecord, DeliveryState, OwnerEscalationPayload } from "./owner-escalation";
export type {
  ExecutionAttempt,
  ObservedWriteEvidence,
  OriginalFaultCheck,
  RemediationBlockReason,
  RemediationRecord,
  RemediationTerminalState,
} from "./types";
