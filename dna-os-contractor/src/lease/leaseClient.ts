/**
 * DNA OS Contractor — Lease Client (NEW-3).
 *
 * The CODE side of the policy already written down in registry/LOCK_MANAGER.json:
 * "Per-file lock ledger … multiple agents may hold locks simultaneously as long
 * as they lock different files. Lock only the files you are actively modifying,
 * never the whole project." This file implements exactly that policy — it does
 * NOT define a second locking authority, and it never grants a lock the ledger
 * policy would refuse.
 *
 * Ownership boundary:
 *   - the LEDGER (registry/LOCK_MANAGER.json) is the single source of truth
 *   - this client is the only thing that should write it (workers ask the
 *     coordinator; they never edit the ledger themselves)
 *   - every function is pure over a ledger VALUE except writeLedgerAtomic()
 *
 * TTL rule (grounded in the real file): the live ledger's 25 entries carry only
 * file/held_by/acquired_at — no expiry. Those are OWNER FREEZES and must never
 * be swept. TTL therefore applies ONLY to entries carrying an explicit
 * `expires_at`, which this client adds when acquiring with a ttlMs.
 *
 * Honest limitation: a JSON file has no OS-level lock, so two processes could
 * race between read and write. Guard rails: write-then-reread verification plus
 * the rule that only the coordinator writes the ledger. A true cross-process
 * mutex would need an OS lock, which is not portable.
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";

export interface LockEntry {
  file: string;
  held_by: string;
  acquired_at: string;
  /** Present only for leases this client created; owner freeze entries have none. */
  expires_at?: string;
}

export interface LockLedger {
  version: number;
  protocol?: string;
  note?: string;
  rule?: string;
  locks: LockEntry[];
}

export interface LeaseHandle {
  holder: string;
  files: string[];
  acquired_at: string;
  expires_at: string | null;
}

export type AcquireResult =
  | { ok: true; ledger: LockLedger; lease: LeaseHandle }
  | { ok: false; reason: "ALREADY_HELD_BY_OTHER"; conflicts: LockEntry[] };

export type ReleaseResult =
  | { ok: true; ledger: LockLedger; released: string[] }
  | { ok: false; reason: "NOT_HELD_BY_HOLDER"; notYours: LockEntry[] };

const iso = (d: Date): string => d.toISOString();

export function readLedger(path: string): LockLedger {
  if (!existsSync(path)) return { version: 1, locks: [] };
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as LockLedger;
  if (!Array.isArray(parsed.locks)) parsed.locks = [];
  return parsed;
}

export function isExpired(entry: LockEntry, now: Date = new Date()): boolean {
  if (!entry.expires_at) return false; // owner freezes never expire
  return Date.parse(entry.expires_at) <= now.getTime();
}

/** True when the file is held by a DIFFERENT agent/session (expired leases don't block). */
export function isLockedByOther(ledger: LockLedger, file: string, holder: string, now: Date = new Date()): boolean {
  return ledger.locks.some((l) => l.file === file && l.held_by !== holder && !isExpired(l, now));
}

/**
 * Acquire a per-file lease. All-or-nothing: if ANY target file is held by
 * another holder (and not expired), nothing is granted — never a partial lock
 * that would leave a half-locked workspace behind.
 */
export function acquire(
  ledger: LockLedger,
  input: { files: string[]; holder: string; ttlMs?: number | null; now?: Date },
): AcquireResult {
  const now = input.now ?? new Date();
  const { ledger: swept } = sweepExpired(ledger, now);
  const files = [...new Set(input.files)];
  const conflicts = swept.locks.filter((l) => files.includes(l.file) && l.held_by !== input.holder);
  if (conflicts.length > 0) return { ok: false, reason: "ALREADY_HELD_BY_OTHER", conflicts };

  const expires_at = input.ttlMs && input.ttlMs > 0 ? iso(new Date(now.getTime() + input.ttlMs)) : null;
  const kept = swept.locks.filter((l) => !files.includes(l.file));
  const next: LockLedger = {
    ...swept,
    locks: [
      ...kept,
      ...files.map((file) => ({
        file,
        held_by: input.holder,
        acquired_at: iso(now),
        ...(expires_at ? { expires_at } : {}),
      })),
    ],
  };
  return { ok: true, ledger: next, lease: { holder: input.holder, files, acquired_at: iso(now), expires_at } };
}

/** Release only the files this holder actually holds (never another holder's entry). */
export function release(ledger: LockLedger, input: { files: string[]; holder: string }): ReleaseResult {
  const files = [...new Set(input.files)];
  const notYours = ledger.locks.filter((l) => files.includes(l.file) && l.held_by !== input.holder);
  if (notYours.length > 0) return { ok: false, reason: "NOT_HELD_BY_HOLDER", notYours };
  const released = ledger.locks.filter((l) => files.includes(l.file)).map((l) => l.file);
  return { ok: true, ledger: { ...ledger, locks: ledger.locks.filter((l) => !files.includes(l.file)) }, released };
}

/** Files a holder currently holds (non-expired) — the fan-out safety check. */
export function heldBy(ledger: LockLedger, holder: string, now: Date = new Date()): string[] {
  return ledger.locks.filter((l) => l.held_by === holder && !isExpired(l, now)).map((l) => l.file);
}

/**
 * Write the ledger back: temp file + rename (the atomic-ish step available on
 * every platform), then re-read and verify what landed. Coordinator only.
 */
export function writeLedgerAtomic(path: string, ledger: LockLedger): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n", "utf-8");
  renameSync(tmp, path);
  const back = readLedger(path);
  if (back.locks.length !== ledger.locks.length) {
    throw new Error(`LEASE_LEDGER_WRITE_UNVERIFIED: expected ${ledger.locks.length} locks, read back ${back.locks.length}`);
  }
}

export function sweepExpired(ledger: LockLedger, now: Date = new Date()): { ledger: LockLedger; removed: LockEntry[] } {
  const removed = ledger.locks.filter((l) => isExpired(l, now));
  if (removed.length === 0) return { ledger, removed };
  return { ledger: { ...ledger, locks: ledger.locks.filter((l) => !isExpired(l, now)) }, removed };
}
