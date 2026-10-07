/**
 * หน้าที่: the type contracts for Target Resolution — the layer between
 * Destination Mapping (control/artifact-destination/, already
 * classifies+checks capability availability) and Permission/Policy /
 * Admission / Execute (not built yet). Turns a destination_class +
 * destination_capability_id into a CONCRETE, structured target reference
 * — or honestly reports why it cannot, never a guess.
 *
 * Input: none (pure type definitions).
 * Output: `TargetResolutionStatus`, `TargetKind`,
 * `ArtifactForTargetResolution`, `ResolvedTarget`.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field here that carries source file content
 * or a credential — `target_ref` is always a structured reference
 * string, never a payload.
 */

export type TargetResolutionStatus = "RESOLVED" | "TARGET_NOT_RESOLVED" | "DESTINATION_NOT_AVAILABLE" | "DESTINATION_MAPPING_NOT_FOUND";

export type TargetKind = "REGISTRY_ROW" | "GIT_SOURCE_LOCATION";

/** Everything Target Resolution needs about one already-REGISTERED artifact — never its content. */
export interface ArtifactForTargetResolution {
  resource_id: string;
  resource_type: string;
  capability_id?: string | null;
  source_location: string;
  evidence_ref: string;
}

export interface ResolvedTarget {
  artifact_resource_id: string;
  resource_type: string;
  destination_class: string | null;
  destination_capability_id: string | null;
  target_status: TargetResolutionStatus;
  target_kind: TargetKind | null;
  /** A concrete, structured reference — only ever set when target_status === "RESOLVED". */
  target_ref: string | null;
  reason: string;
  evidence_ref: string;
}
