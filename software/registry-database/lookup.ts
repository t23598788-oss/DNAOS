/**
 * หน้าที่: `findCapability()` — the only read path into `software_registry`
 * this capability exposes. Thin wrapper over `RegistryStore`'s read
 * methods; no query logic of its own beyond picking which store method a
 * given `CapabilityLookupQuery` maps to.
 *
 * Input: `CapabilityLookupQuery`, `RegistryStore`.
 * Output: `CapabilityLookupResult | null`.
 * Dependency ที่อนุญาต: ./types.ts, ./store-port.ts.
 * สิ่งที่ห้ามแตะ: never let this file mutate anything — read-only, always.
 * Never let a caller pass a raw SQL fragment or unvalidated string through
 * to a store adapter; the three query fields on `CapabilityLookupQuery`
 * are the entire surface.
 */

import type { CapabilityLookupQuery, CapabilityLookupResult } from "./types";
import type { RegistryStore } from "./store-port";

export function findCapability(query: CapabilityLookupQuery, store: RegistryStore): CapabilityLookupResult | null {
  if (query.capability_id !== undefined) return store.findCapabilityById(query.capability_id);
  if (query.semantic_fingerprint !== undefined) return store.findCapabilityBySemanticFingerprint(query.semantic_fingerprint);
  if (query.canonical_name !== undefined) return store.findCapabilityByCanonicalName(query.canonical_name);
  return null;
}

export function findResourceById(resource_id: string, store: RegistryStore) {
  return store.findResourceById(resource_id);
}
