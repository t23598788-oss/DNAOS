/**
 * หน้าที่: `reserveAndRegister()` — the one real entry point that closes
 * the registration TOCTOU gap. Computes the candidate's real semantic
 * fingerprint via the EXISTING, UNMODIFIED `fingerprintCandidate`,
 * reserves it via `execution/process-lock/`'s real cross-process mutex
 * (`CAPABILITY_FINGERPRINT:<fingerprint>`), then calls the EXISTING,
 * UNMODIFIED `runRegistrationPipeline` — never reimplementing
 * classification, duplicate resolution, or the registry write.
 *
 * 100 concurrent candidates sharing the identical fingerprint: exactly
 * one real process wins the lock and reaches `runRegistrationPipeline`
 * first; every other concurrent attempt gets `RESERVATION_CONFLICT`
 * immediately, without ever calling the pipeline (never spawning 100
 * capability_ids to merge later). A caller that receives
 * `RESERVATION_CONFLICT` may legitimately retry once the winner's real
 * registration has committed — at that point the existing, unmodified
 * duplicate-resolution logic will honestly report DUPLICATE_EXACT/
 * DUPLICATE_SEMANTIC against the now-real, already-written row.
 *
 * ATOMIC AUTHORITATIVE READ/WRITE (closes the real, verified cross-
 * instance staleness gap in `software/registry-database/adapters/
 * persistent-file-store.ts` — that adapter rehydrates from disk only at
 * construction time, never re-reading per query, so two SEPARATE store
 * instances each constructed before either commits will not see each
 * other's write). The caller supplies a `storeFactory` — never a
 * pre-built store — which this function calls to construct a BRAND NEW
 * store instance only AFTER the fingerprint lock is held, and only ever
 * inside the locked critical section. Because every real store adapter
 * (`local-file-store.ts`, `persistent-file-store.ts`) already does a
 * full, real rehydration from disk at construction (unmodified, existing
 * behavior), a fresh construction taken strictly after acquiring the
 * lock is guaranteed to see every prior winner's already-committed write
 * — the same real ordering guarantee `execution/process-lock/`'s
 * `O_CREAT|O_EXCL` primitive already proves cross-process. No new store
 * type, no parallel registry — the exact same adapter, just re-
 * instantiated at the one moment that makes it authoritative.
 *
 * Input: `RegistrationCandidate`, a `storeFactory: () => RegistryStore`
 * (the caller's own choice of adapter — this file stays adapter-
 * agnostic), `correlation_id`, a `holder_id` identifying the calling
 * agent/process, a lease in ms.
 * Output: `reserveAndRegister` -> `ReserveAndRegisterResult`.
 * Dependency ที่อนุญาต: ../event-pipeline/contract.ts (fingerprintCandidate,
 * RegistrationCandidate — types+function only, never classifyCandidate/
 * resolveDuplicate), ../registration-pipeline/contract.ts
 * (runRegistrationPipeline — the one real call), ../../execution/process-lock/contract.ts,
 * ../../software/registry-database/contract.ts (RegistryStore type only), ./types.ts.
 * สิ่งที่ห้ามแตะ: never call classifyCandidate/resolveDuplicate/
 * commitRegisteredCandidate directly — always through the unmodified
 * `runRegistrationPipeline`. Never call `storeFactory()` before the lock
 * is held — that would silently reintroduce the exact staleness gap this
 * mechanism exists to close. Never leave the fingerprint lock held after
 * this function returns, success or failure alike.
 */

import { fingerprintCandidate } from "../event-pipeline/contract";
import type { RegistrationCandidate } from "../event-pipeline/contract";
import { runRegistrationPipeline } from "../registration-pipeline/contract";
import { acquireLock, releaseLock } from "../../execution/process-lock/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import type { ReserveAndRegisterResult } from "./types";

export function reserveAndRegister(candidate: RegistrationCandidate, storeFactory: () => RegistryStore, correlationId: string, holderId: string, leaseMs: number = 30_000): ReserveAndRegisterResult {
  const fingerprint = fingerprintCandidate(candidate);
  const lockKey = `CAPABILITY_FINGERPRINT:${fingerprint.semantic}`;

  const lock = acquireLock({ lock_key: lockKey, holder_id: holderId, lease_ms: leaseMs });
  if (lock.status !== "ACQUIRED") {
    return { reservation_outcome: "RESERVATION_CONFLICT", held_by: lock.held_by?.holder_id ?? null, pipeline_result: null };
  }

  try {
    // Fresh, authoritative construction — strictly inside the locked section, never before.
    const store = storeFactory();
    const pipelineResult = runRegistrationPipeline(candidate, store, correlationId);
    return { reservation_outcome: "RESERVED_AND_REGISTERED", held_by: null, pipeline_result: pipelineResult };
  } finally {
    releaseLock(lockKey, holderId);
  }
}
