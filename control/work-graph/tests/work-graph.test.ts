/**
 * หน้าที่: real proof for Phase 4.2's extension of `../derive.ts` — the
 * typed `worker_class` mapping and the three new companion work kinds
 * (IMPLEMENT, REPAIR, RESOLVE_DEPENDENCY). Pure — builds synthetic
 * `CapabilityRecord`s directly, no filesystem/census I/O, so it can assert
 * the derivation logic exhaustively and fast.
 *
 * How to run: npx tsx control/work-graph/tests/work-graph.test.ts
 */
import { deriveWorkGraph, workerClassFor, workIdFor } from "../contract";
import type { WorkKind } from "../contract";
import type { CapabilityRecord } from "../../../software/live-census/contract";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n      ${JSON.stringify(detail)}`); }
}

function fixture(overrides: Partial<CapabilityRecord>): CapabilityRecord {
  return {
    path: "fixture/target",
    current_status: "UNVERIFIED",
    status_reason: "",
    registration_state: "UNREGISTERED",
    runtime_status: "NOT_APPLICABLE",
    source_digest: "digest-a",
    test_files: [],
    dependencies: [],
    evidence_references: [],
    lineage: [],
    ...overrides,
  } as CapabilityRecord;
}

function main(): void {
  // ===== workerClassFor: the one mapping the whole typed system depends on =====
  const expected: Record<WorkKind, string> = {
    VERIFY_CAPABILITY: "DETERMINISTIC_TEST",
    WIRE_OR_RETIRE: "REASONING_INTEGRATION",
    REPAIR: "REPAIR_AGENT",
    IMPLEMENT: "IMPLEMENTATION_AGENT",
    RESOLVE_DEPENDENCY: "DEPENDENCY_RESOLUTION_AGENT",
    EXTERNAL: "DEPENDENCY_RESOLUTION_AGENT",
  };
  for (const [kind, cls] of Object.entries(expected)) {
    check(`workerClassFor(${kind}) === ${cls}`, workerClassFor(kind as WorkKind) === cls);
  }

  // ===== IMPLEMENT: DECLARED_ONLY now produces real work, not a silent skip =====
  {
    const caps = [fixture({ path: "a/declared-only", current_status: "DECLARED_ONLY", status_reason: "folder contains documentation/data but no .ts/.mjs implementation" })];
    const graph = deriveWorkGraph(caps);
    const item = graph.items.find((i) => i.work_id === workIdFor("IMPLEMENT", "a/declared-only"));
    check("IMPLEMENT item is derived for a DECLARED_ONLY capability", item !== undefined, graph.items);
    check("IMPLEMENT item's worker_class is IMPLEMENTATION_AGENT", item?.worker_class === "IMPLEMENTATION_AGENT");
    check("IMPLEMENT item is READY when nothing holds its scope", item?.state === "READY");
    check("no VERIFY_CAPABILITY item is ALSO derived for a DECLARED_ONLY capability (still exactly one work item)", graph.items.filter((i) => i.target === "a/declared-only").length === 1, graph.items);
  }

  // ===== REPAIR: a companion to a genuinely FAILED VERIFY_CAPABILITY item =====
  {
    const caps = [fixture({ path: "b/failed-cap", current_status: "FAILED", status_reason: "3 passed, 1 failed", test_files: ["b/failed-cap/tests/x.test.ts"] })];
    const graph = deriveWorkGraph(caps);
    const verify = graph.items.find((i) => i.work_id === workIdFor("VERIFY_CAPABILITY", "b/failed-cap"));
    const repair = graph.items.find((i) => i.work_id === workIdFor("REPAIR", "b/failed-cap"));
    check("VERIFY_CAPABILITY sibling stays BLOCKED (re-running identical failing code is not new evidence)", verify?.state === "BLOCKED" && verify.blocked_by.includes("PRIOR_ATTEMPT:FAILED"), verify);
    check("REPAIR companion item is derived", repair !== undefined, graph.items);
    check("REPAIR item's worker_class is REPAIR_AGENT", repair?.worker_class === "REPAIR_AGENT");
    check("REPAIR item is READY (same write_scope as its VERIFY sibling, but nothing holds it)", repair?.state === "READY");
    check("REPAIR shares the exact write_scope of its VERIFY sibling — they can never run concurrently", JSON.stringify(repair?.write_scope) === JSON.stringify(verify?.write_scope));
  }

  // ===== RESOLVE_DEPENDENCY: only for a genuinely STUCK dependency, never an ordinary not-yet-reached one =====
  {
    const stuckDep = fixture({ path: "c/stuck-dep", current_status: "FAILED" });
    const normalDep = fixture({ path: "c/normal-dep", current_status: "UNVERIFIED" });
    const consumer = fixture({ path: "c/consumer", current_status: "UNVERIFIED", dependencies: ["c/stuck-dep", "c/normal-dep"] });
    const graph = deriveWorkGraph([stuckDep, normalDep, consumer]);
    const resolveItem = graph.items.find((i) => i.work_id === workIdFor("RESOLVE_DEPENDENCY", "c/consumer"));
    check("RESOLVE_DEPENDENCY item is derived when a dependency is genuinely FAILED", resolveItem !== undefined, graph.items);
    check("RESOLVE_DEPENDENCY only names the STUCK dependency, not the merely-unverified one", resolveItem !== undefined && resolveItem.depends_on.length === 1 && resolveItem.depends_on[0] === workIdFor("VERIFY_CAPABILITY", "c/stuck-dep"), resolveItem);
    check("RESOLVE_DEPENDENCY item's worker_class is DEPENDENCY_RESOLUTION_AGENT", resolveItem?.worker_class === "DEPENDENCY_RESOLUTION_AGENT");

    const allNormalCaps = [fixture({ path: "d/dep1" }), fixture({ path: "d/consumer2", dependencies: ["d/dep1"] })];
    const graph2 = deriveWorkGraph(allNormalCaps);
    const noResolve = graph2.items.find((i) => i.work_id === workIdFor("RESOLVE_DEPENDENCY", "d/consumer2"));
    check("no RESOLVE_DEPENDENCY item when the dependency is merely not-yet-verified (self-resolving, no agent needed)", noResolve === undefined, graph2.items);
  }

  // ===== RESOLVE_DEPENDENCY: EXTERNAL blockers get a real investigation item with no write_scope =====
  {
    const caps = [fixture({ path: "e/external-blocked" })];
    const graph = deriveWorkGraph(caps, new Set(), [{ target: "e/external-blocked", reason: "EXTERNAL: credential not provided" }]);
    const extResolve = graph.items.find((i) => i.work_id === workIdFor("RESOLVE_DEPENDENCY", "external:e/external-blocked"));
    check("RESOLVE_DEPENDENCY item derived for an EXTERNAL blocker", extResolve !== undefined, graph.items);
    check("EXTERNAL RESOLVE_DEPENDENCY item declares NO write_scope (investigation only)", extResolve?.write_scope.length === 0);
    check("EXTERNAL RESOLVE_DEPENDENCY item is READY (nothing to hold a boundary that does not exist)", extResolve?.state === "READY");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) (process as unknown as { exitCode: number }).exitCode = 1;
}

main();
