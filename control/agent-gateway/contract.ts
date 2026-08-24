/**
 * หน้าที่: the public boundary of `control/agent-gateway/`.
 * Input: re-exports only.
 * Output: submitTask, admitCompletedTask, getTask, getResult, explain, ownerDecision, listCapabilities, adapters.
 * Dependency ที่อนุญาต: ./gateway.ts, ./types.ts, ./adapters/*.
 * สิ่งที่ห้ามแตะ: never re-export ./host-runtime.ts or ./memory-store.ts internals directly.
 */
export { submitTask, getTask, getResult, explain, ownerDecision, listCapabilities, admitCompletedTask } from "./gateway";
export { dispatchTask, startTaskController } from "./controller";
export { recordHandoff, validateHandoff, confirmDnaOsDecision, computeNextDecisionFromEvidence } from "./handoff";
export { loadAllHandoffs, loadHandoffsForTask, loadEvidenceForTask, saveEvidence, saveTask } from "./memory-store";
export type { HandoffAdmission, HandoffInput, NextDecision } from "./handoff";
export type { AgentAdapter, AgentRunSpec, Artifact, Capability, Context, DnaOsDecision, Evidence, ExecutionRequest, ExecutionResult, HandoffRecord, HandoffStatus, MemoryReference, Status, Task, TaskOutputLane, WorkOrder } from "./types";
export { fileIntelligenceAdapter } from "./adapters/file-intelligence-adapter";
export { externalProviderAdapter } from "./adapters/external-provider-adapter";
export { aiWriteAdapter } from "./adapters/ai-write-adapter";
export { DEFAULT_AGENT_WORKERS } from "./workers";
export { recoverInterruptedTasks } from "./gateway";
export { runVoiceAnnouncementSweep, setVoiceBridgeEnabled, isVoiceBridgeEnabled } from "./voice-bridge";
export type { VoiceSweepResult } from "./voice-bridge";
export { startAgentGatewaySupervisor } from "./supervisor";
export { dispatchToAgentHost, runAgentWorkOrder } from "./agent-host-dispatch";
export type { AgentHostDispatchRequest, AgentHostDispatchResult } from "./agent-host-dispatch";
export type { WorkerKind } from "../agent-host/contract";
export { MACHINE_CONTRACT_VERSION, MACHINE_INPUT_CONTRACT_VERSION, ERROR_CODES, REQUESTED_ACTION_OPERATIONS } from "./agent-execution-contract";
export type { DnaOsAgentResult, DnaOsAgentInput, RuntimeEvidence, RequestedAction, RequestedActionOperation, MachineError, VerificationResult, Severity, AgentResultStatus } from "./agent-execution-contract";
export { runCorrectiveLoop } from "./agent-execution-loop";
export type { CorrectiveLoopOutcome, CorrectiveLoopState } from "./agent-execution-loop";
export { routeRequestedAction, EXECUTOR_REGISTRY } from "./agent-authority-router";
export type { AuthorityRouterOutcome } from "./agent-authority-router";
export { createTaskWorkspace, transitionWorkspace, assignAgent, getWorkspace } from "./workspace-manager";
export type { TaskWorkspace, WorkspaceState, CreateTaskWorkspaceInput, TransitionOutcome } from "./workspace-manager";
export {
  CAPABILITY_CANDIDATE_CONTRACT_VERSION,
  freezeWorkspaceResult, getLatestRevision, inspectArtifacts, verifyBuild, verifyTest,
  verifySecurity, verifyContract, registerCandidate, decidePromotion,
  runCapabilityPromotionPipeline, buildCorrectionRequest, traceLineage,
} from "./capability-promotion";
export type {
  CapabilityType, ArtifactManifestEntry, CapabilityCandidateV1, DeclaredCapability,
  ArtifactInspectionResult, VerificationOutcome, BuildOrTestVerificationResult,
  SecurityVerificationResult, ContractVerificationResult, DuplicateGateStatus,
  RegistrationOutcome, PromotionDecisionType, PromotionDecision,
  CapabilityPromotionPipelineResult, CorrectionRequest, CapabilityLineage,
} from "./capability-promotion";
export { isFrozenRevision } from "./capability-promotion";
export {
  VERIFICATION_REQUEST_CONTRACT_VERSION, VERIFICATION_RESULT_CONTRACT_VERSION,
  buildVerificationRequest, computeManifestHash, runCandidateVerification,
  runCapabilityPromotionPipelineWithVerification,
} from "./candidate-verification-runtime";
export type {
  VerificationType, CandidateVerificationRequest, CandidateVerificationStatus,
  CandidateVerificationResult, VerificationOptions,
} from "./candidate-verification-runtime";
