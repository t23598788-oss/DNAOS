/**
 * หน้าที่: public boundary of `control/agent-physical-scope/`.
 *
 * Reuses existing assignment (source-workspace reservations), repository
 * registry, runtime-control SERVICES, agent-host sandbox, MCP mutation
 * tool lists, and github-publish-authority as the only push path.
 * This folder does not replace those authorities.
 */

export { AGENT_PHYSICAL_SCOPE_ENFORCEMENT, AGENT_EXECUTION_ID_ENV, AGENT_TASK_ID_ENV, AGENT_SCOPE_STORE_ENV } from "./types";
export type {
  AgentActionClass,
  CanonicalAgentScope,
  PhysicalMutationAudit,
  PhysicalScopeRegistry,
  ScopeDecision,
  ScopeDenialReason,
  ScopeResolutionInput,
} from "./types";

export { resolveCanonicalTaskScope, requireResolvedScope, interpretAgentPath } from "./task-scope";
export { guardReadPath, guardWritePath } from "./path-guard";
export {
  defaultProtectedRuntimes,
  guardRuntimeMutation,
  guardPortMutation,
  guardKillByPid,
  looksLikeProcessEscape,
  looksLikePortEscape,
  isProtectedPort,
  isProtectedRuntimeId,
  OWNER_SURFACE_RUNTIME_ID,
  OWNER_SURFACE_PORT,
} from "./process-port";
export { allocateRuntimePort, withAllocatedPort, allocationsForTask } from "./port-allocator";
export {
  guardGitWrite,
  guardGitPushProxy,
  guardAgentEnvironmentCredentials,
  looksLikeGitWriteEscape,
  agentGitCredentialAuthority,
} from "./git-guard";
export { applyScopedPatch } from "./apply-patch";
export { recordDeniedMutation } from "./audit";
export { classifyMcpTool, mcpMutationAllowed, mcpMutationRequiresTaskScope } from "./mcp-scope";
export { writeWorkspaceMetadata, verifyHookContext } from "./workspace-metadata";
export { liveRegistryFromExistingStores, agentContextActive, denyProtectedRuntimeIfAgent } from "./live-registry";
export {
  classifyExecutionCanonicality,
  evaluateCursorHook,
  looksLikeUnscopedHostShell,
  resolveCursorSessionScope,
  agentProducedChangeEligibleForAutoPromotion,
  NON_CANONICAL_UNTRUSTED_EXECUTION,
} from "./cursor-admission";
export { launchCursorClassKernelProbe } from "./cursor-class-runner";
