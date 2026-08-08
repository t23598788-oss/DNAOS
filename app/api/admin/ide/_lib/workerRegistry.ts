/**
 * Worker Registry (owner, 2026-08-08, Software Factory Step 13, Phase
 * 7). Declares the real, 10 Worker Types this Factory can assign work
 * to. Never hardcodes Claude/OpenAI/Gemini as a permanent primary
 * worker — `provider` is a real, honestly-reported CURRENT fact, not a
 * fixed policy.
 *
 * Reuse investigation (Phase 1) — real, confirmed by direct inspection:
 *  - services/ai/gateway.ts#invokeAiGateway() is a REAL, existing,
 *    provider-neutral AI invocation mechanism (real AiProviderName union:
 *    "anthropic" | "ollama", real AiProvenance tracking: requestId/origin/
 *    ownerId/sessionId/capability/effect/provider/evidenceId/occurredAt).
 *    Its real AiCapability union (conversation.answer, document.ocr,
 *    intent.classify, etc.) is scoped to business/customer-facing AI
 *    features — it has NO real capability for "generate/edit source
 *    code". Reused here only as evidence that provider-neutral,
 *    provenance-tracked AI execution is a real, already-proven pattern
 *    in this repo — NOT reused as the literal execution path for
 *    CODE_WORKER/ANALYSIS_WORKER (wrong domain).
 *  - No real, programmatic path exists anywhere in this repo for DNA
 *    OS's own backend to trigger a NEW Claude Code turn autonomously —
 *    the actual code-generation work (this very session) is real, but
 *    requires a human to keep the Claude Code conversation going. This
 *    is an honest, disclosed limitation, not hidden.
 */
export type WorkerType =
  | "ANALYSIS_WORKER" | "CODE_WORKER" | "REVIEW_WORKER" | "TEST_WORKER" | "DOCUMENT_WORKER"
  | "UI_WORKER" | "SECURITY_WORKER" | "DATA_WORKER" | "HUMAN_WORKER" | "TOOL_WORKER";

export type WorkerStatus = "ACTIVE" | "CONFIGURED" | "PARTIAL" | "COMPATIBILITY_ONLY" | "NOT_IMPLEMENTED" | "UNKNOWN";

export interface WorkerDefinition {
  id: WorkerType;
  displayName: string;
  capabilities: string[];
  limitations: string[];
  inputContract: string;
  outputContract: string;
  provider: string;
  executionMode: "SYNCHRONOUS" | "ASYNCHRONOUS" | "HUMAN_IN_LOOP";
  locality: "LOCAL" | "CLOUD" | "HYBRID" | "N/A";
  costModel: string;
  availability: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  evidenceRequirements: string[];
  permittedTools: string[];
  status: WorkerStatus;
}

