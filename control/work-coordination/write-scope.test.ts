/**
 * หน้าที่: the real test for `./write-scope.ts`. Drives the REAL
 * `claimWriteScope`/`releaseWriteScope`/`listWriteLocks` against the REAL
 * `../../execution/process-lock/` filesystem mutex — no fakes, no injected
 * clock, no stubbed lock store. Case F spawns genuinely separate OS processes.
 *
 * The case that matters is B: before `./write-scope.ts` existed, a probe proved
 * that `claimWork`'s exact-string SOURCE keys let one agent hold the folder
 * `control/command-router` while another simultaneously held the file
 * `control/command-router/router.ts`. B is that exact scenario, and it must now
 * be refused.
 *
 * Run: npx tsx control/work-coordination/write-scope.test.ts
 * (node 24.19.0 per .nvmrc — the default shell node v16 cannot run this.)
 */

import { claimWriteScope, releaseWriteScope, renewWriteScope, listWriteLocks, normalizeScopePath, scopesOverlap } from "./contract";
import type { WriteScopeClaim } from "./contract";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}`);
    if (detail !== undefined) console.log(`      ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
}

const REPO = "dna-os-infrastructure";
/** Unique per run so a previous crashed run's leftover locks can never make this test lie. */
const NS = `test-write-scope-${process.pid}-${Date.now()}`;
const held: WriteScopeClaim[] = [];

function claim(holder: string, scopes: string[], leaseMs = 60_000) {
  const result = claimWriteScope({ work_id: `${NS}-${holder}`, holder_agent_id: `${NS}-${holder}`, repository_id: REPO, write_scope: scopes, lease_ms: leaseMs });
  if (result.ok) held.push(result.claim);
  return result;
}

function releaseAll(): void {
  while (held.length > 0) releaseWriteScope(held.pop()!);
}

