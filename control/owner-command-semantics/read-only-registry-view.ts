/**
 * หน้าที่: strips write authority off `software/registry-database`'s
 * `RegistryStore` before it can reach the Owner Conversation Layer (Owner
 * UNLOCK, 2026-09-06, PHASE 2B — object-capability leak closed).
 *
 * `RegistryStore` bundles `writeApprovedCandidate()` and
 * `appendRegistrationEvent()` in the SAME interface as its read methods.
 * Before this file existed, `transport/owner-command-http/server.ts` handed
 * that exact live object — the one production registration writes go
 * through — into `translateOwnerMessage()`/`resolveOwnerCommandSemantics()`
 * as `deps.registryStore`. No code path in `./resolver.ts` ever called the
 * write methods, but the conversation call held a reference that could.
 *
 * `toReadOnlyRegistryView()` copies over ONLY the methods
 * `../../software/registry-database/lookup.ts` and `./resolver.ts`'s
 * relationship query actually call, onto a frozen plain object. This is not
 * a TypeScript type narrowing that `as any` could bypass — the returned
 * object literally does not have a `writeApprovedCandidate` or
 * `appendRegistrationEvent` property at runtime.
 *
 * Input: a full `RegistryStore`.
 * Output: `ReadOnlyRegistryView` — every read method `lookup.ts` and
 * `resolver.ts#resolveRelationshipQuery` call, nothing else.
 * Dependency ที่อนุญาต: `../../software/registry-database/contract.ts`
 * (type only).
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม `writeApprovedCandidate`, `appendRegistrationEvent`,
 * หรือเมธอดเขียนใดๆ ลงใน `ReadOnlyRegistryView` ไม่ว่ากรณีใด.
 */

import type { ReadOnlyRegistryStore, RegistryStore } from "../../software/registry-database/contract";

export type ReadOnlyRegistryView = ReadOnlyRegistryStore;

export function toReadOnlyRegistryView(store: RegistryStore): ReadOnlyRegistryView {
  const view: ReadOnlyRegistryView = {
    findCapabilityById: store.findCapabilityById.bind(store),
    findCapabilityBySemanticFingerprint: store.findCapabilityBySemanticFingerprint.bind(store),
    findCapabilityByCanonicalName: store.findCapabilityByCanonicalName.bind(store),
    findResourceById: store.findResourceById.bind(store),
  };
  if (store.listCapabilityRows) view.listCapabilityRows = store.listCapabilityRows.bind(store);
  if (store.listResourceRows) view.listResourceRows = store.listResourceRows.bind(store);
  if (store.listResourceCapabilityLinks) view.listResourceCapabilityLinks = store.listResourceCapabilityLinks.bind(store);
  if (store.listRelationshipRows) view.listRelationshipRows = store.listRelationshipRows.bind(store);
  if (store.listEvidenceRows) view.listEvidenceRows = store.listEvidenceRows.bind(store);
  return Object.freeze(view);
}
