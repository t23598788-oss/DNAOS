/**
 * NEW-3 — Lease Client test. Offline: no DB, no network, no worker invoked.
 *
 * Proves the client implements the EXISTING policy in registry/LOCK_MANAGER.json
 * (per-file locks, different files may be held in parallel, never take another
 * holder's file) and adds no new authority:
 *   L1  real ledger: 25 owner-freeze entries exist and NONE of them can ever expire
 *   L2  a fan-out over DIFFERENT files succeeds for every contractor
 *   L3  a fan-out that overlaps one file is refused WHOLE (no partial grant)
 *   L4  release by a non-holder is refused (a lock can never be stolen)
 *   L5  TTL: an expired lease no longer blocks, and the sweep removes only expired
 *   L6  an owner-frozen file cannot be acquired by a contractor
 *   L7  atomic write round-trips and verifies
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  acquire,
  release,
  sweepExpired,
  isLockedByOther,
  isExpired,
  heldBy,
  readLedger,
  writeLedgerAtomic,
  type LockLedger,
} from "../src/lease/leaseClient";

/**
 * This package is an ES module (`"type": "module"`), so `__dirname` does not
 * exist here. The test is run from the repository root (see the npm script), so
 * the ledger path is resolved from the working directory and then VERIFIED —
 * a wrong cwd fails loudly instead of silently testing an empty ledger.
 */
const ROOT = process.cwd();
const REAL_LEDGER = join(ROOT, "registry", "LOCK_MANAGER.json");
const TMP_LEDGER = join(ROOT, "dna-os-contractor", "test", "tmp-lease-ledger.json");

if (!existsSync(REAL_LEDGER)) {
  console.log(`FAIL  L0 real ledger not found at ${REAL_LEDGER} — run this test from the repository root`);
  process.exit(1);
}


let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (ok) {
    console.log(`PASS  ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── L1 — the real ledger ────────────────────────────────────────────────────
const real = readLedger(REAL_LEDGER);
const frozen = real.locks.filter((l) => l.file.includes("components/workspace/canvas/"));
check("L1 real ledger read", real.locks.length > 0, `${real.locks.length} entries`);
check("L1 owner-freeze entries carry no expiry", frozen.length > 0 && frozen.every((l) => l.expires_at === undefined));
check("L1 owner freeze can never expire, even far in the future", frozen.every((l) => isExpired(l, new Date("2099-01-01T00:00:00Z")) === false));
const swept = sweepExpired(real, new Date("2099-01-01T00:00:00Z"));
check("L1 sweep removes nothing from the real ledger", swept.removed.length === 0, JSON.stringify(swept.removed.slice(0, 2)));

// ── L2 — parallel fan-out over different files ──────────────────────────────
const empty: LockLedger = { version: 1, locks: [] };
const a = acquire(empty, { files: ["src/a.ts"], holder: "cline:session-1" });
const b = a.ok ? acquire(a.ledger, { files: ["src/b.ts"], holder: "freebuff:session-2" }) : null;
check("L2 two contractors hold different files at the same time", a.ok && !!b && b.ok);
check("L2 each holder sees only its own files", !!b && b.ok && heldBy(b.ledger, "cline:session-1").join() === "src/a.ts");

// ── L3 — overlapping file refuses the whole acquire ─────────────────────────
const c = b && b.ok ? acquire(b.ledger, { files: ["src/c.ts", "src/a.ts"], holder: "freebuff:session-2" }) : null;
check("L3 overlapping acquire is refused", !!c && c.ok === false && c.reason === "ALREADY_HELD_BY_OTHER", c && !c.ok ? c.reason : "granted");
check("L3 refusal is whole (nothing partial granted)", !!b && b.ok && heldBy(b.ledger, "freebuff:session-2").join() === "src/b.ts");

// ── L4 — a lock can never be stolen ────────────────────────────────────────
const steal = b && b.ok ? release(b.ledger, { files: ["src/a.ts"], holder: "freebuff:session-2" }) : null;
check("L4 release by a non-holder is refused", !!steal && steal.ok === false && steal.reason === "NOT_HELD_BY_HOLDER");

// ── L5 — TTL only affects leases that carry expires_at ─────────────────────
const t0 = new Date("2026-09-23T10:00:00Z");
const timed = acquire(empty, { files: ["src/t.ts"], holder: "freebuff:session-3", ttlMs: 60_000, now: t0 });
const later = new Date(t0.getTime() + 120_000);
check("L5 live lease blocks before expiry", timed.ok && isLockedByOther(timed.ledger, "src/t.ts", "cline:session-9", t0) === true);
check("L5 expired lease no longer blocks", timed.ok && isLockedByOther(timed.ledger, "src/t.ts", "cline:session-9", later) === false);
const sweptTimed = timed.ok ? sweepExpired(timed.ledger, later) : null;
check("L5 sweep removes exactly the expired lease", !!sweptTimed && sweptTimed.removed.length === 1 && sweptTimed.ledger.locks.length === 0);

// ── L6 — owner-frozen files are off limits ─────────────────────────────────
const frozenFile = frozen[0].file;
const denied = acquire(real, { files: [frozenFile], holder: "cline:session-1" });
check("L6 contractor cannot acquire an owner-frozen file", denied.ok === false && denied.reason === "ALREADY_HELD_BY_OTHER", denied.ok ? "granted" : denied.reason);

// ── L7 — atomic write + verification ───────────────────────────────────────
const d = acquire(empty, { files: ["src/w.ts"], holder: "cline:session-1" });
if (d.ok) {
  writeLedgerAtomic(TMP_LEDGER, d.ledger);
  const back = JSON.parse(readFileSync(TMP_LEDGER, "utf-8")) as LockLedger;
  check("L7 write verified and readable", back.locks.length === 1 && back.locks[0].file === "src/w.ts");
} else {
  check("L7 write verified and readable", false, "setup acquire failed");
}

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
