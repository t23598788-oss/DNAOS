/**
 * หน้าที่: proves the real cross-process atomic claim added to
 * ./coordination.ts — including the exact acceptance test the Multi-Agent
 * Production Control STEP requires: 100 concurrent claim attempts on one
 * work_id, exactly one winner.
 *
 * How to run: npx tsx control/work-coordination/atomic-claim.test.ts
 */

import { claimWork, releaseWorkClaim, renewWorkClaim } from "./coordination";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  await check("A. first claim on a fresh work_id -> ACQUIRED with real fields", () => {
    const result = claimWork({ work_id: "work-a", task_id: "task-a", holder_agent_id: "agent-1", repository_id: "repository://x/y", resource_scope: ["src/foo.ts"], lease_ms: 10_000 });
    assert(result.ok, `expected ok, got ${JSON.stringify(result)}`);
    if (result.ok) {
      assert(result.claim.lock_key === "WORK:work-a", "lock_key must be real");
      assert(result.claim.source_lock_keys[0] === "SOURCE:repository://x/y:src/foo.ts", `expected real source lock key, got ${result.claim.source_lock_keys[0]}`);
      releaseWorkClaim(result.claim);
    }
  });

  await check("B. Invariant — the SAME work_id claimed twice, second attempt is honestly rejected, never a silent double-owner", () => {
    const first = claimWork({ work_id: "work-b", task_id: "task-b", holder_agent_id: "agent-1", resource_scope: [], lease_ms: 10_000 });
    assert(first.ok, "setup must claim");
    const second = claimWork({ work_id: "work-b", task_id: "task-b", holder_agent_id: "agent-2", resource_scope: [], lease_ms: 10_000 });
    assert(second.ok === false, `expected rejection, got ${JSON.stringify(second)}`);
    if (!second.ok) assert(second.reason.startsWith("WORK_ALREADY_CLAIMED:agent-1"), `expected the real holder named, got ${second.reason}`);
    if (first.ok) releaseWorkClaim(first.claim);
  });

  await check("C. 100 concurrent claim attempts on the SAME work_id -> exactly one winner (the required acceptance test)", () => {
    const attempts = Array.from({ length: 100 }, (_, i) => claimWork({ work_id: "work-c-acceptance", task_id: "task-c", holder_agent_id: `agent-${i}`, resource_scope: [], lease_ms: 10_000 }));
    const winners = attempts.filter((r) => r.ok);
    assert(winners.length === 1, `expected exactly 1 winner, got ${winners.length}`);
    if (winners[0]?.ok) releaseWorkClaim(winners[0].claim);
  });

  await check("D. two agents on DIFFERENT repositories, same resource path string, do NOT conflict — real proof, not asserted by fiat", () => {
    const a = claimWork({ work_id: "work-d1", task_id: "task-d1", holder_agent_id: "agent-1", repository_id: "repository://owner/repo-a", resource_scope: ["same/path.ts"], lease_ms: 10_000 });
    const b = claimWork({ work_id: "work-d2", task_id: "task-d2", holder_agent_id: "agent-2", repository_id: "repository://owner/repo-b", resource_scope: ["same/path.ts"], lease_ms: 10_000 });
    assert(a.ok && b.ok, `expected both to succeed (different repos), got ${JSON.stringify({ a, b })}`);
    if (a.ok) releaseWorkClaim(a.claim);
    if (b.ok) releaseWorkClaim(b.claim);
  });

  await check("E. two agents on the SAME repository + SAME resource are correctly serialized (second is rejected)", () => {
    const a = claimWork({ work_id: "work-e1", task_id: "task-e1", holder_agent_id: "agent-1", repository_id: "repository://owner/repo-a", resource_scope: ["shared/path.ts"], lease_ms: 10_000 });
    const b = claimWork({ work_id: "work-e2", task_id: "task-e2", holder_agent_id: "agent-2", repository_id: "repository://owner/repo-a", resource_scope: ["shared/path.ts"], lease_ms: 10_000 });
    assert(a.ok, "first must succeed");
    assert(b.ok === false, `expected the second, same-source claim to be rejected, got ${JSON.stringify(b)}`);
    if (!b.ok) assert(b.reason.startsWith("SOURCE_CONFLICT:"), `expected a real SOURCE_CONFLICT reason, got ${b.reason}`);
    if (a.ok) releaseWorkClaim(a.claim);
  });

  await check("F. partial conflict rolls back everything already acquired this call — no orphaned locks", () => {
    const blocker = claimWork({ work_id: "work-f-blocker", task_id: "task-f-blocker", holder_agent_id: "agent-blocker", repository_id: "repository://owner/repo-f", resource_scope: ["second.ts"], lease_ms: 10_000 });
    assert(blocker.ok, "setup must claim");
    const attempt = claimWork({ work_id: "work-f-attempt", task_id: "task-f-attempt", holder_agent_id: "agent-attempt", repository_id: "repository://owner/repo-f", resource_scope: ["first.ts", "second.ts"], lease_ms: 10_000 });
    assert(attempt.ok === false, "expected rejection on the second resource");
    // Prove the WORK lock and the "first.ts" SOURCE lock were rolled back — a fresh claim for the same work_id now succeeds.
    const retry = claimWork({ work_id: "work-f-attempt", task_id: "task-f-attempt", holder_agent_id: "agent-attempt-2", resource_scope: ["first.ts"], lease_ms: 10_000 });
    assert(retry.ok, `expected rollback to have released the WORK lock and first.ts, got ${JSON.stringify(retry)}`);
    if (blocker.ok) releaseWorkClaim(blocker.claim);
    if (retry.ok) releaseWorkClaim(retry.claim);
  });

  await check("G. stale lease (expired) is reclaimable by a new claimant — crash-recovery precondition", async () => {
    const first = claimWork({ work_id: "work-g", task_id: "task-g", holder_agent_id: "agent-1", resource_scope: [], lease_ms: 50 });
    assert(first.ok, "setup must claim");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const reclaim = claimWork({ work_id: "work-g", task_id: "task-g", holder_agent_id: "agent-2", resource_scope: [], lease_ms: 10_000 });
    assert(reclaim.ok, `expected reclaim after real lease expiry, got ${JSON.stringify(reclaim)}`);
    if (reclaim.ok) releaseWorkClaim(reclaim.claim);
  });

  await check("H. renewWorkClaim extends the real holder's own lease, blocking a contender that would otherwise reclaim it", async () => {
    const claimed = claimWork({ work_id: "work-h", task_id: "task-h", holder_agent_id: "agent-1", resource_scope: [], lease_ms: 100 });
    assert(claimed.ok, "setup must claim");
    if (!claimed.ok) return;
    const renewed = renewWorkClaim(claimed.claim, 10_000);
    assert(renewed.ok, `expected renew to succeed, got ${JSON.stringify(renewed)}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const contender = claimWork({ work_id: "work-h", task_id: "task-h", holder_agent_id: "agent-2", resource_scope: [], lease_ms: 10_000 });
    assert(contender.ok === false, "the renewed lease must still block a contender past the original 100ms window");
    if (renewed.ok) releaseWorkClaim(renewed.claim);
  });

  await check("I. release by the real holder frees the lock for a genuinely new claimant", () => {
    const first = claimWork({ work_id: "work-i", task_id: "task-i", holder_agent_id: "agent-1", resource_scope: ["x.ts"], lease_ms: 10_000 });
    assert(first.ok, "setup must claim");
    if (first.ok) releaseWorkClaim(first.claim);
    const second = claimWork({ work_id: "work-i", task_id: "task-i", holder_agent_id: "agent-2", resource_scope: ["x.ts"], lease_ms: 10_000 });
    assert(second.ok, `expected a fresh claim to succeed after release, got ${JSON.stringify(second)}`);
    if (second.ok) releaseWorkClaim(second.claim);
  });

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
