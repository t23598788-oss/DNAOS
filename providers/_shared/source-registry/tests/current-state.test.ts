/**
 * หน้าที่: Section 13's explicit acceptance test — "ทดสอบ source mutation
 * ด้วย fixture/mock upstream: VALUE_A -> refresh -> VALUE_B. ต้องพิสูจน์ว่า
 * DNA OS consumer เห็น VALUE_B และ VALUE_A ไม่ถูกใช้งานเป็น current state
 * อีก." Uses a fixture/mock upstream (never a real DigitalOcean/Hostinger
 * call) with an injectable `FetchFn`, proving `resolveCurrentState`'s
 * real INVALIDATE -> FETCH NEW -> VERIFY -> REPLACE -> PROPAGATE line.
 *
 * How to run: npx tsx providers/_shared/source-registry/tests/current-state.test.ts
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCurrentState, peekCurrentState, __resetCurrentStateMemoryForTests } from "../current-state";
import { listChangeLog } from "../change-log";
import type { SourcePointer } from "../types";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${name} -> ${error instanceof Error ? error.message : String(error)}`);
  }
}

const testSource: SourcePointer = {
  provider_id: "test_provider",
  source_id: "test_source_mutation_fixture",
  source_type: "PRODUCT_PAGE",
  official_location: "https://fixture.invalid/mutation-test",
  access_method: "WEB",
  authority: "OFFICIAL",
  freshness_mode: "POLL",
  verification_method: "SHA256_FINGERPRINT",
  feeds: [{ feeds_into: "test_provider.pricing.current_state", relationship_kind: "CURRENT_STATE_INPUT" }],
  relationships: [],
  last_checked_at: null,
  current_state_reference: "test_provider.pricing.current_state",
};

const VALUE_A = "PRICE=10USD/hr FIXTURE UPSTREAM VALUE A";
const VALUE_B = "PRICE=12USD/hr FIXTURE UPSTREAM VALUE B — mutated";

async function main(): Promise<void> {
  __resetCurrentStateMemoryForTests();
  const tmpDir = mkdtempSync(join(tmpdir(), "dna-os-current-state-test-"));

  let currentUpstreamValue = VALUE_A;
  const fixtureFetch = async (_url: string) => ({ status: 200, text: currentUpstreamValue });

  const first = await resolveCurrentState(testSource, fixtureFetch, tmpDir);
  check("first resolve: INITIAL_BASELINE, consumer sees VALUE_A", () => {
    assert(first.change_type === "INITIAL_BASELINE", `expected INITIAL_BASELINE, got ${first.change_type}`);
    assert(first.normalized_value === VALUE_A, `expected VALUE_A, got ${first.normalized_value}`);
  });

  const second = await resolveCurrentState(testSource, fixtureFetch, tmpDir);
  check("second resolve, same upstream: NO_CHANGE, still VALUE_A", () => {
    assert(second.change_type === "NO_CHANGE", `expected NO_CHANGE, got ${second.change_type}`);
    assert(second.normalized_value === VALUE_A, `expected VALUE_A, got ${second.normalized_value}`);
  });

  // Mutate the fixture upstream — VALUE_A -> VALUE_B.
  currentUpstreamValue = VALUE_B;

  const third = await resolveCurrentState(testSource, fixtureFetch, tmpDir);
  check("third resolve after upstream mutation: CONTENT_CHANGED, consumer now sees VALUE_B", () => {
    assert(third.change_type === "CONTENT_CHANGED", `expected CONTENT_CHANGED, got ${third.change_type}`);
    assert(third.normalized_value === VALUE_B, `expected VALUE_B, got ${third.normalized_value}`);
  });

  check("in-memory current state now holds VALUE_B, VALUE_A is fully replaced (never used again)", () => {
    const peeked = peekCurrentState(testSource.source_id);
    assert(peeked !== undefined, "current state must exist after a successful resolve");
    assert(peeked!.normalized_value === VALUE_B, `expected in-memory state to be VALUE_B, got ${peeked!.normalized_value}`);
    assert(peeked!.normalized_value !== VALUE_A, "VALUE_A must not still be the stored current state after mutation");
  });

  const fourth = await resolveCurrentState(testSource, fixtureFetch, tmpDir);
  check("fourth resolve, upstream stable at VALUE_B: NO_CHANGE, consumer still sees VALUE_B (not VALUE_A)", () => {
    assert(fourth.change_type === "NO_CHANGE", `expected NO_CHANGE, got ${fourth.change_type}`);
    assert(fourth.normalized_value === VALUE_B, `expected VALUE_B, got ${fourth.normalized_value}`);
  });

  check("change-log persisted ONLY metadata — no VALUE_A/VALUE_B text anywhere on disk", () => {
    const rows = listChangeLog(tmpDir);
    assert(rows.length === 4, `expected 4 change-log rows, got ${rows.length}`);
    const serialized = JSON.stringify(rows);
    assert(!serialized.includes(VALUE_A), "change-log must never contain the raw fixture content (VALUE_A)");
    assert(!serialized.includes(VALUE_B), "change-log must never contain the raw fixture content (VALUE_B)");
    assert(rows[0].change_type === "INITIAL_BASELINE" && rows[1].change_type === "NO_CHANGE" && rows[2].change_type === "CONTENT_CHANGED" && rows[3].change_type === "NO_CHANGE", `unexpected change_type sequence: ${rows.map((r) => r.change_type).join(",")}`);
    assert(rows[2].old_fingerprint !== null && rows[2].new_fingerprint !== null && rows[2].old_fingerprint !== rows[2].new_fingerprint, "the CONTENT_CHANGED row must show old_fingerprint !== new_fingerprint");
  });

  rmSync(tmpDir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("ALL CHECKS PASSED");
  }
}

void main();
