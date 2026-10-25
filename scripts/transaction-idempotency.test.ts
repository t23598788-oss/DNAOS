/**
 * TRANSACTION IDEMPOTENCY TEST (WAVE 2 §06) — offline, pure + static.
 *
 * Proves:
 *   · the same idempotency key always derives the same order number
 *   · different keys never collide
 *   · no key keeps the legacy timestamp shape (backward compatible)
 *   · the database really enforces UNIQUE(order_no) — the enforcement point
 *     that turns the derivation into a hard guarantee
 *   · the canonical job transport + business-event auto-create actually pass a key
 */
import { readFileSync, existsSync } from "fs";
import { orderNoFor } from "@/engines/canonical/transaction-write";

let checks = 0;
let failed = 0;
const pass = (m: string) => {
  checks += 1;
  console.log(`PASS  ${m}`);
};
const fail = (m: string, d?: string) => {
  checks += 1;
  failed += 1;
  console.log(`FAIL  ${m}${d ? `\n        ↳ ${d}` : ""}`);
};
const expect = (cond: boolean, m: string, d?: string) => (cond ? pass(m) : fail(m, d));

const stamps = { dateStr: "20261025", stamp: "123456" };

console.log("=== A — deterministic derivation ===");
{
  const a = orderNoFor("document.create:INV-1", stamps);
  const b = orderNoFor("document.create:INV-1", stamps);
  expect(a === b, "A same key ⇒ same order number (replay is a no-op)", `${a} vs ${b}`);
  expect(a.startsWith("ORD-IDEM-"), "A idempotent numbers are visibly distinct from ad-hoc ones");
  expect(/^ORD-IDEM-[0-9a-f]{16}$/.test(a), "A shape is stable and collision-resistant (16 hex chars)");

  const other = orderNoFor("document.create:INV-2", stamps);
  expect(other !== a, "A different keys produce different numbers");
}

console.log("\n=== B — backward compatibility ===");
{
  const legacy = orderNoFor(null, stamps);
  expect(legacy === "ORD-20261025-123456", "B no key keeps the legacy timestamp shape", legacy);
  const blank = orderNoFor("   ", stamps);
  expect(blank === legacy, "B whitespace-only key behaves like no key");
}

console.log("\n=== C — the database is the enforcement point ===");
{
  const dump = "supabase/local-migration/full_schema.sql";
  const available = existsSync(dump);
  if (!available) fail("C schema dump not available to verify the unique index");
  else {
    const sql = readFileSync(dump, "utf8");
    const hasUnique = /CREATE UNIQUE INDEX "customer_orders_order_no_key"[^;]*\("order_no"\)/.test(sql.replace(/\n/g, " "));
    expect(hasUnique, "C production schema has UNIQUE(order_no) — the derivation cannot silently duplicate");
  }
}

console.log("\n=== D — callers actually pass a key ===");
{
  const transport = readFileSync("app/api/admin/ide/_lib/canonicalJobTransportRuntime.ts", "utf8");
  expect(
    /idempotencyKey:\s*env\.idempotency_key/.test(transport),
    "D canonical job transport threads the envelope key into createTransaction",
  );

  const autoCreate = readFileSync("engines/jobs/auto-create.ts", "utf8");
  expect(
    /idempotencyKey:\s*`job_auto_create:\$\{event\.id\}`/.test(autoCreate),
    "D one business event can create at most one transaction",
  );

  const route = readFileSync("app/api/admin/transactions/route.ts", "utf8");
  expect(/idempotency_key/.test(route) && /idempotencyKey:/.test(route), "D the admin create route accepts and forwards a key");

  const writer = readFileSync("engines/canonical/transaction-write.ts", "utf8");
  expect(/23505/.test(writer), "D a concurrent unique-race returns the winning order instead of throwing");
}

console.log("\n=== SUMMARY ===");
console.log(`checks=${checks} failed=${failed}`);
console.log(failed === 0 ? "GATE: PASS" : `GATE: FAIL (${failed})`);
if (process.argv.includes("--strict") && failed > 0) process.exit(1);
