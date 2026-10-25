/**
 * Universal Worker Contract (owner, 2026-08-08, Software Factory Step
 * 13.6, Section 2). The ONE real, provider-neutral request/response
 * shape every Worker Adapter (API/CLI/MCP/Local/Remote/Human) must
 * speak. Core Runtime code (factoryWorkspaceRuntime.ts,
 * workerSelectorRuntime.ts, executionBudgetRuntime.ts) imports ONLY
 * this file's types — never a provider-specific shape, never
 * Anthropic/OpenAI/Gemini/Claude-Code/Codex types directly (Section 0).
 */
export type WorkerAdapterType = "API" | "CLI" | "MCP" | "LOCAL_RUNTIME" | "REMOTE_RUNTIME" | "HUMAN";

export type WorkerResponseStatus = "SUCCEEDED" | "PARTIAL" | "BLOCKED" | "TIMEOUT" | "FAILED" | "NOT_CONFIGURED" | "NOT_SUPPORTED" | "UNKNOWN";

export type PrivacyLevel = "LOCAL_ONLY" | "CLOUD_ALLOWED";
export type NetworkPolicy = "NO_NETWORK" | "OUTBOUND_ALLOWED";
export type ApprovalPolicy = "OWNER_APPROVAL_REQUIRED" | "AUTO_LOW_RISK";

export interface WorkerRequest {
  workerRequestId: string;
  workspaceSessionId: string;
  executionPlanId: string | null;
  stepId: string;
  workerType: string;
  capabilityRequired: string;
  contextPackageId: string | null;
  contextFingerprint: string | null;
  permittedReadScope: string[];
  permittedWriteScope: string[];
  permittedTools: string[];
  forbiddenTools: string[];
  expectedOutputSchema: string;
  timeoutMs: number;
  maxCalls: number;
  maxTokens: number;
  maxCost: number | null;
  privacyLevel: PrivacyLevel;
  networkPolicy: NetworkPolicy;
  approvalPolicy: ApprovalPolicy;
  actor: string;
  createdAt: string;
  // Real, provider-neutral payload — the adapter decides how to render
  // this into its own real call shape (prompt/messages/argv/tool-call).
  taskDescription: string;
  acceptanceCriteria: string[];
  fileContents: { path: string; content: string }[];
}

export interface WorkerToolCall {
  tool: string;
  argsSummary: string;
  ok: boolean;
}

export interface WorkerResponse {
  workerRequestId: string;
  workerId: string;
  adapterId: string;
  provider: string;
  model: string | null;
  status: WorkerResponseStatus;
  output: string | null;
  /** Real, optional plain-text answer for a read-only/informational task
   * that needs no file change (e.g. "what's the project name?") — null
   * for every adapter/response that doesn't produce one. Optional so
   * existing adapters that never set it need no change. */
  answer?: string | null;
  proposedChanges: { path: string; operation: "CREATE" | "MODIFY" | "DELETE" | "RENAME"; content: string | null; purpose: string; risk: string }[];
  toolCalls: WorkerToolCall[];
  tokenUsage: { input: number | null; output: number | null };
  cost: { amount: number | null; currency: string | null; kind: "ACTUAL" | "ESTIMATED" | "UNKNOWN" };
  durationMs: number;
  evidence: string[];
  limitations: string[];
  error: string | null;
  finishedAt: string;
}
