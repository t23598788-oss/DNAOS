/**
 * LOCAL_FIRST routing: prefer deterministic local execution over sending source to an external AI.
 */

import { getLocalCapability } from "./capability-catalog";
import type { ExecutionLocality, LocalCapabilityName, NetworkEgressPolicy } from "./types";

export interface LocalFirstDecision {
  readonly locality: ExecutionLocality;
  readonly egress_policy: NetworkEgressPolicy;
  readonly reason: string;
}

export function decideLocalFirst(capability: LocalCapabilityName, bytesProposed: number): LocalFirstDecision {
  const descriptor = getLocalCapability(capability);
  if (!descriptor) {
    return { locality: "LOCAL", egress_policy: "DENIED", reason: "unknown capability cannot leave the machine" };
  }
  if (descriptor.execution_classification === "LOCAL") {
    return {
      locality: "LOCAL",
      egress_policy: bytesProposed > 4096 ? "LOCAL_ONLY" : descriptor.possible_network_egress,
      reason: "operation is performed on this machine; external AI receives only the minimized result",
    };
  }
  return { locality: "EXTERNAL_AI", egress_policy: "OWNER_APPROVAL_REQUIRED", reason: "semantic work would require Owner-approved minimized egress" };
}