async function main(): Promise<void> {
  // ---- pure helpers: segment-boundary correctness ----
  check("A1. normalizeScopePath strips leading/trailing slashes and '.' segments", normalizeScopePath("/control/./x/") === "control/x", normalizeScopePath("/control/./x/"));
  check("A2. normalizeScopePath REFUSES a '..' escape rather than normalizing it away", normalizeScopePath("control/../../etc") === null);
  check("A3. scopesOverlap is segment-aware: 'command-router' does NOT contain 'command-router-legacy'", scopesOverlap("control/command-router", "control/command-router-legacy") === false);
  check("A4. scopesOverlap detects real containment in both directions",
    scopesOverlap("control/x", "control/x/y.ts") && scopesOverlap("control/x/y.ts", "control/x"));

  // ---- B: THE REGRESSION. The exact hole claimWork left open. ----
  const folder = claim("agentA", [`${NS}/control/command-router`]);
  check("B1. agent A claims a FOLDER boundary", folder.ok, folder.ok ? "" : folder.reason);
  const fileInside = claim("agentB", [`${NS}/control/command-router/router.ts`]);
  check("B2. agent B claiming a FILE INSIDE that folder is REFUSED (the hole claimWork left open)",
    !fileInside.ok && fileInside.reason.startsWith("OVERLAPPING_SCOPE_HELD:"),
    fileInside.ok ? "ACQUIRED — overlapping boundaries held simultaneously" : fileInside.reason);
  const sibling = claim("agentC", [`${NS}/control/command-router-legacy`]);
  check("B3. a SIBLING whose name merely shares a prefix is still allowed (no over-blocking)", sibling.ok, sibling.ok ? "" : sibling.reason);

  // ---- C: reverse direction — file held first, folder above it refused ----
  releaseAll();
  const inner = claim("agentD", [`${NS}/execution/run/executor.ts`]);
  check("C1. agent D claims a FILE boundary", inner.ok, inner.ok ? "" : inner.reason);
  const outer = claim("agentE", [`${NS}/execution/run`]);
  check("C2. agent E claiming the PARENT folder is REFUSED (containment holds upward too)",
    !outer.ok && outer.reason.startsWith("OVERLAPPING_SCOPE_HELD:"),
    outer.ok ? "ACQUIRED — parent overlapped a held child" : outer.reason);

  // ---- D: all-or-nothing + caller-bug detection ----
  releaseAll();
  const first = claim("agentF", [`${NS}/a/one`]);
  const partial = claim("agentG", [`${NS}/a/two`, `${NS}/a/one`]);
  check("D1. a multi-scope claim that conflicts on ONE scope acquires NOTHING", !partial.ok, partial.ok ? "acquired despite conflict" : partial.reason);
  const retryOther = claim("agentH", [`${NS}/a/two`]);
  check("D2. the non-conflicting scope was rolled back, so another agent can still take it", retryOther.ok, retryOther.ok ? "" : retryOther.reason);
  const selfOverlap = claim("agentI", [`${NS}/b`, `${NS}/b/c`]);
  const selfOverlapReason = selfOverlap.ok ? "ACQUIRED — self-overlapping scope was not rejected" : selfOverlap.reason;
  check("D3. a caller declaring both a folder and a file inside it is told it is a caller bug, not silently collapsed",
    !selfOverlap.ok && selfOverlapReason.startsWith("SELF_OVERLAPPING_SCOPE:"), selfOverlapReason);
  void first;

  // ---- E: WRITE_LOCK_MAP is derived, and lease/renew are real ----
  releaseAll();
  const mapped = claim("agentJ", [`${NS}/observability/joint-monitor`]);
  const mapRows = listWriteLocks().filter((l) => l.scope_path.startsWith(NS));
  check("E1. listWriteLocks DERIVES the held boundary from the lock directory", mapRows.length === 1 && mapRows[0].holder_id === `${NS}-agentJ`, mapRows);
  if (mapped.ok) {
    const renewed = renewWriteScope(mapped.claim, 90_000);
    check("E2. renewWriteScope extends the real holder's own lease", renewed.ok, renewed.ok ? "" : renewed.reason);
  } else {
    check("E2. renewWriteScope extends the real holder's own lease", false, "precondition claim failed");
  }
  const expired = claim("agentK", [`${NS}/short/lease`], 1);
  await new Promise((r) => setTimeout(r, 50));
  const expiredRows = listWriteLocks().filter((l) => l.scope_path === `${NS}/short/lease`);
  check("E3. an EXPIRED lease is excluded from the map — a lease nobody renewed is not a held boundary", expiredRows.length === 0, expiredRows);
  const reclaim = claim("agentL", [`${NS}/short/lease`]);
  check("E4. an expired boundary is reclaimable by a new holder (crash recovery)", reclaim.ok, reclaim.ok ? "" : reclaim.reason);
  void expired;

  // ---- F: REAL cross-process race, not a same-process approximation ----
  releaseAll();
  const dir = mkdtempSync(join(tmpdir(), "write-scope-race-"));
  const racer = join(dir, "racer.ts");
  const contractPath = join(process.cwd(), "control/work-coordination/contract.ts");
  writeFileSync(racer, `
import { claimWriteScope } from ${JSON.stringify(contractPath)};
const holder = process.argv[2];
const scope = process.argv[3];
const r = claimWriteScope({ work_id: holder, holder_agent_id: holder, repository_id: ${JSON.stringify(REPO)}, write_scope: [scope], lease_ms: 60000 });
console.log(r.ok ? "ACQUIRED" : "REFUSED");
`);
  const parent = `${NS}/race/parent`;
  const child = `${NS}/race/parent/deep/child.ts`;
  const outcomes: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const scope = i % 2 === 0 ? parent : child;
    try {
      outcomes.push(execFileSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), racer, `${NS}-race-${i}`, scope], { encoding: "utf8", cwd: process.cwd() }).trim());
    } catch (error) {
      outcomes.push(`ERROR:${(error as { status?: number }).status ?? "?"}`);
    }
  }
  const acquiredCount = outcomes.filter((o) => o === "ACQUIRED").length;
  check("F. 12 separate OS processes race two OVERLAPPING boundaries — at most one holds at a time",
    acquiredCount === 1, { acquiredCount, outcomes });
  rmSync(dir, { recursive: true, force: true });

  // leave no test locks behind for the next run or another session
  releaseAll();
  for (const leftover of listWriteLocks().filter((l) => l.scope_path.startsWith(NS))) {
    releaseWriteScope({ holder_agent_id: leftover.holder_id, scope_lock_keys: [leftover.lock_key] });
  }
  const residue = listWriteLocks().filter((l) => l.scope_path.startsWith(NS));
  check("G. the test leaves NO lock residue behind (would otherwise block real work)", residue.length === 0, residue);
}

main().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
});
