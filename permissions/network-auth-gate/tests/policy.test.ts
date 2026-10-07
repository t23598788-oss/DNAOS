/**
 * หน้าที่: the real test for ../policy.ts. Proves the required cases from
 * this gate's own design finding (2026-08-24, fail-closed correction): no
 * token + non-loopback bind -> refused; wrong token -> rejected; correct
 * token -> accepted; no secret + loopback -> unchanged/allowed.
 *
 * How to run: npx tsx permissions/network-auth-gate/tests/policy.test.ts
 */

import { verifySharedSecret, evaluateBindPolicy, isLoopbackHost } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- evaluateBindPolicy: the fail-closed proof ---

test("non-loopback bind + no secret -> refused (fail-closed)", () => {
  const decision = evaluateBindPolicy("0.0.0.0", undefined);
  assert(decision.allowed === false, "must refuse to start");
});

test("non-loopback bind + empty-string secret -> refused (fail-closed, not just undefined)", () => {
  const decision = evaluateBindPolicy("0.0.0.0", "");
  assert(decision.allowed === false, "empty secret must not count as configured");
});

test("loopback bind + no secret -> allowed (today's real, unchanged Mac behavior)", () => {
  assert(evaluateBindPolicy("127.0.0.1", undefined).allowed === true, "127.0.0.1 must still be allowed with no secret");
  assert(evaluateBindPolicy("::1", undefined).allowed === true, "::1 must still be allowed with no secret");
  assert(evaluateBindPolicy("localhost", undefined).allowed === true, "localhost must still be allowed with no secret");
});

test("non-loopback bind + real secret -> allowed (enforced per-request instead)", () => {
  const decision = evaluateBindPolicy("0.0.0.0", "real-secret-value");
  assert(decision.allowed === true, "a configured secret must permit a non-loopback bind");
});

test("isLoopbackHost matches exactly the three loopback forms", () => {
  assert(isLoopbackHost("127.0.0.1") === true, "127.0.0.1");
  assert(isLoopbackHost("::1") === true, "::1");
  assert(isLoopbackHost("localhost") === true, "localhost");
  assert(isLoopbackHost("0.0.0.0") === false, "0.0.0.0 must not be treated as loopback");
  assert(isLoopbackHost("example.com") === false, "arbitrary host must not be treated as loopback");
});

// --- verifySharedSecret: the per-request proof ---

const REAL_SECRET = "s3cr3t-real-value-do-not-guess";

test("correct token -> accepted", () => {
  assert(verifySharedSecret(`Bearer ${REAL_SECRET}`, REAL_SECRET) === true, "matching bearer token must verify");
});

test("wrong token -> rejected", () => {
  assert(verifySharedSecret("Bearer wrong-value", REAL_SECRET) === false, "mismatched token must not verify");
});

test("wrong-length token -> rejected, never throws", () => {
  assert(verifySharedSecret("Bearer short", REAL_SECRET) === false, "shorter token must not verify");
  assert(verifySharedSecret(`Bearer ${REAL_SECRET}-extra-long-suffix`, REAL_SECRET) === false, "longer token must not verify");
});

test("missing Authorization header -> rejected", () => {
  assert(verifySharedSecret(undefined, REAL_SECRET) === false, "no header must not verify");
});

test("non-Bearer scheme -> rejected", () => {
  assert(verifySharedSecret(`Basic ${REAL_SECRET}`, REAL_SECRET) === false, "non-Bearer scheme must not verify");
});

test("empty Bearer value -> rejected", () => {
  assert(verifySharedSecret("Bearer ", REAL_SECRET) === false, "empty token must not verify");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
