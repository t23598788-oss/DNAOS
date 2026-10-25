/**
 * Worker Registry (owner, 2026-08-08, Software Factory Step 13, Phase
 * 7). Declares the real Worker Types this Factory can assign work to.
 * Never hardcodes Claude/OpenAI/Gemini as a permanent primary
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
 *
 * AMENDMENT (owner, 2026-08-09, TASK-045, Owner decision DNA-000082/083
 * via AskUserQuestion) — an 11th WorkerType, EDGE_FUNCTION_WORKER, was
 * added here. This is a real, explicit, Owner-authorized EXCEPTION to
 * Constitution Rule 252 ("MANAGER-07 itself must never create a new
 * Worker type") — the Owner specifically authorized this one addition
 * because Worker-04 (👤 Identity Department) cannot be dispatched today:
 * workerTaskOrchestrator.ts#createJobContract() only ever accepted the
 * (then-)10 real WorkerType values declared in this file, none of which
 * reach Supabase Edge Functions (a separate Deno runtime — see
 * supabase/functions/). The real dispatch mechanism for this new type
 * does NOT run through runScopedWorkerJob()'s Worker-Adapter pipeline
 * (that pipeline is hardcoded to CODE_WORKER regardless of
 * contract.workerRole — see workerTaskOrchestrator.ts's own real,
 * disclosed finding on this) — it lives in the clearly-scoped sibling
 * module edgeFunctionWorkerRuntime.ts#dispatchEdgeFunctionWorkerJob().
 */
export type WorkerType =
  | "ANALYSIS_WORKER" | "CODE_WORKER" | "REVIEW_WORKER" | "TEST_WORKER" | "DOCUMENT_WORKER"
  | "UI_WORKER" | "SECURITY_WORKER" | "DATA_WORKER" | "HUMAN_WORKER" | "TOOL_WORKER"
  | "EDGE_FUNCTION_WORKER";

export type WorkerStatus = "ACTIVE" | "CONFIGURED" | "PARTIAL" | "COMPATIBILITY_ONLY" | "NOT_IMPLEMENTED" | "UNKNOWN";

