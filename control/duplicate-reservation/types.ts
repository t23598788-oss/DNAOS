/**
 * หน้าที่: type contracts for Duplicate Reservation — closes a real,
 * proven TOCTOU gap in the registration flow: `control/registration-
 * pipeline/duplicate-resolution.ts`'s own check reads the store, then
 * (separately, later) `registry-writer.ts` writes to it — two concurrent
 * candidates with the IDENTICAL fingerprint can both pass the read before
 * either write lands. This folder never re-implements duplicate
 * detection (fingerprinting/comparison logic stays exactly where it is,
 * untouched) — it only serializes concurrent attempts at the SAME
 * fingerprint through `execution/process-lock/`, so the existing,
 * unmodified duplicate check always sees a real, already-settled store
 * state by the time a second attempt runs.
 *
 * Input: none (pure type definitions).
 * Output: `ReservationOutcome`, `ReserveAndRegisterResult`.
 * Dependency ที่อนุญาต: none — leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller skip the real
 * `runRegistrationPipeline` call — reservation only ever serializes
 * access to it, never substitutes for it.
 */

import type { PipelineResult } from "../registration-pipeline/contract";

export type ReservationOutcome = "RESERVED_AND_REGISTERED" | "RESERVATION_CONFLICT";

export interface ReserveAndRegisterResult {
  reservation_outcome: ReservationOutcome;
  /** Set only when reservation_outcome=RESERVATION_CONFLICT — the real holder_id currently mid-registration for this exact fingerprint. */
  held_by: string | null;
  /** The real, unmodified control/registration-pipeline/ result — present only when reservation_outcome=RESERVED_AND_REGISTERED. */
  pipeline_result: PipelineResult | null;
}
