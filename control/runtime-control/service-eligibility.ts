/**
 * Service eligibility from the existing runtime-node contract.
 * Not a second platform model: `lookupRuntimeNodeKind(capability_folder)`.
 */

import { lookupRuntimeNodeKind } from "../../contracts/architecture/runtime-node-and-optional-provider";
import { SERVICES } from "./host-runtime";
import type { ServiceId } from "./types";

export type ServiceNodeEligibility = "CORE_NODE_CAPABLE" | "MAC_LOCAL_AGENT_ONLY" | "UNKNOWN";

export function serviceNodeEligibility(serviceId: ServiceId): ServiceNodeEligibility {
  const def = SERVICES[serviceId];
  if (!def) return "UNKNOWN";
  const lookup = lookupRuntimeNodeKind(def.capability_folder);
  if (lookup.known && lookup.node === "CORE_NODE") return "CORE_NODE_CAPABLE";
  if (lookup.known && lookup.node === "MAC_LOCAL_AGENT") return "MAC_LOCAL_AGENT_ONLY";
  return "UNKNOWN";
}

export function isKnownServiceId(value: string): value is ServiceId {
  return Object.prototype.hasOwnProperty.call(SERVICES, value);
}
