/**
 * หน้าที่: the public registry API — admission (role allowlist + sandbox
 * scope) always runs BEFORE a registration is persisted, same
 * "validate before execute" discipline as
 * control/agent-gateway/work-order-validator.ts. Availability always
 * comes from ./detect.ts's real check, never a caller-supplied claim.
 *
 * Input: provider/role/workspace_scope.
 * Output: registerAgent, refreshAgent, listRegisteredAgents,
 * checkSandboxScope.
 * Dependency ที่อนุญาต: ./contract.ts, ./detect.ts, ./store.ts.
 * สิ่งที่ห้ามแตะ: never persist a registration whose role is not in
 * ALLOWED_ROLES_BY_PROVIDER for its provider; never mark
 * permission_state "sandbox_only" without a passing checkSandboxScope.
 */
import { randomUUID } from "node:crypto";
import { ALLOWED_ROLES_BY_PROVIDER } from "./contract";
import type { AgentProvider, AgentRegistration, AgentRole, Availability, SandboxScopeCheck } from "./contract";
import { detectAvailability } from "./detect";
import { getAgent, listAgents, upsertAgent } from "./store";

/** Same two canonical roots this whole session has treated as the only real sandbox scope — dna-os-deadboard is production business code and is never a valid target for an agent's write scope from this registry. */
const ALLOWED_WORKSPACE_SCOPES = ["/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE"];

export function checkSandboxScope(workspaceScope: string): SandboxScopeCheck {
  if (ALLOWED_WORKSPACE_SCOPES.includes(workspaceScope)) return { ok: true, reason: "workspace_scope is on the sandbox allowlist" };
  return { ok: false, reason: `workspace_scope "${workspaceScope}" is not on the sandbox allowlist — production repos (e.g. dna-os-deadboard) are never a valid agent-registry scope` };
}

function roleAllowed(provider: AgentProvider, role: AgentRole): boolean {
  return ALLOWED_ROLES_BY_PROVIDER[provider].includes(role);
}

export interface RegisterAgentInput {
  provider: AgentProvider;
  role: AgentRole;
  capability: string[];
  transport: AgentRegistration["transport"];
  workspace_scope: string;
}

export type RegisterAgentOutcome = { ok: true; registration: AgentRegistration } | { ok: false; reason: string; denied_at_stage: "role" | "scope" };

/** Registry discovery + admission in one call. A denied admission is never persisted as a usable registration — the caller gets a structured rejection instead. */
export async function registerAgent(input: RegisterAgentInput): Promise<RegisterAgentOutcome> {
  if (!roleAllowed(input.provider, input.role)) {
    return { ok: false, reason: `role "${input.role}" is not allowed for provider "${input.provider}" — allowed: ${ALLOWED_ROLES_BY_PROVIDER[input.provider].join(", ")}`, denied_at_stage: "role" };
  }
  const scopeCheck = checkSandboxScope(input.workspace_scope);
  if (!scopeCheck.ok) {
    return { ok: false, reason: scopeCheck.reason, denied_at_stage: "scope" };
  }

  const detection = await detectAvailability(input.provider);
  const registration: AgentRegistration = {
    agent_id: `agent-${input.provider}-${randomUUID()}`,
    provider: input.provider,
    role: input.role,
    capability: input.capability,
    transport: input.transport,
    workspace_scope: input.workspace_scope,
    permission_state: "sandbox_only",
    health: detection.availability === "LIVE" ? "OK" : detection.availability === "UNKNOWN" ? "UNREACHABLE" : "DEGRADED",
    last_seen: new Date().toISOString(),
    availability: detection.availability,
    detection_mechanism: detection.mechanism,
  };
  upsertAgent(registration);
  return { ok: true, registration };
}

/** Re-runs the real detection for an already-registered agent and persists the refreshed state — this is the "restart recovery" / "health refresh" path, never a re-registration. */
export async function refreshAgent(agentId: string): Promise<AgentRegistration | null> {
  const existing = getAgent(agentId);
  if (!existing) return null;
  const detection = await detectAvailability(existing.provider);
  const refreshed: AgentRegistration = { ...existing, availability: detection.availability, detection_mechanism: detection.mechanism, health: detection.availability === "LIVE" ? "OK" : detection.availability === "UNKNOWN" ? "UNREACHABLE" : "DEGRADED", last_seen: new Date().toISOString() };
  upsertAgent(refreshed);
  return refreshed;
}

/** Owner Console status read — always the real, latest, one-per-agent_id view (see ./store.ts's duplicate-prevention discipline). */
export function listRegisteredAgents(): AgentRegistration[] {
  return listAgents();
}

export function availabilityOf(agents: AgentRegistration[], provider: AgentProvider): Availability {
  return agents.find((a) => a.provider === provider)?.availability ?? "UNKNOWN";
}
