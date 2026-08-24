/**
 * หน้าที่: the public boundary of `control/artifact-destination/` — the
 * only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 * `./resolver.ts` and `./destination-registry.ts` stay reachable only
 * through here.
 *
 * Input: re-exports only.
 * Output: `resolveArtifactDestination`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./destination-registry.ts, ./types.ts.
 */

export { resolveArtifactDestination } from "./resolver";
export { RESOURCE_TYPE_DESTINATION_CLASS, DESTINATION_CLASS_BACKING } from "./destination-registry";
export type { DestinationClass, DestinationStatus, RegisteredArtifactRef, ArtifactDestinationResult } from "./types";
