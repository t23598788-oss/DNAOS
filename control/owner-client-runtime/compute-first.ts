/**
 * OWNER_COMPUTE_FIRST_V1 — extends LOCAL_FIRST. External AI reasoning only when required.
 */

import { decideLocalFirst, getLocalCapability, resolveCapabilityBindings } from "../local-resource-access/contract";
import { emitLocalResourceEvent } from "../local-resource-access/contract";
import { environmentForResource } from "./environments";
import type { LocalCapabilityName } from "../local-resource-access/contract";

export interface OwnerComputeRoute {
  readonly schema: "OWNER_COMPUTE_FIRST_V1";
  readonly order: readonly string[];
  readonly selected: "OWNER_LOCAL" | "APPLICATION_NATIVE" | "APPROVED_EXTERNAL_SERVICE" | "EXTERNAL_AI_REASONING";
  readonly external_reasoning_required: boolean;
  readonly locality: string;
  readonly environment_id: string;
  readonly reason: string;
}

const ORDER = [
  "OWNER_POLICY",
  "DATA_CLASSIFICATION",
  "SOURCE_LOCALITY",
  "DETERMINISTIC_LOCAL_OR_OWNER_SERVER",
  "APPLICATION_NATIVE",
  "APPROVED_EXTERNAL_SERVICE",
  "EXTERNAL_AI_REASONING_ONLY_WHEN_REQUIRED",
] as const;

export function decideOwnerComputeFirst(input: {
  readonly capability: string;
  readonly resource_id: string;
  readonly bytes_proposed: number;
  readonly semantic_review_required?: boolean;
  readonly ai_identity: string;
  readonly session_id: string;
  readonly work_id?: string;
}): OwnerComputeRoute {
  const env = environmentForResource(input.resource_id);
  const local = decideLocalFirst(input.capability as LocalCapabilityName, input.bytes_proposed);
  const descriptor = getLocalCapability(input.capability);
  const ranked = resolveCapabilityBindings({
    action: "SEARCH",
    ai_identity: input.ai_identity,
    session_id: input.session_id,
    work_id: input.work_id,
  });
  const localEligible = descriptor?.execution_classification === "LOCAL" || local.locality === "LOCAL";
  const privateLocal = input.capability === "LOCAL_PRIVATE_DOCUMENT_SUMMARY";
  const selected = privateLocal
    ? "OWNER_LOCAL"
    : localEligible && !input.semantic_review_required
      ? "OWNER_LOCAL"
      : input.semantic_review_required
        ? "EXTERNAL_AI_REASONING"
        : ranked.some((row) => row.eligible && row.locality !== "LOCAL")
          ? "APPROVED_EXTERNAL_SERVICE"
          : "OWNER_LOCAL";
  const route: OwnerComputeRoute = {
    schema: "OWNER_COMPUTE_FIRST_V1",
    order: [...ORDER],
    selected,
    external_reasoning_required: selected === "EXTERNAL_AI_REASONING",
    locality: env.availability === "AVAILABLE" ? "LOCAL" : "NOT_AVAILABLE",
    environment_id: env.environment_id,
    reason: local.reason,
  };
  emitLocalResourceEvent("OWNER_COMPUTE_ROUTE_SELECTED", input.work_id ?? null, route.selected, undefined, {
    resource_id: input.resource_id, locality: "LOCAL", action: input.capability,
  });
  emitLocalResourceEvent(
    route.external_reasoning_required ? "EXTERNAL_REASONING_REQUIRED" : "EXTERNAL_REASONING_SKIPPED",
    input.work_id ?? null,
    route.selected,
    undefined,
    { resource_id: input.resource_id, locality: "LOCAL" },
  );
  return route;
}
