// Real acceptance test for the Workspace Lock Manager + Resource Migration
// Engine. Run with: npx tsx local-runtime/workspace-acceptance-test.ts
import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { acquireLock, releaseLock } from "@/engines/workspace/lockManager";
import { analyzeImpact } from "@/engines/workspace/dependencyRegistry";
import { createMigrationPlan } from "@/engines/workspace/migrationEngine";
import { fileURLToPath } from "url";
import { dirname } from "path";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(PROJECT_DIR, ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function testConcurrentLock() {
  const resourcePath = `test-resource-${Date.now()}.json`;
  // Two "sessions" race for the exact same resource at the exact same time —
  // real concurrency via Promise.all, not sequential calls.
  const [a, b] = await Promise.all([
    acquireLock(db, "registry", resourcePath, "session-A@test", "sess-A"),
    acquireLock(db, "registry", resourcePath, "session-B@test", "sess-B"),
  ]);
  const winners = [a, b].filter((r) => r.acquired);
  const losers = [a, b].filter((r) => !r.acquired);
  console.log(`[test 1] concurrent lock race: winners=${winners.length} losers=${losers.length}`);
  if (winners.length !== 1) throw new Error(`FAIL: expected exactly 1 winner, got ${winners.length}`);
  if (losers.length !== 1) throw new Error(`FAIL: expected exactly 1 loser, got ${losers.length}`);
  if (!losers[0].conflict) throw new Error("FAIL: loser has no conflict info recorded");
  console.log(`  PASS — winner=${winners[0].lock?.holder_actor}, loser correctly rejected with conflict={held_by=${losers[0].conflict?.held_by_actor}}`);

  const { data: conflictRow } = await db.from("workspace_lock_conflicts").select("*").eq("resource_path", resourcePath).maybeSingle();
  if (!conflictRow) throw new Error("FAIL: no audit row written for the conflict");
  console.log(`  PASS — conflict audit row exists: id=${conflictRow.id}`);

  if (winners[0].lock) await releaseLock(db, winners[0].lock.id);
}

async function testDependencyBlock() {
  // A real file with a REAL dependent in registry/architecture-book.json —
  // pick something guaranteed to be imported by other modules.
  const resourcePath = "core/shared/types.ts";
  const impact = analyzeImpact(resourcePath);
  console.log(`[test 2] dependency analysis on ${resourcePath}: ${impact.dependency_count} real dependents found`);
  if (impact.dependency_count === 0) throw new Error("FAIL: expected real dependents for core/shared/types.ts, found none");
  if (impact.safe_to_migrate) throw new Error("FAIL: safe_to_migrate should be false when dependents exist");
  console.log(`  PASS — safe_to_migrate=false as required`);

  const plan = await createMigrationPlan(db, resourcePath, "file", "acceptance-test");
  console.log(`[test 2b] migration plan created: id=${plan.id} status=${plan.status} safe=${plan.safe}`);
  if (plan.safe) throw new Error("FAIL: plan.safe should be false");
  if (plan.status !== "blocked") throw new Error(`FAIL: expected status=blocked, got ${plan.status}`);

  const { data: blocks } = await db.from("resource_migration_blocks").select("*").eq("plan_id", plan.id);
  if (!blocks || blocks.length === 0) throw new Error("FAIL: no resource_migration_blocks rows written");
  console.log(`  PASS — plan correctly blocked, ${blocks.length} block record(s) written to audit`);
}

async function testNoDependentIsSafe() {
  // A resource with zero known dependents in either graph — real absence of evidence, not fabricated.
  const resourcePath = "definitely-does-not-exist-in-any-graph.tmp";
  const impact = analyzeImpact(resourcePath);
  console.log(`[test 3] dependency analysis on an untracked path: ${impact.dependency_count} dependents`);
  if (!impact.safe_to_migrate) throw new Error("FAIL: expected safe_to_migrate=true for a resource with zero real dependents");
  console.log(`  PASS — safe_to_migrate=true correctly, with 0 fabricated dependents`);
}

async function main() {
  await testConcurrentLock();
  await testDependencyBlock();
  await testNoDependentIsSafe();
  console.log("\nALL ACCEPTANCE TESTS PASSED");
}

main().catch((e) => { console.error("ACCEPTANCE TEST FAILED:", e); process.exit(1); });
