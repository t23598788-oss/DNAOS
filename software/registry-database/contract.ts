/**
 * หน้าที่: the public boundary of `software/registry-database/` — the only
 * file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 * `./registry-writer.ts`, `./lookup.ts`, `./store-port.ts`, `./types.ts`,
 * `./host-runtime.ts`, and `./adapters/*` stay reachable only through here
 * (adapters are not re-exported at all — see ห้ามแตะ below).
 *
 * Input: re-exports only.
 * Output: `commitRegisteredCandidate` (write-only — see its own doc
 * comment; the only caller is `control/registration-pipeline/pipeline.ts`),
 * `findCapability`/`findResourceById` (the Lookup API), `CommitResult`,
 * `RegistrationIngressStatus`, `DuplicateOf`, `RegistryStore` (the port
 * type a caller's store instance must satisfy — Duplicate Resolution
 * calls its own `findResourceByContentHash`/
 * `findCapabilityBySemanticFingerprint` methods directly, the same real
 * reads this store already exposes), plus every row/query type a caller
 * needs.
 * Dependency ที่อนุญาต: ./registry-writer.ts, ./lookup.ts, ./store-port.ts,
 * ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export `./adapters/local-file-store.ts` (test-only,
 * see its own header) or `./adapters/postgres-store.ts` (real but not
 * invoked this round — wiring a real transport is a future round's
 * decision, not this file's). Never re-export `./host-runtime.ts`. Callers
 * outside this folder construct or receive a `RegistryStore` instance from
 * whichever transport wires this round's or a future round's adapter —
 * this contract does not hand one out.
 */

export { commitRegisteredCandidate, validateCandidateRelationships } from "./registry-writer";
export type { CommitResult, RegistrationIngressStatus, DuplicateOf, CandidateRelationshipInput, ValidatedRelationships } from "./registry-writer";
export { findCapability, findResourceById } from "./lookup";
export type { RegistryStore, ApprovedCandidateWrite, WriteOutcome } from "./store-port";
export type {
  ResourceRow,
  CapabilityRow,
  ResourceCapabilityRow,
  RelationshipRow,
  VersionRow,
  EvidenceRow,
  RegistrationEventRow,
  CapabilityLookupQuery,
  CapabilityLookupResult,
  ResourceStatus,
  CapabilityRegistryStatus,
  RelationshipKind,
  RelationshipEntityType,
} from "./types";
