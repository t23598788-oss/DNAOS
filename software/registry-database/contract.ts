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
export { findCapability, findResourceById, searchCapabilities } from "./lookup";
export { resolveCanonicalResource } from "./canonical-resource-resolution";
export type { CanonicalResourceQuery, CanonicalResourceResolution, ResourceIdentity } from "./canonical-resource-resolution";
export type { RegistryStore, ReadOnlyRegistryStore, ApprovedCandidateWrite, WriteOutcome } from "./store-port";

/**
 * การนำ `RegistryStore` ไปใช้จริงบนไฟล์ — เปิดผ่าน contract เพราะเดิมไม่เคยเปิด
 *
 * ผลของการไม่เปิด วัดได้จริง: มีผู้เรียก 57 จุด import
 * `./adapters/persistent-file-store` ตรง ๆ ข้ามขอบเขตของ capability นี้ ซึ่งผิด
 * CAPABILITY_FOLDER_LAW ข้อ 9 — แต่ความผิดไม่ได้อยู่ที่ผู้เรียก มันไม่มีทางที่ถูก
 * ให้เดินเลย capability ที่คนอื่นต้องใช้ store ของมันแต่ไม่ประกาศ store ไว้ที่
 * contract คือการบังคับให้ทุกคนละเมิดกฎ
 *
 * เปิดเฉพาะตัวสร้าง ไม่เปิดโครงสร้างภายในของ adapter — ผู้เรียกยังเห็นแค่
 * `RegistryStore` เหมือนเดิม การเปลี่ยนวิธีเก็บในอนาคตจึงยังไม่ลากผู้เรียกไปด้วย
 */
export { createPersistentFileStore } from "./adapters/persistent-file-store";
export type { PersistentFileStoreOptions } from "./adapters/persistent-file-store";
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
export type { CapabilitySearchHit } from "./lookup";
