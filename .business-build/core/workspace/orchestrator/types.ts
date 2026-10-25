import type { ExecutionPlan } from "../planner";

export type ExecutionStatus =
  | "Created"
  | "Queued"
  | "Preparing"
  | "Running"
  | "Waiting"
  | "Completed"
  | "Cancelled"
  | "Failed";

export interface ExecutionProgress {
  capabilityProgress: Record<string, number>;
  stageProgress: Record<number, number>;
  overallProgress: number;
}

export interface ExecutionRetryPolicy {
  maxAttempts: number;
  attemptsByCapability: Record<string, number>;
  retryableCapabilities: string[];
}

export interface ExecutionSessionMetadata {
  applicationId: string;
  workspaceId: string;
  generatedAt: string;
  registryVersion: string;
  registryChecksum: string;
  retryPolicy: ExecutionRetryPolicy;
}

export interface ExecutionSession {
  executionId: string;
  status: ExecutionStatus;
  currentStage: number | null;
  completedCapabilities: string[];
  runningCapabilities: string[];
  failedCapabilities: string[];
  pendingCapabilities: string[];
  startedAt: string | null;
  finishedAt: string | null;
  progress: ExecutionProgress;
  metadata: ExecutionSessionMetadata;
}

export interface ScheduledStage {
  stageIndex: number;
  capabilityIds: string[];
}

export interface ExecutionSchedule {
  executionId: string;
  stages: ScheduledStage[];
  pendingCapabilities: string[];
}

export type ExecutionLifecycleIssueType =
  | "InvalidTransition"
  | "DuplicateExecution"
  | "MissingStage"
  | "InvalidCompletion";

export interface ExecutionLifecycleIssue {
  type: ExecutionLifecycleIssueType;
  message: string;
  executionId?: string;
  stageIndex?: number;
  capabilityId?: string;
}

export interface ExecutionLifecycleValidationResult {
  valid: boolean;
  issues: ExecutionLifecycleIssue[];
}

export interface OrchestratorStartOptions {
  now?: string;
}

export interface RuntimeOrchestrator {
  createSession(plan: ExecutionPlan, options?: OrchestratorStartOptions): ExecutionSession;
  queue(session: ExecutionSession, options?: OrchestratorStartOptions): ExecutionSession;
  prepare(session: ExecutionSession, options?: OrchestratorStartOptions): ExecutionSession;
  startStage(session: ExecutionSession, plan: ExecutionPlan, stageIndex: number, options?: OrchestratorStartOptions): ExecutionSession;
  completeCapability(session: ExecutionSession, plan: ExecutionPlan, capabilityId: string, options?: OrchestratorStartOptions): ExecutionSession;
  failCapability(session: ExecutionSession, capabilityId: string, options?: OrchestratorStartOptions): ExecutionSession;
  wait(session: ExecutionSession, options?: OrchestratorStartOptions): ExecutionSession;
  retryCapability(session: ExecutionSession, capabilityId: string, options?: OrchestratorStartOptions): ExecutionSession;
  complete(session: ExecutionSession, options?: OrchestratorStartOptions): ExecutionSession;
  cancel(session: ExecutionSession, options?: OrchestratorStartOptions): ExecutionSession;
  schedule(plan: ExecutionPlan): ExecutionSchedule;
  validateTransition(from: ExecutionStatus, to: ExecutionStatus): ExecutionLifecycleValidationResult;
  validate(session: ExecutionSession, plan: ExecutionPlan): ExecutionLifecycleValidationResult;
}