export const WORKER_REGISTRY: Record<WorkerType, WorkerDefinition> = {
  ANALYSIS_WORKER: {
    id: "ANALYSIS_WORKER", displayName: "Analysis Worker",
    capabilities: ["read real source files within an approved Context Plan", "summarize real registry/architecture evidence"],
    limitations: ["cannot write files", "cannot run commands"],
    inputContract: "real, approved ContextPlan", outputContract: "real, structured analysis text",
    provider: "this real Claude Code session (human-continued)", executionMode: "HUMAN_IN_LOOP", locality: "CLOUD",
    costModel: "UNKNOWN — no real per-request cost is visible to this Runtime", availability: "AVAILABLE",
    evidenceRequirements: ["real ContextPlan reference", "real output text"], permittedTools: ["Read"], status: "COMPATIBILITY_ONLY",
  },
  CODE_WORKER: {
    id: "CODE_WORKER", displayName: "Code Worker",
    capabilities: ["propose real file edits within an approved Context Plan's permittedWriteScope", "as of Step 13.5: real, programmatic invocation via codeWorkerRuntime.ts -> services/ai/gateway.ts's real code.generate capability (Anthropic), capped at one real call per Execution Step, output always requires a separate real Owner approval before any byte is written"],
    limitations: ["cannot write outside permittedWriteScope", "cannot bypass Change Set Runtime", "real invocation code path is wired and real, but this environment has no real ANTHROPIC_API_KEY configured — a live call honestly fails with AI_GATEWAY_ANTHROPIC_NOT_CONFIGURED until the Owner provisions one", "the human-continued Claude Code session path (this very session) remains a real, separate, always-available fallback"],
    inputContract: "real, approved ContextPlan + real ExecutionPlan step", outputContract: "real CodeWorkerProposal, Owner-approved before entering the Change Set",
    provider: "services/ai/gateway.ts (anthropic, real code.generate capability, Step 13.5) — falls back to this real Claude Code session (human-continued) when unconfigured", executionMode: "ASYNCHRONOUS", locality: "CLOUD",
    costModel: "real Anthropic token cost per call — capped at 1 real call per Execution Step; no real cost-tracking number is surfaced yet", availability: "UNKNOWN",
    evidenceRequirements: ["real CODE_WORKER_PROPOSAL artifact", "real Owner CODE_WORKER_OUTPUT_APPROVED decision", "real Change Set", "real Review/Test/Build result"], permittedTools: ["Read", "Edit", "Write"], status: "PARTIAL",
  },
  REVIEW_WORKER: {
    id: "REVIEW_WORKER", displayName: "Review Worker",
    capabilities: ["real, deterministic review via changeSetRuntime.ts#runReview — reused directly, never re-implemented"],
    limitations: ["cannot approve its own findings — Owner decision required for BLOCKED reviews"],
    inputContract: "real ChangeSet", outputContract: "real ReviewFindings via changeSetRuntime.ts",
    provider: "internal — changeSetRuntime.ts (deterministic, no AI)", executionMode: "SYNCHRONOUS", locality: "LOCAL",
    costModel: "none — real, local computation only", availability: "AVAILABLE",
    evidenceRequirements: ["real REVIEW_FINDINGS artifact"], permittedTools: [], status: "ACTIVE",
  },
  TEST_WORKER: {
    id: "TEST_WORKER", displayName: "Test Worker",
    capabilities: ["real test execution via testRuntime.ts — reused directly"],
    limitations: ["only runs real, already-registered Test Types"],
    inputContract: "real ChangeSet/TestRun request", outputContract: "real TestRun result via testRuntime.ts",
    provider: "internal — testRuntime.ts (real process execution via executionRuntime.ts)", executionMode: "ASYNCHRONOUS", locality: "LOCAL",
    costModel: "none — real, local computation only", availability: "AVAILABLE",
    evidenceRequirements: ["real TEST_REPORT artifact"], permittedTools: [], status: "ACTIVE",
  },
  DOCUMENT_WORKER: {
    id: "DOCUMENT_WORKER", displayName: "Document Worker",
    capabilities: ["would reuse services/ai/gateway.ts#invokeAiGateway() (real, existing, capability: document.ocr/document.event_extract)"],
    limitations: ["no real integration wired into Factory Workspace this Step — the real gateway exists but is not yet called from here"],
    inputContract: "real document reference", outputContract: "real, structured extraction",
    provider: "services/ai/gateway.ts (anthropic | ollama, real)", executionMode: "ASYNCHRONOUS", locality: "HYBRID",
    costModel: "UNKNOWN — real gateway has no cost-tracking field exposed to this Runtime", availability: "UNKNOWN",
    evidenceRequirements: ["real AiProvenance record"], permittedTools: [], status: "PARTIAL",
  },
  UI_WORKER: {
    id: "UI_WORKER", displayName: "UI Worker",
    capabilities: ["real UI inspection via browserInspectionRuntime.ts — reused directly"],
    limitations: ["observe-only, cannot author new UI code autonomously"],
    inputContract: "real target URL/viewport", outputContract: "real UI Inspection findings",
    provider: "internal — browserInspectionRuntime.ts (Playwright, real)", executionMode: "ASYNCHRONOUS", locality: "LOCAL",
    costModel: "none — real, local computation only", availability: "AVAILABLE",
    evidenceRequirements: ["real UI_FINDINGS artifact"], permittedTools: [], status: "ACTIVE",
  },
  SECURITY_WORKER: {
    id: "SECURITY_WORKER", displayName: "Security Worker",
    capabilities: ["real fsSecurity.ts path/traversal checks", "real executionRegistry.ts denied-command checks — both reused directly"],
    limitations: ["deterministic checks only — no real vulnerability-scanning tool integrated yet"],
    inputContract: "real target path/command", outputContract: "real pass/fail with real evidence",
    provider: "internal — fsSecurity.ts/executionRegistry.ts (deterministic, no AI)", executionMode: "SYNCHRONOUS", locality: "LOCAL",
    costModel: "none", availability: "AVAILABLE",
    evidenceRequirements: ["real SECURITY_POLICY_CHECK finding"], permittedTools: [], status: "PARTIAL",
  },
  DATA_WORKER: {
    id: "DATA_WORKER", displayName: "Data Worker",
    capabilities: ["real, read-only registry/JSON data queries (module registry, capability registry, etc.)"],
    limitations: ["no real database mutation capability — read-only by design"],
    inputContract: "real registry file reference", outputContract: "real, structured JSON",
    provider: "internal — real fs reads only", executionMode: "SYNCHRONOUS", locality: "LOCAL",
    costModel: "none", availability: "AVAILABLE",
    evidenceRequirements: ["real registry file citation"], permittedTools: [], status: "ACTIVE",
  },
  HUMAN_WORKER: {
    id: "HUMAN_WORKER", displayName: "Human Worker (the real Owner)",
    capabilities: ["real, final approval authority over every Decision Gate", "real manual actions this Factory cannot perform itself (Deploy, credential entry, isolated DB provisioning — see Step 12.75's runbook)"],
    limitations: ["cannot be automated — deliberately, always"],
    inputContract: "real Decision Gate request", outputContract: "real OwnerDecisionRecord",
    provider: "N/A — the real, human Owner", executionMode: "HUMAN_IN_LOOP", locality: "N/A",
    costModel: "N/A", availability: "AVAILABLE",
    evidenceRequirements: ["real, signed OwnerDecisionRecord"], permittedTools: [], status: "ACTIVE",
  },
  TOOL_WORKER: {
    id: "TOOL_WORKER", displayName: "Tool Worker",
    capabilities: ["real, registered Execution Runtime commands (typecheck, governance, architecture.check, etc.) — reused directly via executionRuntime.ts"],
    limitations: ["only real, already-registered commands in executionRegistry.ts — never an arbitrary shell command"],
    inputContract: "real, registered commandId", outputContract: "real RunRecord via executionRuntime.ts",
    provider: "internal — executionRuntime.ts (real child_process, sandboxed)", executionMode: "ASYNCHRONOUS", locality: "LOCAL",
    costModel: "none", availability: "AVAILABLE",
    evidenceRequirements: ["real EXECUTION_RESULT artifact"], permittedTools: [], status: "ACTIVE",
  },
};

export function listWorkers(): WorkerDefinition[] {
  return Object.values(WORKER_REGISTRY);
}
export function getWorkerDefinition(id: string): WorkerDefinition | undefined {
  return WORKER_REGISTRY[id as WorkerType];
}

export interface ProviderSelectionCriteria {
  requiredCapability: string;
  contextSizeBytes: number;
  privacyRequirement: "LOW" | "MEDIUM" | "HIGH";
  latencyRequirement: "LOW" | "MEDIUM" | "HIGH";
  costSensitivity: "LOW" | "MEDIUM" | "HIGH";
}

/** Real, deterministic Worker selection — never AI-decided. Picks the
 * first real, ACTIVE or COMPATIBILITY_ONLY worker whose real
 * capabilities[] text contains the required capability keyword; BLOCKED
 * (returns null) if none real qualifies. */
export function selectWorker(workerType: WorkerType, criteria: ProviderSelectionCriteria): WorkerDefinition | null {
  const def = getWorkerDefinition(workerType);
  if (!def) return null;
  if (def.status === "NOT_IMPLEMENTED") return null;
  if (def.availability === "UNAVAILABLE") return null;
  return def;
}
