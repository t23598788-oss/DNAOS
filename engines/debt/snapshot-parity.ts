/**
 * Snapshot parity — PURE. Is the cached `debt_snapshots.total_outstanding` still
 * the same number the canonical ledger says?
 *
 * `debt_snapshots` is a projection of `debt_events` (engines/canonical/debt-write.ts)
 * and is written only when the ledger writer runs. It drifts as soon as anything
 * else moves the balance — most importantly invoice payments, which never touch
 * the ledger. The legacy collection card reads the snapshot, so a drifted
 * snapshot is an UNVERIFIED balance, and an unverified balance must not be sent
 * to a customer.
 *
 * "Unverified" covers every case except an exact match: no snapshot row, no
 * ledger rows to compare against, or a number that cannot be read. The caller
 * must treat anything other than MATCH as a reason to suppress the card.
 */

export type SnapshotParityStatus = "MATCH" | "MISMATCH" | "NO_LEDGER" | "NO_SNAPSHOT" | "UNREADABLE";

export interface SnapshotParity {
  status: SnapshotParityStatus;
  verified: boolean;
  snapshot: number | null;
  ledger: number | null;
  delta: number | null;
  reason: string;
}

export const SNAPSHOT_TOLERANCE = 0.005;

export function compareSnapshotToLedger(input: {
  snapshot: number | null | undefined;
  ledger: number | null | undefined;
  ledgerEventCount?: number | null;
  tolerance?: number;
}): SnapshotParity {
  const tolerance = input.tolerance ?? SNAPSHOT_TOLERANCE;
  const snapshot = input.snapshot == null ? null : Number(input.snapshot);
  const ledger = input.ledger == null ? null : Number(input.ledger);

  if (snapshot !== null && !Number.isFinite(snapshot)) {
    return { status: "UNREADABLE", verified: false, snapshot: null, ledger, delta: null, reason: "snapshot is not a number" };
  }
  if (ledger !== null && !Number.isFinite(ledger)) {
    return { status: "UNREADABLE", verified: false, snapshot, ledger: null, delta: null, reason: "ledger is not a number" };
  }
  if (ledger === null) {
    return { status: "UNREADABLE", verified: false, snapshot, ledger: null, delta: null, reason: "ledger could not be read" };
  }
  if ((input.ledgerEventCount ?? null) === 0 && snapshot === null) {
    return { status: "NO_LEDGER", verified: false, snapshot, ledger, delta: null, reason: "no ledger events and no snapshot" };
  }
  if (snapshot === null) {
    return { status: "NO_SNAPSHOT", verified: false, snapshot, ledger, delta: null, reason: "ledger exists but no snapshot row" };
  }

  const delta = Math.round((snapshot - ledger) * 100) / 100;
  if (Math.abs(delta) > tolerance) {
    return {
      status: "MISMATCH",
      verified: false,
      snapshot,
      ledger,
      delta,
      reason: `snapshot ${snapshot} ≠ ledger ${ledger}`,
    };
  }
  return { status: "MATCH", verified: true, snapshot, ledger, delta, reason: "snapshot equals the ledger" };
}
