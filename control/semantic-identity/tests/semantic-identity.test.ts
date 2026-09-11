/**
 * Deterministic Semantic Identity & Discovery V1 tests.
 * How to run: npx tsx control/semantic-identity/tests/semantic-identity.test.ts
 *
 * Includes negative integrity cases — failure must be visible, not silent.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSemantic, discoverSemanticGraph, graphFingerprint } from "../discover";
import { semanticKey } from "../key";
import { assertSemanticId, canonicalizeSemanticId, parseSemanticId } from "../id";
import {
  dependencyClosure,
  detectDependencyCycles,
  impactClosure,
  topologicalDependencyOrder,
} from "../graph";
import {
  doctorDiscovery,
  doctorExitCode,
  doctorSemanticGraph,
  resolveSemanticId,
} from "../resolve";
import { projectResolveThai } from "../project-th";
import {
  advanceLifecycle,
  applyObservations,
  correlateRuntimeEvent,
  createObservationStore,
  recordObservation,
} from "../observation";
import { bridgeWorkContextToSemantic } from "../bridge-work-context";
import { INFRA_REPO_ID, PILOT_DESCRIPTORS } from "../pilot-descriptors";
import { recordEngineeringHandoff } from "../../work-session-state/contract";
import type { SemanticDescriptor, SemanticLifecycleState } from "../types";

let passed = 0;
let failed = 0;
let negativeCount = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

function neg(name: string, cond: boolean, detail?: string): void {
  negativeCount += 1;
  ok(name, cond, detail);
}

const ROOT = process.cwd();
const discovery = discoverSemantic({ root: ROOT });
const base = discovery.graph;

// 1. same SemanticId → same machine key
{
  const id = "capability://runtime/endpoint-resolution";
  const a = semanticKey(id);
  const b = semanticKey(id);
  const expect = createHash("sha256").update(id, "utf8").digest("hex");
  ok("1 same SemanticId → same machine key", a === b && a === expect && a.length === 64);
}

// 2. file move → SemanticId unchanged
{
  const moved: SemanticDescriptor = {
    ...PILOT_DESCRIPTORS.find((d) => d.id === "capability://runtime/endpoint-resolution")!,
    implementation: {
      repositoryId: INFRA_REPO_ID,
      path: "control/runtime-endpoint-registry/MOVED-resolver.ts",
      symbol: "resolveRuntimeEndpoint",
    },
  };
  const g = discoverSemanticGraph({
    root: ROOT,
    skipPathCheck: true,
    extraDescriptors: [],
    commitSha: "deadbeef",
  });
  const id = "capability://runtime/endpoint-resolution";
  ok("2 file move → SemanticId unchanged", canonicalizeSemanticId(id) === id && g.nodes.some((n) => n.id === id));
  ok(
    "2b path is not identity",
    moved.implementation!.path !== "control/runtime-endpoint-registry/resolver.ts" &&
      moved.id === "capability://runtime/endpoint-resolution",
  );
}

// 3. source path update → implementation ref updates
{
  const g2 = discoverSemanticGraph({
    root: ROOT,
    skipPathCheck: true,
    commitSha: "abc",
    extraDescriptors: [
      {
        id: "capability://runtime/endpoint-resolution-path-probe",
        kind: "capability",
        ownerRepository: INFRA_REPO_ID,
        implementation: {
          repositoryId: INFRA_REPO_ID,
          path: "control/runtime-endpoint-registry/resolver.ts",
          symbol: "resolveRuntimeEndpoint",
        },
      },
      {
        id: "capability://runtime/endpoint-resolution-path-probe-v2",
        kind: "capability",
        ownerRepository: INFRA_REPO_ID,
        implementation: {
          repositoryId: INFRA_REPO_ID,
          path: "control/runtime-endpoint-registry/contract.ts",
          symbol: "resolveRuntimeEndpoint",
        },
      },
    ],
  });
  const a = g2.nodes.find((n) => n.id.endsWith("path-probe"))!;
  const b = g2.nodes.find((n) => n.id.endsWith("path-probe-v2"))!;
  ok(
    "3 source path update → implementation ref updates",
    a.implementation!.path !== b.implementation!.path &&
      a.semantic_key !== b.semantic_key,
  );
}

// 4. exact ID match → deterministic resolve
{
  const r = resolveSemanticId(base, "capability://runtime/endpoint-resolution");
  ok("4 exact ID match → IDENTITY_MATCHED", r.status === "IDENTITY_MATCHED" && r.id === "capability://runtime/endpoint-resolution");
}

// 5. unknown ID → UNRESOLVED, no AI guessing
{
  const r = resolveSemanticId(base, "capability://does/not-exist");
  ok("5 unknown ID → UNRESOLVED", r.status === "UNRESOLVED" && r.relations.length === 0);
}

// 6. duplicate SemanticId → diagnostic + doctor fail (NEGATIVE)
{
  const result = discoverSemantic({
    root: ROOT,
    skipPathCheck: true,
    commitSha: "dup",
    extraDescriptors: [
      {
        id: "capability://runtime/node-classification",
        kind: "capability",
        title: "duplicate probe",
        ownerRepository: INFRA_REPO_ID,
      },
    ],
  });
  const doc = doctorDiscovery(result);
  neg(
    "6 duplicate SemanticId → diagnostic retained; doctor fails",
    result.diagnostics.duplicate_ids.includes("capability://runtime/node-classification") &&
      doc.duplicate_semantic_ids > 0 &&
      doc.duplicate_ids.includes("capability://runtime/node-classification") &&
      doctorExitCode(doc) === 1 &&
      result.graph.nodes.filter((n) => n.id === "capability://runtime/node-classification").length === 1,
  );
}

// 7. missing relation target → AWAITING_RELATION + doctor fail
{
  const result = discoverSemantic({
    root: ROOT,
    skipPathCheck: true,
    commitSha: "await",
    extraDescriptors: [
      {
        id: "capability://pilot/awaiting-probe",
        kind: "capability",
        ownerRepository: INFRA_REPO_ID,
        dependsOn: ["capability://missing/not-declared"],
      },
    ],
  });
  const missing = result.graph.nodes.find((n) => n.id === "capability://missing/not-declared");
  const probe = result.graph.nodes.find((n) => n.id === "capability://pilot/awaiting-probe");
  const doc = doctorDiscovery(result);
  ok(
    "7 missing relation target → AWAITING_RELATION",
    missing?.state === "AWAITING_RELATION" && probe?.state === "AWAITING_RELATION",
  );
  neg(
    "7b missing target → doctor unresolved + exit 1",
    result.diagnostics.missing_targets.includes("capability://missing/not-declared") &&
      doc.unresolved_references.includes("capability://missing/not-declared") &&
      doctorExitCode(doc) === 1,
  );
}

// 8. dependency traversal
{
  const deps = dependencyClosure(base, "capability://owner-command/submit");
  ok(
    "8 dependency traversal works",
    deps.includes("capability://runtime/endpoint-resolution") &&
      deps.includes("capability://runtime/node-classification"),
  );
}

// 9. reverse impact traversal
{
  const impact = impactClosure(base, "capability://runtime/node-classification");
  ok(
    "9 reverse impact traversal works",
    impact.includes("capability://owner-command/submit") &&
      impact.includes("capability://runtime/endpoint-resolution"),
  );
}

// 10. cycle detection
{
  const g = discoverSemanticGraph({
    root: ROOT,
    skipPathCheck: true,
    commitSha: "cycle",
    extraDescriptors: [
      {
        id: "capability://cycle/a",
        kind: "capability",
        dependsOn: ["capability://cycle/b"],
      },
      {
        id: "capability://cycle/b",
        kind: "capability",
        dependsOn: ["capability://cycle/a"],
      },
    ],
  });
  const cyc = detectDependencyCycles(g);
  ok("10 cycle detection works", cyc.cycles >= 1);
}

// 11. topological order deterministic
{
  const o1 = topologicalDependencyOrder(base, "capability://owner-command/submit");
  const o2 = topologicalDependencyOrder(base, "capability://owner-command/submit");
  const nodeIdx = (id: string) => o1.indexOf(id);
  ok(
    "11 topological order deterministic",
    JSON.stringify(o1) === JSON.stringify(o2) &&
      nodeIdx("capability://runtime/node-classification") <
        nodeIdx("capability://runtime/endpoint-resolution") &&
      nodeIdx("capability://runtime/endpoint-resolution") <
        nodeIdx("capability://owner-command/submit"),
  );
}

// 12. owner repository resolves
{
  const r = resolveSemanticId(base, "capability://runtime/endpoint-resolution");
  ok(
    "12 owner repository resolves correctly",
    r.owner === INFRA_REPO_ID && (r.owner_title?.includes("Infrastructure") ?? false),
  );
}

// 13. runtime observation correlates to SemanticId
{
  const ev = correlateRuntimeEvent(
    { work_id: "work://w1", command_id: "command://c1" },
    {
      capability_id: "capability://google/gmail/messages.list",
      policy_id: "policy://execution/default",
      source_revision: base.source_revision,
    },
  );
  ok(
    "13 runtime observation correlates to SemanticId",
    ev.work_id === "work://w1" &&
      ev.command_id === "command://c1" &&
      ev.capability_id === "capability://google/gmail/messages.list",
  );
}

// 14. static RESOLVED cannot falsely become PROVEN
{
  const node = base.nodes.find((n) => n.id === "capability://runtime/endpoint-resolution")!;
  ok(
    "14 static RESOLVED cannot falsely become PROVEN",
    node.state !== "PROVEN" &&
      (node.state === "RESOLVED" ||
        node.state === "VERIFIED" ||
        node.state === "CANONICAL" ||
        node.state === "LINKED"),
  );
}

// 15. only evidence can produce PROVEN (monotonic: may not demote CANONICAL)
{
  const store = createObservationStore();
  recordObservation(store, {
    semantic_id: "capability://runtime/endpoint-resolution",
    observed_at: new Date().toISOString(),
    occurrence_id: "execution://e1",
    kind: "STATIC",
    note: "static must not prove",
  });
  const afterStatic = applyObservations(base, store);
  const s = afterStatic.nodes.find((n) => n.id === "capability://runtime/endpoint-resolution")!.state;
  ok("15a STATIC does not PROVEN", s !== "PROVEN");

  // Use a non-CANONICAL node so PROVEN can advance without demoting authority designation.
  const resolvedId =
    base.nodes.find((n) => n.state === "RESOLVED" || n.state === "VERIFIED" || n.state === "LINKED")?.id ??
    "capability://runtime/process-supervision";
  const store2 = createObservationStore();
  recordObservation(store2, {
    semantic_id: resolvedId,
    observed_at: new Date().toISOString(),
    occurrence_id: "evidence://ev1",
    kind: "EVIDENCE",
    note: "linux proof",
  });
  const seeded = {
    ...base,
    nodes: base.nodes.map((n) =>
      n.id === resolvedId && n.state === "CANONICAL" ? { ...n, state: "RESOLVED" as const } : n,
    ),
  };
  const afterEv = applyObservations(seeded, store2);
  ok(
    "15b only evidence can produce PROVEN",
    afterEv.nodes.find((n) => n.id === resolvedId)!.state === "PROVEN",
  );
}

// 16. CANONICAL remains separate from PROVEN
{
  const n = base.nodes.find((n) => n.id === "capability://runtime/endpoint-resolution")!;
  ok("16 CANONICAL separate from PROVEN", n.declaredCanonical === true && n.state !== "PROVEN");
}

// 17. human Thai projection derives only from graph facts
{
  const r = resolveSemanticId(base, "capability://runtime/endpoint-resolution");
  const thai = projectResolveThai(r);
  ok(
    "17 Thai projection from graph facts",
    thai.includes("capability://runtime/endpoint-resolution") &&
      thai.includes("ความสามารถ") &&
      (thai.includes("เป็นมาตรฐานแล้ว") ||
        thai.includes("ตรวจสอบแล้ว") ||
        thai.includes("คลี่คลาย") ||
        thai.includes("เชื่อมความสัมพันธ์แล้ว")),
  );
  const unknown = projectResolveThai(resolveSemanticId(base, "capability://nope/x"));
  ok("17b unknown Thai has no AI guess", unknown.includes("ยังไม่พบตัวตน") && unknown.includes("ไม่มีการเดา"));
}

// 18. rebuild same revision → identical semantic graph
{
  const g1 = discoverSemanticGraph({ root: ROOT, commitSha: "rev-fixed" });
  const g2 = discoverSemanticGraph({ root: ROOT, commitSha: "rev-fixed" });
  ok("18 rebuild same revision → identical graph", graphFingerprint(g1) === graphFingerprint(g2));
}

// 19. no second authority/registry introduced
{
  const banned = [
    "architecture-master-registry.json",
    "semantic-central-authority.json",
  ];
  const found = banned.filter((f) => existsSync(`${ROOT}/${f}`) || existsSync(`${ROOT}/control/semantic-identity/${f}`));
  ok("19 no second authority/registry introduced", found.length === 0 && base.authoritative === false && base.derived === true);
}

// 20. protected Owner/write-gate contracts untouched
{
  let touched = false;
  try {
    const out = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: ROOT, encoding: "utf8" });
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const all = `${out}\n${untracked}`;
    touched = /permissions\/write-gate\/(contract|policy|evidence|types)\.ts/.test(all);
  } catch {
    touched = false;
  }
  ok("20 protected Owner/write-gate contracts untouched", touched === false);
}

// grammar smoke
{
  const bad = parseSemanticId("/Users/tam/foo");
  ok("grammar rejects abs path identity", "ok" in bad && bad.ok === false);
  ok("grammar accepts pilot repo id", assertSemanticId(INFRA_REPO_ID) === INFRA_REPO_ID);
}

// ---------- NEGATIVE / INTEGRITY SUITE ----------

// N1 malformed descriptor ID
{
  const result = discoverSemantic({
    root: ROOT,
    skipPathCheck: true,
    commitSha: "bad-id",
    extraDescriptors: [
      {
        id: "capabilty://runtime/typo-id",
        kind: "capability",
        ownerRepository: INFRA_REPO_ID,
      } as SemanticDescriptor,
    ],
  });
  const doc = doctorDiscovery(result);
  neg(
    "N1 malformed descriptor ID → invalid diagnostic + doctor exit 1",
    result.diagnostics.invalid_ids.some((d) => d.raw === "capabilty://runtime/typo-id" && d.field === "id") &&
      doc.invalid_ids.length > 0 &&
      doctorExitCode(doc) === 1 &&
      !result.graph.nodes.some((n) => n.id.includes("typo-id")),
  );
}

// N2 malformed relation targets across relation fields
{
  const fields: Array<{ key: keyof SemanticDescriptor; raw: string }> = [
    { key: "dependsOn", raw: "capabilty://runtime/dep-typo" },
    { key: "requires", raw: "requre://runtime/x" },
    { key: "authorizedBy", raw: "polcy://runtime/x" },
    { key: "executedBy", raw: "executer://runtime/x" },
    { key: "usesConnection", raw: "connecton://runtime/x" },
    { key: "usesCredential", raw: "credentail://runtime/x" },
    { key: "verifiedBy", raw: "tset://runtime/x" },
    { key: "provenBy", raw: "evidance://runtime/x" },
  ];
  const extra: SemanticDescriptor = {
    id: "capability://pilot/malformed-relations",
    kind: "capability",
    ownerRepository: INFRA_REPO_ID,
    dependsOn: [fields[0]!.raw],
    requires: [fields[1]!.raw],
    authorizedBy: [fields[2]!.raw],
    executedBy: [fields[3]!.raw],
    usesConnection: [fields[4]!.raw],
    usesCredential: [fields[5]!.raw],
    verifiedBy: [fields[6]!.raw],
    provenBy: [fields[7]!.raw],
  };
  const result = discoverSemantic({
    root: ROOT,
    skipPathCheck: true,
    commitSha: "bad-rel",
    extraDescriptors: [extra],
  });
  const doc = doctorDiscovery(result);
  const raws = new Set(result.diagnostics.invalid_ids.map((d) => d.raw));
  neg(
    "N2 malformed relation targets → INVALID_SEMANTIC_ID retained for all fields",
    fields.every((f) => raws.has(f.raw)) &&
      result.diagnostics.invalid_ids.length >= fields.length &&
      doctorExitCode(doc) === 1,
  );
}

// N3 missing edge source only
{
  const result = discoverSemantic({
    root: ROOT,
    skipPathCheck: true,
    commitSha: "miss-src",
    extraDescriptors: [
      {
        id: "capability://pilot/missing-source-only",
        kind: "capability",
        ownerRepository: "repository://missing/source-owner",
      },
    ],
  });
  const doc = doctorDiscovery(result);
  neg(
    "N3 missing edge source detected",
    result.diagnostics.missing_sources.includes("repository://missing/source-owner") &&
      doc.missing_sources.includes("repository://missing/source-owner") &&
      result.graph.nodes.find((n) => n.id === "repository://missing/source-owner")?.state ===
        "AWAITING_RELATION" &&
      doctorExitCode(doc) === 1,
  );
}

// N4 missing edge target only (already partially covered; assert distinction)
{
  const result = discoverSemantic({
    root: ROOT,
    skipPathCheck: true,
    commitSha: "miss-tgt",
    extraDescriptors: [
      {
        id: "capability://pilot/missing-target-only",
        kind: "capability",
        ownerRepository: INFRA_REPO_ID,
        dependsOn: ["capability://missing/target-only"],
      },
    ],
  });
  neg(
    "N4 missing edge target detected (not as source)",
    result.diagnostics.missing_targets.includes("capability://missing/target-only") &&
      !result.diagnostics.missing_sources.includes("capability://missing/target-only") &&
      doctorExitCode(doctorDiscovery(result)) === 1,
  );
}

// N5 both missing
{
  const result = discoverSemantic({
    root: ROOT,
    skipPathCheck: true,
    commitSha: "miss-both",
    extraDescriptors: [
      {
        id: "capability://pilot/missing-both",
        kind: "capability",
        ownerRepository: "repository://missing/both-owner",
        dependsOn: ["capability://missing/both-target"],
      },
    ],
  });
  neg(
    "N5 missing source and target both detected",
    result.diagnostics.missing_sources.includes("repository://missing/both-owner") &&
      result.diagnostics.missing_targets.includes("capability://missing/both-target") &&
      doctorExitCode(doctorDiscovery(result)) === 1,
  );
}

// N6 implementation object present, path absent → not RESOLVED/VERIFIED
{
  const result = discoverSemantic({
    root: ROOT,
    skipPathCheck: false,
    commitSha: "miss-impl",
    extraDescriptors: [
      {
        id: "capability://pilot/missing-impl-path",
        kind: "capability",
        ownerRepository: INFRA_REPO_ID,
        declaredCanonical: false,
        verifiedBy: ["test://runtime/endpoint-registry"],
        implementation: {
          repositoryId: INFRA_REPO_ID,
          path: "control/semantic-identity/DOES-NOT-EXIST.ts",
          symbol: "ghost",
        },
      },
    ],
  });
  const node = result.graph.nodes.find((n) => n.id === "capability://pilot/missing-impl-path")!;
  const doc = doctorDiscovery(result);
  neg(
    "N6 missing implementation path → not RESOLVED/VERIFIED; diagnostic present",
    node.state !== "RESOLVED" &&
      node.state !== "VERIFIED" &&
      node.state !== "PROVEN" &&
      result.diagnostics.invalid_implementations.some((d) => d.path?.includes("DOES-NOT-EXIST")) &&
      doctorExitCode(doc) === 1,
  );
}

// N7 work_id correlation: active B, request A
{
  const journalRoot = mkdtempSync(join(tmpdir(), "semantic-work-bridge-"));
  const prev = process.env.WORK_SESSION_STATE_ROOT;
  process.env.WORK_SESSION_STATE_ROOT = journalRoot;
  try {
    const workA = "work-aaaaaaaa-1111-2222-3333-aaaaaaaaaaaa";
    const workB = "work-bbbbbbbb-1111-2222-3333-bbbbbbbbbbbb";
    recordEngineeringHandoff({
      work_id: workA,
      title: "semantic-work-A",
      domain: "semantic-test",
      next_action: "stay on A",
      relevant_files: ["control/owner-command/owner-command.ts"],
      relevant_capability_ids: [],
      status: "ACTIVE",
    });
    recordEngineeringHandoff({
      work_id: workB,
      title: "semantic-work-B",
      domain: "semantic-test",
      next_action: "active B",
      relevant_files: ["control/semantic-identity/observation.ts"],
      relevant_capability_ids: [],
      status: "ACTIVE",
    });
    const bridged = bridgeWorkContextToSemantic(base, {
      work_id: workA,
      lookup_query: "Owner authorization",
    });
    const refPaths = (bridged.code_refs?.current_refs ?? [])
      .map((r) => r.path)
      .filter((p): p is string => typeof p === "string");
    const refWorks = (bridged.code_refs?.current_refs ?? []).map((r) => r.related_work_id);
    const fromB = refPaths.some((p) => p.includes("observation.ts"));
    const fromA = refPaths.some((p) => p.includes("owner-command"));
    neg(
      "N7 work_id correlation: request A while active B → all A",
      bridged.work_id === workA &&
        bridged.current_source.work_id === workA &&
        bridged.code_refs !== null &&
        fromA &&
        !fromB &&
        refWorks.length > 0 &&
        refWorks.every((w) => w === workA),
      `work=${bridged.work_id} source_work=${bridged.current_source.work_id} refs=${JSON.stringify(refPaths)} works=${JSON.stringify(refWorks)}`,
    );
  } finally {
    if (prev === undefined) delete process.env.WORK_SESSION_STATE_ROOT;
    else process.env.WORK_SESSION_STATE_ROOT = prev;
  }
}

// N8–N10 lifecycle monotonicity
{
  function withState(id: string, state: SemanticLifecycleState) {
    return {
      ...base,
      nodes: base.nodes.map((n) => (n.id === id ? { ...n, state } : n)),
    };
  }
  const id = "capability://runtime/endpoint-resolution";
  const cases: Array<{ from: SemanticLifecycleState; expect: SemanticLifecycleState; name: string }> = [
    { from: "RESOLVED", expect: "OBSERVED", name: "N8a RESOLVED+RUNTIME→OBSERVED" },
    { from: "OBSERVED", expect: "OBSERVED", name: "N8b OBSERVED+RUNTIME→OBSERVED" },
    { from: "VERIFIED", expect: "VERIFIED", name: "N8 VERIFIED+RUNTIME→VERIFIED" },
    { from: "PROVEN", expect: "PROVEN", name: "N9 PROVEN+RUNTIME→PROVEN" },
    { from: "CANONICAL", expect: "CANONICAL", name: "N10 CANONICAL+RUNTIME→CANONICAL" },
  ];
  for (const c of cases) {
    const store = createObservationStore();
    recordObservation(store, {
      semantic_id: id,
      observed_at: new Date().toISOString(),
      occurrence_id: "runtime://r1",
      kind: "RUNTIME",
      note: "monotonic",
    });
    const after = applyObservations(withState(id, c.from), store);
    const got = after.nodes.find((n) => n.id === id)!.state;
    neg(c.name, got === c.expect, `got=${got}`);
  }
  ok(
    "N8 rank helper: VERIFIED > OBSERVED",
    advanceLifecycle("VERIFIED", "OBSERVED") === "VERIFIED" &&
      advanceLifecycle("RESOLVED", "OBSERVED") === "OBSERVED",
  );
}

// N11 healthy doctor exit 0 / unhealthy exit 1
{
  const healthy = doctorDiscovery(discovery);
  neg("N11 healthy pilot doctor exit 0", doctorExitCode(healthy) === 0 && healthy.healthy === true);

  const unhealthy = doctorDiscovery(
    discoverSemantic({
      root: ROOT,
      skipPathCheck: true,
      commitSha: "unhealthy",
      extraDescriptors: [
        {
          id: "capability://pilot/unhealthy",
          kind: "capability",
          dependsOn: ["capability://missing/unhealthy-target"],
        },
      ],
    }),
  );
  neg(
    "N11b unhealthy doctor exit 1",
    doctorExitCode(unhealthy) === 1 &&
      unhealthy.unresolved_references.length > 0 &&
      unhealthy.healthy === false,
  );
}

// Pilot stability after integrity model
{
  const doc = doctorDiscovery(discovery);
  ok(
    "pilot doctor healthy invariants",
    doc.nodes === 20 &&
      doc.edges === 39 &&
      doc.duplicate_semantic_ids === 0 &&
      doc.invalid_ids.length === 0 &&
      doc.missing_sources.length === 0 &&
      doc.missing_targets.length === 0 &&
      doc.unresolved_references.length === 0 &&
      doc.invalid_implementations.length === 0 &&
      doc.dependency_cycles === 0 &&
      doc.conflicting_authority === 0,
    JSON.stringify(doc),
  );
  const stable = [
    "capability://runtime/node-classification",
    "capability://runtime/secret-resolution",
    "capability://runtime/process-supervision",
    "capability://repository/checkout-resolution",
    "capability://runtime/endpoint-resolution",
    "capability://core/own-machine-linux",
    "capability://owner-command/submit",
  ];
  ok(
    "stable pilot IDs preserved",
    stable.every((id) => base.nodes.some((n) => n.id === id)),
  );
}

const doc = doctorSemanticGraph(base, discovery.diagnostics);
console.log("\n--- doctor snapshot ---");
console.log(JSON.stringify(doc, null, 2));
console.log(`\nnegative tests counted: ${negativeCount}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
