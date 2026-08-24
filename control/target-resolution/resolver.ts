/**
 * หน้าที่: `resolveTarget()` — turns Destination Mapping's output
 * (control/artifact-destination/'s `resolveArtifactDestination`) into a
 * concrete, structured target reference. Never executes anything, never
 * calls a real network API, never guesses a repo/owner/branch.
 *
 * REGISTERED ARTIFACT -> DESTINATION MAPPING -> TARGET RESOLUTION (here)
 * -> [Permission/Policy -> Admission -> Execute: not built this round]
 *
 * Two destination shapes, resolved differently, both deterministic:
 *
 * - Registry-internal classes (CAPABILITY_GRAPH, EVIDENCE_STORE,
 *   SYSTEM_REGISTRY) resolve trivially and always succeed once AVAILABLE
 *   — the target IS the same software_registry row the artifact was
 *   already written into. No external lookup needed.
 * - SOURCE_AUTHORITY (github) requires a real, already-registered
 *   `ConnectionRegistration` (contracts/connector/connection.ts) whose
 *   `adapter` matches the destination_capability_id and whose `status`
 *   is "connected". None is fabricated here — the caller supplies
 *   whatever real connections it knows about (today: none exist
 *   anywhere in this repo — contracts/connector/connection.ts's own
 *   header says so — so this honestly resolves TARGET_NOT_RESOLVED until
 *   a real Connection is registered somewhere).
 *
 * Input: `ArtifactForTargetResolution`, real `ConnectionRegistration[]`
 * the caller already holds (never invented here).
 * Output: `resolveTarget` -> `ResolvedTarget`.
 * Dependency ที่อนุญาต: ../artifact-destination/contract.ts,
 * ../../contracts/connector/connection.ts (types only),
 * ../../connections/github/repo-path.ts (checkRepoPath — reused, not
 * reimplemented), ./types.ts.
 * สิ่งที่ห้ามแตะ: never call a network API here. Never return RESOLVED
 * for SOURCE_AUTHORITY without a real, matching, connected
 * ConnectionRegistration having actually been found in the caller-supplied
 * list. Never invent a repo/owner/branch default.
 */

import { resolveArtifactDestination } from "../artifact-destination/contract";
import { checkRepoPath } from "../../connections/github/repo-path";
import type { ConnectionRegistration } from "../../contracts/connector/connection";
import type { ArtifactForTargetResolution, ResolvedTarget } from "./types";

const SELF_REGISTRY_CLASSES = new Set(["CAPABILITY_GRAPH", "EVIDENCE_STORE", "SYSTEM_REGISTRY"]);

export interface TargetResolutionContext {
  /** Real, already-registered connections — an empty array is the honest default, since none exist anywhere in this repo today. */
  connections: readonly ConnectionRegistration[];
}

export function resolveTarget(artifact: ArtifactForTargetResolution, context: TargetResolutionContext = { connections: [] }): ResolvedTarget {
  const destination = resolveArtifactDestination(artifact);

  if (destination.destination_status === "MAPPING_NOT_FOUND") {
    return {
      artifact_resource_id: artifact.resource_id,
      resource_type: artifact.resource_type,
      destination_class: null,
      destination_capability_id: null,
      target_status: "DESTINATION_MAPPING_NOT_FOUND",
      target_kind: null,
      target_ref: null,
      reason: destination.next_action,
      evidence_ref: artifact.evidence_ref,
    };
  }

  if (destination.destination_status === "NOT_AVAILABLE") {
    return {
      artifact_resource_id: artifact.resource_id,
      resource_type: artifact.resource_type,
      destination_class: destination.destination_class,
      destination_capability_id: destination.destination_capability_id,
      target_status: "DESTINATION_NOT_AVAILABLE",
      target_kind: null,
      target_ref: null,
      reason: destination.next_action,
      evidence_ref: artifact.evidence_ref,
    };
  }

  // AVAILABLE from here on — the destination class itself is real and connected.
  const destinationClass = destination.destination_class!;

  if (SELF_REGISTRY_CLASSES.has(destinationClass)) {
    return {
      artifact_resource_id: artifact.resource_id,
      resource_type: artifact.resource_type,
      destination_class: destinationClass,
      destination_capability_id: destination.destination_capability_id,
      target_status: "RESOLVED",
      target_kind: "REGISTRY_ROW",
      target_ref: `software-registry://${destinationClass.toLowerCase()}/${artifact.capability_id ?? artifact.resource_id}`,
      reason: "resolved to the same software_registry row this artifact was already written into — no external lookup needed",
      evidence_ref: artifact.evidence_ref,
    };
  }

  if (destinationClass === "SOURCE_AUTHORITY") {
    const pathCheck = checkRepoPath(artifact.source_location);
    if (!pathCheck.ok) {
      return {
        artifact_resource_id: artifact.resource_id,
        resource_type: artifact.resource_type,
        destination_class: destinationClass,
        destination_capability_id: destination.destination_capability_id,
        target_status: "TARGET_NOT_RESOLVED",
        target_kind: null,
        target_ref: null,
        reason: `source_location failed connections/github/repo-path.ts's checkRepoPath: ${pathCheck.reason}`,
        evidence_ref: artifact.evidence_ref,
      };
    }

    const connection = context.connections.find((candidate) => candidate.adapter === destination.destination_capability_id && candidate.status === "connected");
    if (!connection) {
      return {
        artifact_resource_id: artifact.resource_id,
        resource_type: artifact.resource_type,
        destination_class: destinationClass,
        destination_capability_id: destination.destination_capability_id,
        target_status: "TARGET_NOT_RESOLVED",
        target_kind: null,
        target_ref: null,
        reason: `no connected ConnectionRegistration exists for adapter=${destination.destination_capability_id} — contracts/connector/connection.ts: "NOT_YET_BUILT: no real connection has been registered"`,
        evidence_ref: artifact.evidence_ref,
      };
    }

    return {
      artifact_resource_id: artifact.resource_id,
      resource_type: artifact.resource_type,
      destination_class: destinationClass,
      destination_capability_id: destination.destination_capability_id,
      target_status: "RESOLVED",
      target_kind: "GIT_SOURCE_LOCATION",
      target_ref: `github://${connection.connection_id}/${pathCheck.normalized}`,
      reason: `resolved via connection_id=${connection.connection_id}`,
      evidence_ref: artifact.evidence_ref,
    };
  }

  // Any destination_class marked AVAILABLE with no target-resolution rule implemented yet — honest, never fabricated.
  return {
    artifact_resource_id: artifact.resource_id,
    resource_type: artifact.resource_type,
    destination_class: destinationClass,
    destination_capability_id: destination.destination_capability_id,
    target_status: "TARGET_NOT_RESOLVED",
    target_kind: null,
    target_ref: null,
    reason: `no target resolution rule implemented yet for destination_class=${destinationClass}`,
    evidence_ref: artifact.evidence_ref,
  };
}
