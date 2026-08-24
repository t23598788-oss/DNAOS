/**
 * หน้าที่: DUPLICATE RESOLUTION — stage 3, the ONE and ONLY owner of what
 * "duplicate" means anywhere in this pipeline. No other stage, no store
 * adapter, and no Registry Writer may make this decision again — see
 * `software/registry-database/adapters/persistent-file-store.ts`'s own
 * header, which explicitly disclaims this responsibility now.
 *
 * Queries the REAL canonical registry (`store.findResourceByContentHash`,
 * `store.findCapabilityBySemanticFingerprint` — the same reads
 * `software/registry-database/lookup.ts`'s `findCapability()` is built
 * from) — never a caller-supplied `existing` snapshot that could be
 * stale or incomplete. Exact content match wins over semantic match
 * (a byte-identical resubmission is unambiguous; a semantic match still
 * needs the caller to compare source/version before deciding what to do
 * next).
 *
 * Input: `RegistrationCandidate`, its `RegistrationFingerprint`, a real
 * `RegistryStore`.
 * Output: `resolveDuplicate` -> `DuplicateResolutionResult`, one of
 * exactly `UNIQUE | DUPLICATE_EXACT | DUPLICATE_SEMANTIC |
 * UNRESOLVED_DUPLICATE` — never anything else, never a guess.
 * Dependency ที่อนุญาต: ../../software/registry-database/contract.ts
 * (`RegistryStore` type only — this stage calls the store's own read
 * methods directly, never a new lookup mechanism), ../event-pipeline/contract.ts
 * (types only), ./types.ts.
 * สิ่งที่ห้ามแตะ: never call `store.commitRegisteredCandidate` /
 * `store.writeApprovedCandidate` from here — this stage only reads, never
 * writes. Never fall back to ALLOW/UNIQUE when a lookup throws — that is
 * exactly UNRESOLVED_DUPLICATE, fail-closed, never a guess.
 */

import type { RegistryStore } from "../../software/registry-database/contract";
import type { RegistrationCandidate, RegistrationFingerprint } from "../event-pipeline/contract";
import type { DuplicateResolutionResult } from "./types";

export function resolveDuplicate(_candidate: RegistrationCandidate, fingerprint: RegistrationFingerprint, store: RegistryStore): DuplicateResolutionResult {
  try {
    const exactMatch = store.findResourceByContentHash(fingerprint.exact);
    if (exactMatch) {
      return { status: "DUPLICATE_EXACT", matched: { resource_id: exactMatch.resource_id, capability_id: null }, reason_code: "EXACT_CONTENT_HASH_MATCH" };
    }
    const semanticMatch = store.findCapabilityBySemanticFingerprint(fingerprint.semantic);
    if (semanticMatch) {
      return { status: "DUPLICATE_SEMANTIC", matched: { resource_id: null, capability_id: semanticMatch.capability_id }, reason_code: "SEMANTIC_FINGERPRINT_MATCH" };
    }
    return { status: "UNIQUE", matched: null, reason_code: null };
  } catch (error) {
    return { status: "UNRESOLVED_DUPLICATE", matched: null, reason_code: `DUPLICATE_LOOKUP_FAILED:${error instanceof Error ? error.message : String(error)}` };
  }
}
