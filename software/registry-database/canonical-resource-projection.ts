import type { RegistryStore } from "./store-port";
import type { ResourceRow } from "./types";

export type CanonicalResourceRef = { identity_type: string; identity_id: string };

export type ResourceProjectionResolution =
  | { status: "EXISTING"; resource: ResourceRow; evidence: string[] }
  | { status: "ABSENT"; candidate_resources: ResourceRow[]; evidence: string[] };

/** Duplicate gate for projections: canonical identity + projection kind, never display names or UUIDs. */
export function resolveResourceProjection(ref: CanonicalResourceRef, projectionKind: string, store: RegistryStore): ResourceProjectionResolution {
  const rows = store.listResourceRows?.() ?? [];
  const matches = rows.filter((row) => row.canonical_ref?.identity_type === ref.identity_type && row.canonical_ref?.identity_id === ref.identity_id && row.projection_kind === projectionKind);
  if (matches.length > 0) return { status: "EXISTING", resource: matches[0]!, evidence: [`canonical_ref=${ref.identity_type}:${ref.identity_id}`, `projection_kind=${projectionKind}`, "duplicate gate matched existing ResourceRow"] };
  return { status: "ABSENT", candidate_resources: [], evidence: [`canonical_ref=${ref.identity_type}:${ref.identity_id}`, `projection_kind=${projectionKind}`, "no existing projection after registry enumeration"] };
}
