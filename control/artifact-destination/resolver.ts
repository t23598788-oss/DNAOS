/**
 * หน้าที่: `resolveArtifactDestination()` — the deterministic contract
 * every REGISTERED artifact's next destination comes from. Reads only
 * ./destination-registry.ts's two mapping tables; makes no decision of
 * its own, never inspects source content (only resource_id/resource_type
 * references ever reach this function).
 *
 * REGISTERED ARTIFACT -> RESOURCE TYPE -> DESTINATION CLASSIFICATION
 * -> DESTINATION CONTRACT -> TARGET RESOLUTION -> NEXT ACTION
 *
 * Two honest failure modes, both stop here — neither ever falls back to
 * guessing or inventing a target:
 * - no entry in RESOURCE_TYPE_DESTINATION_CLASS for this resource_type
 *   -> MAPPING_NOT_FOUND.
 * - a destination class exists but no real capability backs it (or the
 *   one that does isn't currently CONNECTED) -> NOT_AVAILABLE.
 *
 * Input: `RegisteredArtifactRef`.
 * Output: `resolveArtifactDestination` -> `ArtifactDestinationResult`.
 * Dependency ที่อนุญาต: ./destination-registry.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never return AVAILABLE without DESTINATION_CLASS_BACKING's
 * own checkAvailable() having actually run and returned true. Never let
 * next_action be free text an LLM composed — every branch below is a
 * fixed, deterministic string built only from the real resource_id/class.
 */

import { DESTINATION_CLASS_BACKING, RESOURCE_TYPE_DESTINATION_CLASS } from "./destination-registry";
import type { ArtifactDestinationResult, DestinationClass, RegisteredArtifactRef } from "./types";

function deterministicNextAction(destinationClass: DestinationClass, capabilityId: string, artifact: RegisteredArtifactRef): string {
  switch (destinationClass) {
    case "SOURCE_AUTHORITY":
      return `route resource_id=${artifact.resource_id} through the version/commit workflow owned by capability_id=${capabilityId}`;
    case "EVIDENCE_STORE":
      return `create/confirm an evidence relationship for resource_id=${artifact.resource_id} against the resource/capability it tested, in ${capabilityId}`;
    case "CAPABILITY_GRAPH":
      return `index/update resource_id=${artifact.resource_id} in the ${capabilityId} capability graph (relationships/resource_capabilities)`;
    case "SYSTEM_REGISTRY":
      return `confirm resource_id=${artifact.resource_id}'s system-level relationships in ${capabilityId}`;
    case "VERSION_STORE":
      return `confirm resource_id=${artifact.resource_id}'s version row in ${capabilityId}`;
    case "UI_REGISTRY":
      return `register resource_id=${artifact.resource_id}'s route/display/data-source relationship in ${capabilityId}`;
    case "DEPLOYMENT_CANDIDATE":
      return `hold resource_id=${artifact.resource_id} as a deployment candidate pending ${capabilityId}`;
    case "NO_FURTHER_ACTION":
      return `no further action required for resource_id=${artifact.resource_id}`;
  }
}

export function resolveArtifactDestination(artifact: RegisteredArtifactRef): ArtifactDestinationResult {
  const destinationClass = RESOURCE_TYPE_DESTINATION_CLASS[artifact.resource_type];
  if (destinationClass === undefined) {
    return {
      artifact_resource_id: artifact.resource_id,
      resource_type: artifact.resource_type,
      destination_class: null,
      destination_capability_id: null,
      destination_status: "MAPPING_NOT_FOUND",
      next_action: `DESTINATION_MAPPING_NOT_FOUND: no destination class is registered for resource_type=${artifact.resource_type} — stop, no destination guessed`,
      evidence_ref: artifact.evidence_ref,
    };
  }

  const backing = DESTINATION_CLASS_BACKING[destinationClass];
  if (!backing || !backing.checkAvailable()) {
    return {
      artifact_resource_id: artifact.resource_id,
      resource_type: artifact.resource_type,
      destination_class: destinationClass,
      destination_capability_id: backing?.destination_capability_id ?? null,
      destination_status: "NOT_AVAILABLE",
      next_action: `DESTINATION_NOT_AVAILABLE: ${destinationClass} has no currently REGISTERED/CONNECTED capability — stop, no target created`,
      evidence_ref: artifact.evidence_ref,
    };
  }

  return {
    artifact_resource_id: artifact.resource_id,
    resource_type: artifact.resource_type,
    destination_class: destinationClass,
    destination_capability_id: backing.destination_capability_id,
    destination_status: "AVAILABLE",
    next_action: deterministicNextAction(destinationClass, backing.destination_capability_id, artifact),
    evidence_ref: artifact.evidence_ref,
  };
}
