/**
 * HTTP mapping of the frozen runtime-node contract for this CORE_NODE server.
 * Does not classify providers. Does not mint Owner commands.
 */

import {
  MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE,
  macLocalAgentExecutionDecision,
  type RuntimeNodeKind,
} from "../../contracts/architecture/runtime-node-and-optional-provider";

export const CORE_HTTP_NODE: RuntimeNodeKind = "CORE_NODE";

export interface MacLocalAgentUnavailableBody {
  readonly ok: false;
  readonly error: typeof MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE;
  readonly reason_code: typeof MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE;
  readonly required_node: "MAC_LOCAL_AGENT";
  readonly current_node: RuntimeNodeKind;
  readonly execution_attempted: false;
  readonly capability: string;
}

export function coreNodeMacLocalAgentDecision() {
  return macLocalAgentExecutionDecision({ current_node: CORE_HTTP_NODE });
}

export function macLocalAgentUnavailableBody(capability: string): MacLocalAgentUnavailableBody {
  const decision = coreNodeMacLocalAgentDecision();
  if (decision.execute) {
    throw new Error("macLocalAgentUnavailableBody called on a host that may execute MAC_LOCAL_AGENT");
  }
  return {
    ok: false,
    error: MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE,
    reason_code: decision.reason_code,
    required_node: decision.required_node,
    current_node: decision.current_node,
    execution_attempted: false,
    capability,
  };
}

/** Null when this host may run the capability. Caller must not treat null as success of the capability. */
export function coreNodeUnavailableForCapability(capability: string): MacLocalAgentUnavailableBody | null {
  const decision = coreNodeMacLocalAgentDecision();
  if (decision.execute) return null;
  return macLocalAgentUnavailableBody(capability);
}

/**
 * Closed classification of POST /computer-use/owner/authenticate methods.
 * Every method is explicit: none is left as implicit platform behavior.
 * All three contract methods eventually need Mac console presence and/or
 * native LocalAuthentication — none is CORE_PORTABLE.
 */
export const OWNER_AUTH_METHOD_CLASSIFICATION = {
  "macos-console-session": "MAC_LOCAL_AGENT_ONLY",
  "touch-id": "MAC_LOCAL_AGENT_ONLY",
  "human-verification": "MAC_LOCAL_AGENT_ONLY",
} as const;

export type OwnerAuthMethodNodeClass = "CORE_PORTABLE" | "MAC_LOCAL_AGENT_ONLY" | "UNKNOWN";

export function classifyOwnerAuthMethod(method: string): OwnerAuthMethodNodeClass {
  if (method === "macos-console-session" || method === "touch-id" || method === "human-verification") {
    return OWNER_AUTH_METHOD_CLASSIFICATION[method];
  }
  return "UNKNOWN";
}

/** Fail closed for any authenticate method that is not CORE_PORTABLE. */
export function coreNodeUnavailableForOwnerAuthMethod(method: string): MacLocalAgentUnavailableBody | null {
  if (classifyOwnerAuthMethod(method) === "CORE_PORTABLE") return null;
  return coreNodeUnavailableForCapability("control/owner-authentication");
}
