/**
 * หน้าที่: the type contracts for Artifact Destination Mapping — where a
 * REGISTERED artifact (already written into software_registry by
 * control/work-result-ingress/ or POST /registry/candidates) must go
 * next, decided by a deterministic, registry-driven mapping — never an
 * AI guess, never an Agent's own choice of storage/deployment target.
 *
 * Input: none (pure type definitions).
 * Output: `DestinationClass`, `DestinationStatus`, `RegisteredArtifactRef`,
 * `ArtifactDestinationResult`.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field here that carries source file content —
 * this boundary works only with already-registered resource_id/resource_type
 * references, never the artifact's actual content.
 */

export type DestinationClass =
  | "SOURCE_AUTHORITY"
  | "CAPABILITY_GRAPH"
  | "EVIDENCE_STORE"
  | "VERSION_STORE"
  | "UI_REGISTRY"
  | "SYSTEM_REGISTRY"
  | "DEPLOYMENT_CANDIDATE"
  | "NO_FURTHER_ACTION";

export type DestinationStatus = "AVAILABLE" | "NOT_AVAILABLE" | "MAPPING_NOT_FOUND";

/** A reference to an already-registered artifact — never its content. */
export interface RegisteredArtifactRef {
  resource_id: string;
  resource_type: string;
  capability_id?: string | null;
  evidence_ref: string;
}

export interface ArtifactDestinationResult {
  artifact_resource_id: string;
  resource_type: string;
  destination_class: DestinationClass | null;
  destination_capability_id: string | null;
  destination_status: DestinationStatus;
  next_action: string;
  evidence_ref: string;
}