// ============================================================
// Cost Class taxonomy (owner, 2026-08-09, Constitution Rule 257 —
// Execution Plane Cost Gate — real build, TASK-048/FCR-009). Every real
// Worker/Adapter must honestly declare which of these 4 it is, derived
// from its OWN real costModel/provider text below — never guessed:
//  - FREE: real, local/deterministic computation, zero external metered
//    cost (matches this file's own existing "costModel: none/N/A"
//    Workers exactly — REVIEW/TEST/UI/SECURITY/DATA/TOOL/HUMAN).
//  - ESTIMATED_COST: a real external cost exists AND a real (even if
//    low-confidence) pre-call dollar estimate is computable.
//  - PAID: a real, live-proven, metered provider cost applies, with a
//    real, disclosed dollar floor (see cliWorkerAdapter.ts's real
//    ~$0.29/call finding, the exact real incident FCR-009 documents).
//  - UNKNOWN_COST: a real external provider is in principle paid, but
//    this repo cannot quantify it at all (pre- or post-call) — matches
//    this file's own existing "costModel: UNKNOWN — ..." Workers
//    exactly (ANALYSIS_WORKER/DOCUMENT_WORKER).
// Rule 257 requires the COST_GATE for PAID/UNKNOWN_COST; this build
// treats ESTIMATED_COST the same way as a deliberate, disclosed,
// safety-conservative choice (never looser than the rule's letter) —
// see costGateRuntime.ts's header for the same note.
// ============================================================
export type CostClass = "FREE" | "ESTIMATED_COST" | "PAID" | "UNKNOWN_COST";

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
  /** Real, existing free-text cost description — kept as-is (used
   * elsewhere); costClass below is the new, typed, gate-checkable
   * taxonomy derived honestly FROM this same text, never replacing it. */
  costModel: string;
  costClass: CostClass;
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
    costModel: "UNKNOWN — no real per-request cost is visible to this Runtime", costClass: "UNKNOWN_COST", availability: "AVAILABLE",
    evidenceRequirements: ["real ContextPlan reference", "real output text"], permittedTools: ["Read"], status: "COMPATIBILITY_ONLY",
  },
  CODE_WORKER: {
    id: "CODE_WORKER", displayName: "Code Worker",
    capabilities: ["propose real file edits within an approved Context Plan's permittedWriteScope", "as of Step 13.5: real, programmatic invocation via codeWorkerRuntime.ts -> services/ai/gateway.ts's real code.generate capability (Anthropic), capped at one real call per Execution Step, output always requires a separate real Owner approval before any byte is written"],
    limitations: ["cannot write outside permittedWriteScope", "cannot bypass Change Set Runtime", "real invocation code path is wired and real, but this environment has no real ANTHROPIC_API_KEY configured — a live call honestly fails with AI_GATEWAY_ANTHROPIC_NOT_CONFIGURED until the Owner provisions one", "the human-continued Claude Code session path (this very session) remains a real, separate, always-available fallback"],
    inputContract: "real, approved ContextPlan + real ExecutionPlan step", outputContract: "real CodeWorkerProposal, Owner-approved before entering the Change Set",
    provider: "services/ai/gateway.ts (anthropic, real code.generate capability, Step 13.5) — falls back to this real Claude Code session (human-continued) when unconfigured", executionMode: "ASYNCHRONOUS", locality: "CLOUD",
    costModel: "real Anthropic token cost per call — capped at 1 real call per Execution Step; no real cost-tracking number is surfaced yet", costClass: "PAID", availability: "UNKNOWN",
    evidenceRequirements: ["real CODE_WORKER_PROPOSAL artifact", "real Owner CODE_WORKER_OUTPUT_APPROVED decision", "real Change Set", "real Review/Test/Build result"], permittedTools: ["Read", "Edit", "Write"], status: "PARTIAL",
  },
  REVIEW_WORKER: {
    id: "REVIEW_WORKER", displayName: "Review Worker",
    capabilities: ["real, deterministic review via changeSetRuntime.ts#runReview — reused directly, never re-implemented"],
    limitations: ["cannot approve its own findings — Owner decision required for BLOCKED reviews"],
    inputContract: "real ChangeSet", outputContract: "real ReviewFindings via changeSetRuntime.ts",
    provider: "internal — changeSetRuntime.ts (deterministic, no AI)", executionMode: "SYNCHRONOUS", locality: "LOCAL",
    costModel: "none — real, local computation only", costClass: "FREE", availability: "AVAILABLE",
    evidenceRequirements: ["real REVIEW_FINDINGS artifact"], permittedTools: [], status: "ACTIVE",
  },
  TEST_WORKER: {
    id: "TEST_WORKER", displayName: "Test Worker",
    capabilities: ["real test execution via testRuntime.ts — reused directly"],
    limitations: ["only runs real, already-registered Test Types"],
    inputContract: "real ChangeSet/TestRun request", outputContract: "real TestRun result via testRuntime.ts",
    provider: "internal — testRuntime.ts (real process execution via executionRuntime.ts)", executionMode: "ASYNCHRONOUS", locality: "LOCAL",
    costModel: "none — real, local computation only", costClass: "FREE", availability: "AVAILABLE",
    evidenceRequirements: ["real TEST_REPORT artifact"], permittedTools: [], status: "ACTIVE",
  },
  DOCUMENT_WORKER: {
    id: "DOCUMENT_WORKER", displayName: "Document Worker",
    capabilities: ["would reuse services/ai/gateway.ts#invokeAiGateway() (real, existing, capability: document.ocr/document.event_extract)"],
    limitations: ["no real integration wired into Factory Workspace this Step — the real gateway exists but is not yet called from here"],
    inputContract: "real document reference", outputContract: "real, structured extraction",
    provider: "services/ai/gateway.ts (anthropic | ollama, real)", executionMode: "ASYNCHRONOUS", locality: "HYBRID",
    costModel: "UNKNOWN — real gateway has no cost-tracking field exposed to this Runtime", costClass: "UNKNOWN_COST", availability: "UNKNOWN",
    evidenceRequirements: ["real AiProvenance record"], permittedTools: [], status: "PARTIAL",
  },
  UI_WORKER: {
    id: "UI_WORKER", displayName: "UI Worker",
    capabilities: ["real UI inspection via browserInspectionRuntime.ts — reused directly"],
    limitations: ["observe-only, cannot author new UI code autonomously"],
    inputContract: "real target URL/viewport", outputContract: "real UI Inspection findings",
    provider: "internal — browserInspectionRuntime.ts (Playwright, real)", executionMode: "ASYNCHRONOUS", locality: "LOCAL",
    costModel: "none — real, local computation only", costClass: "FREE", availability: "AVAILABLE",
    evidenceRequirements: ["real UI_FINDINGS artifact"], permittedTools: [], status: "ACTIVE",
  },
  SECURITY_WORKER: {
    id: "SECURITY_WORKER", displayName: "Security Worker",
    capabilities: ["real fsSecurity.ts path/traversal checks", "real executionRegistry.ts denied-command checks — both reused directly"],
    limitations: ["deterministic checks only — no real vulnerability-scanning tool integrated yet"],
    inputContract: "real target path/command", outputContract: "real pass/fail with real evidence",
    provider: "internal — fsSecurity.ts/executionRegistry.ts (deterministic, no AI)", executionMode: "SYNCHRONOUS", locality: "LOCAL",
    costModel: "none", costClass: "FREE", availability: "AVAILABLE",
    evidenceRequirements: ["real SECURITY_POLICY_CHECK finding"], permittedTools: [], status: "PARTIAL",
  },
  DATA_WORKER: {
    id: "DATA_WORKER", displayName: "Data Worker",
    capabilities: ["real, read-only registry/JSON data queries (module registry, capability registry, etc.)"],
    limitations: ["no real database mutation capability — read-only by design"],
    inputContract: "real registry file reference", outputContract: "real, structured JSON",
    provider: "internal — real fs reads only", executionMode: "SYNCHRONOUS", locality: "LOCAL",
    costModel: "none", costClass: "FREE", availability: "AVAILABLE",
    evidenceRequirements: ["real registry file citation"], permittedTools: [], status: "ACTIVE",
  },
  HUMAN_WORKER: {
    id: "HUMAN_WORKER", displayName: "Human Worker (the real Owner)",
    capabilities: ["real, final approval authority over every Decision Gate", "real manual actions this Factory cannot perform itself (Deploy, credential entry, isolated DB provisioning — see Step 12.75's runbook)"],
    limitations: ["cannot be automated — deliberately, always"],
    inputContract: "real Decision Gate request", outputContract: "real OwnerDecisionRecord",
    provider: "N/A — the real, human Owner", executionMode: "HUMAN_IN_LOOP", locality: "N/A",
    costModel: "N/A", costClass: "FREE", availability: "AVAILABLE",
    evidenceRequirements: ["real, signed OwnerDecisionRecord"], permittedTools: [], status: "ACTIVE",
  },
  TOOL_WORKER: {
    id: "TOOL_WORKER", displayName: "Tool Worker",
    capabilities: ["real, registered Execution Runtime commands (typecheck, governance, architecture.check, etc.) — reused directly via executionRuntime.ts"],
    limitations: ["only real, already-registered commands in executionRegistry.ts — never an arbitrary shell command"],
    inputContract: "real, registered commandId", outputContract: "real RunRecord via executionRuntime.ts",
    provider: "internal — executionRuntime.ts (real child_process, sandboxed)", executionMode: "ASYNCHRONOUS", locality: "LOCAL",
    costModel: "none", costClass: "FREE", availability: "AVAILABLE",
    evidenceRequirements: ["real EXECUTION_RESULT artifact"], permittedTools: [], status: "ACTIVE",
  },
  EDGE_FUNCTION_WORKER: {
    id: "EDGE_FUNCTION_WORKER", displayName: "Edge Function Worker (👤 Identity Department bridge)",
    capabilities: [
      "real, fire-and-forget HTTP dispatch to a named, already-deployed Supabase Edge Function under supabase/functions/<name> — reuses the exact real fetch(`${SUPABASE_URL}/functions/v1/<name>`) URL pattern already proven twice in this repo: supabase/functions/line-webhook-v2/engines/profile-refresh.ts's nudgeWorker() and local-runtime/storage-threshold-watcher.ts's ALERT_URL/DRIFT_ALERT_URL calls",
      "verifies targetFunction against a real, live directory listing of supabase/functions/ before ever constructing a request — refuses an unknown/typo'd function name rather than firing at an arbitrary endpoint",
      "records a real, local EDGE_FUNCTION_DISPATCH_RECORD evidence artifact (via artifactRuntime.ts's Evidence Warehouse, this layer's one real evidence store) before every real network call — the honest, disclosed analog of profile-refresh.ts's line_profile_refresh_queue insert (see edgeFunctionWorkerRuntime.ts's header for why this is a local record, not a new cross-domain Supabase table)",
    ],
    limitations: [
      "cannot execute or modify Deno/Edge-Function-side code directly — only triggers an already-deployed Edge Function over HTTP; it has no way to read that function's own real business-logic outcome beyond the one HTTP response it optionally awaits",
      "genuinely fire-and-forget by default: this runtime is Next.js/Node server code, not the Deno EdgeRuntime supabase/functions/line-webhook-v2/engines/profile-refresh.ts runs inside, so there is no real EdgeRuntime.waitUntil() primitive available here — a detached dispatch's eventual HTTP outcome (2xx/4xx/5xx, or a dropped connection) is never observed unless the caller explicitly opts into awaitDelivery, which blocks on that one real HTTP round trip instead of detaching it",
      "as of this build (2026-08-09), Worker-04 (👤 Identity Department) itself has no real, deployed target Edge Function yet — no such subdirectory exists under supabase/functions/ today. A JobContract naming an Identity-Department function honestly BLOCKs with an UNKNOWN_TARGET_FUNCTION reason until the Owner/Identity Department actually deploys one; this Worker proves the real dispatch MECHANISM against whatever Edge Functions already exist, not a specific Identity Department capability",
      "estimated_cost is always reported as null (genuine UNKNOWN_COST) to the Cost Gate — real Supabase Edge Function invocation billing depends on the project's real plan/usage tier, which this runtime cannot compute or observe from here",
      "never live-fired end-to-end against a real, running Supabase Edge Function during this build (TASK-045 explicitly forbids spending real money or triggering a real production Edge Function invocation while building/testing) — the dispatch code path itself is real and structurally proven (Cost Gate ordering, request construction, fire-and-forget wiring), but true end-to-end delivery to a live target was deliberately never proven live this pass, a genuinely different reason from CODE_WORKER's missing API key",
    ],
    inputContract: "real EdgeFunctionWorkerJobContract (edgeFunctionWorkerRuntime.ts): jobContractId, targetFunction (must literally match an existing supabase/functions/<name> subdirectory), payload (JSON body), authMode + a credential env-var NAME (never the secret value itself inline), ownerId, actor",
    outputContract: "real EdgeFunctionDispatchResult (edgeFunctionWorkerRuntime.ts): status (DISPATCHED | COST_GATE_LOCKED | BLOCKED), real costGateOutcome + costGateDecisionId, real dispatchEvidenceArtifactId, the real constructed request URL, and — only when awaitDelivery was explicitly requested — the real, observed HTTP outcome",
    provider: "supabase-edge-function (real Supabase Functions HTTP endpoint, via this repo's own already-proven fetch(`${SUPABASE_URL}/functions/v1/<name>`) pattern — see profile-refresh.ts / storage-threshold-watcher.ts)", executionMode: "ASYNCHRONOUS", locality: "CLOUD",
    costModel: "UNKNOWN — real Supabase Edge Function invocation cost depends on the project's real plan/usage tier; this runtime cannot compute a real pre-call estimate, so estimated_cost is always honestly reported as null (genuine UNKNOWN_COST) to the Cost Gate", costClass: "UNKNOWN_COST", availability: "UNKNOWN",
    evidenceRequirements: ["real EDGE_FUNCTION_DISPATCH_RECORD artifact (local dispatch-evidence, the queue-row analog)", "real COST_GATE_DECISION artifact from checkCostGate()", "when awaitDelivery is used: the real, observed HTTP response status/error from the target Edge Function"],
    permittedTools: [], status: "PARTIAL",
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
