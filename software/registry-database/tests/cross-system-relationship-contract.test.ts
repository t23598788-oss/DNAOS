/**
 * หน้าที่: proves the cross-system relationship extension is backward
 * compatible with the real 180 canonical rows, and that every type-pair the
 * promotion gap inventory demanded now validates, round-trips through an
 * ISOLATED fixture, and resolves evidence in both directions.
 *
 * Reads production canonical data READ-ONLY. Writes only to a temp fixture
 * directory that it creates and removes. Never writes data/canonical/.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RelationshipRow } from "../types";
import type { CrossSystemRelationshipRow, CrossSystemEvidenceRow } from "../cross-system-types";
import {
  logicalRelationshipId, validateCrossSystemRelationship, readLegacyRelationship,
  evidenceForRelationship, relationshipForEvidence, confirmRelationship,
  CROSS_SYSTEM_TYPE_PAIRS, SUPPORTED_ENTITY_TYPES,
} from "../cross-system-relationships";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  -> " + detail : "")); }
};

const CANON = join(__dirname, "..", "data", "canonical");
const jl = <T,>(f: string): T[] =>
  readFileSync(join(CANON, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);

// ---------------- 11. BACKWARD COMPATIBILITY ----------------
console.log("\n11. Backward compatibility against the real canonical rows");
{
  // relationships.jsonl is append-only. Pipe 2 appended route bindings after
  // the original 180, so this asserts the LEGACY PREFIX is intact rather than a
  // fixed total that legitimate additive writes would break.
  const all = jl<RelationshipRow>("relationships.jsonl");
  const legacy = all.slice(0, 180);
  ok("legacy 180-row prefix present", legacy.length === 180, String(all.length));

  const read = legacy.map(readLegacyRelationship);
  ok("all rows readable through extended model", read.length === legacy.length);
  ok("relationship_id preserved", read.every((r, i) => r.relationship_id === legacy[i].relationship_id));
  ok("semantics preserved (from/to/kind identical)", read.every((r, i) =>
    r.from_type === legacy[i].from_type && r.from_id === legacy[i].from_id &&
    r.to_type === legacy[i].to_type && r.to_id === legacy[i].to_id &&
    r.relationship_kind === legacy[i].relationship_kind && r.created_at === legacy[i].created_at));
  ok("no duplicates created", new Set(read.map((r) => r.relationship_id)).size === 180);
  ok("appended rows carry distinct ids", new Set(all.map((r) => r.relationship_id)).size === all.length, `${new Set(all.map((r) => r.relationship_id)).size}/${all.length}`);
  ok("legacy entity types still supported", legacy.every((r) => SUPPORTED_ENTITY_TYPES.includes(r.from_type) && SUPPORTED_ENTITY_TYPES.includes(r.to_type)));
  ok("absent lifecycle fields stay UNKNOWN, not back-filled", read.every((r) => r.state === undefined && r.evidence_refs === undefined));
  const validated = read.map((r) => validateCrossSystemRelationship(r));
  ok("all 180 validate (legacy ids exempt from logical-id rule)", validated.every((v) => v.valid), JSON.stringify(validated.find((v) => !v.valid)?.errors ?? []));
}

// ---------------- 9. VERSION / COMMIT GAP ----------------
console.log("\n9. commit_sha UNKNOWN preserved, never fabricated");
{
  const versions = jl<{ commit_sha: string | null }>("versions.jsonl");
  const nulls = versions.filter((v) => v.commit_sha === null).length;
  // เจตนาของ invariant นี้คือ "ห้ามเติม commit_sha ย้อนหลัง" ไม่ใช่ "จำนวนเวอร์ชันต้องไม่เปลี่ยน"
  // การลงทะเบียนเพิ่มอย่างถูกต้องย่อมทำให้จำนวนเพิ่มได้ แต่ทุกแถวต้องยังเป็น null
  // (ยึดจำนวนตายตัวไว้เดิม 589 ทำให้เทสต์แตกตอน Phase 2 ลงทะเบียน owner-display-projection
  //  ทั้งที่ไม่มี commit_sha ถูกกุขึ้นแม้แถวเดียว)
  ok("ทุกเวอร์ชันยังคง commit_sha = null (SOURCE_REVISION_UNRESOLVED ไม่ถูกกลบ)",
    nulls === versions.length && versions.length >= 589, `${nulls}/${versions.length}`);
  const r: CrossSystemRelationshipRow = {
    relationship_id: "", from_type: "RESOURCE", from_id: "resource-x",
    relationship_kind: "RESOURCE_HAS_VERSION", to_type: "VERSION", to_id: "version-x",
    created_at: "2026-08-31T00:00:00.000Z", source_authority: "DNA_OS_REGISTRY",
  };
  r.relationship_id = logicalRelationshipId(r);
  ok("RESOURCE -> VERSION expressible without any commit data", validateCrossSystemRelationship(r).valid);
}

// ---------------- 12. NEW MODEL TEST, isolated fixture ----------------
console.log("\n12. Required real type-pairs: validate + write + read back (isolated fixture)");
const fixture = mkdtempSync(join(tmpdir(), "dnaos-xsys-fixture-"));
try {
  const now = "2026-08-31T12:00:00.000Z";
  const mk = (from_type: string, kind: string, to_type: string, from_id: string, to_id: string, extra: Partial<CrossSystemRelationshipRow> = {}): CrossSystemRelationshipRow => {
    const base = { from_type, from_id, relationship_kind: kind, to_type, to_id, scope: extra.scope ?? null } as never;
    return {
      relationship_id: logicalRelationshipId(base), from_type, from_id, relationship_kind: kind, to_type, to_id,
      created_at: now, state: "ACTIVE", source_authority: "DNA_OS_REGISTRY", evidence_refs: [], revision: 1, ...extra,
    } as CrossSystemRelationshipRow;
  };

  // Real identities taken from measured evidence.
  const rows: CrossSystemRelationshipRow[] = [
    mk("APPLICATION", "APPLICATION_HAS_REPOSITORY", "REPOSITORY", "DNA_OS_CONTROL", "t23598788-oss/-DNA-OS-INFRASTRUCTURE-", { source_authority: "GITHUB" }),
    mk("REPOSITORY", "REPOSITORY_HAS_SOURCE_FILE", "SOURCE_FILE", "t23598788-oss/-DNA-OS-INFRASTRUCTURE-", "control/scheduler/start.ts", { source_authority: "MAC_SOURCE" }),
    mk("SOURCE_FILE", "SOURCE_FILE_BELONGS_TO_BOUNDARY", "BOUNDARY", "control/scheduler/start.ts", "control/scheduler", { source_authority: "DERIVED", rule_id: "RULE-PATH-CONTAINMENT-001" }),
    mk("RESOURCE", "RESOURCE_IMPLEMENTED_BY_SOURCE_FILE", "SOURCE_FILE", "resource-31f1c7bd-14a6-4254-a705-83517ce0de28", "connections/agent-registry/registry.ts", { source_authority: "DNA_OS_REGISTRY" }),
    mk("REPOSITORY", "REPOSITORY_DEPLOYS_TO_SERVICE", "SERVICE", "t23598788-oss/-DNA-OS-INFRASTRUCTURE-", "8d67c28f-75bb-4ead-8e7b-d4050e47afcc", { source_authority: "RAILWAY" }),
    mk("SERVICE", "SERVICE_HAS_DEPLOYMENT", "DEPLOYMENT", "c08254e4-9679-4984-b388-402f7909bf47", "ac0150a1-0e85-4a8d-8712-d55913b147e5", { source_authority: "RAILWAY" }),
    mk("APPLICATION", "APPLICATION_USES_DATABASE_PROJECT", "DATABASE_PROJECT", "DNA_OS_DEADBOARD", "xeytcavxejhyzxwevgto", { source_authority: "SUPABASE" }),
    mk("SOURCE_FILE", "SOURCE_REFERENCES_DATABASE_OBJECT", "DATABASE_OBJECT", "app/api/admin/documents/route.ts", "xeytcavxejhyzxwevgto.public.invoices", { source_authority: "DERIVED", rule_id: "RULE-DB-LITERAL-001" }),
    mk("RUNTIME", "RUNTIME_EXECUTES_RESOURCE", "RESOURCE", "process:3442", "resource-31f1c7bd-14a6-4254-a705-83517ce0de28", { source_authority: "RUNTIME" }),
    mk("PROVIDER_PROJECT", "PROVIDER_PROJECT_HAS_SERVICE", "SERVICE", "ffe589bf-58fb-4e3e-8969-4a75915fda1a", "c08254e4-9679-4984-b388-402f7909bf47", { source_authority: "RAILWAY" }),
    mk("EXECUTION", "EXECUTION_RUNS_PROCESS", "PROCESS", "execution://research-engine/exec-fixture", "process://research-engine/exec-fixture", { source_authority: "RUNTIME" }),
    mk("EXECUTION", "EXECUTION_HAS_RESEARCH_RUN", "RESEARCH_RUN", "execution://research-engine/exec-fixture", "research_run://research-engine/run-fixture", { source_authority: "RUNTIME" }),
    mk("RESEARCH_RUN", "RESEARCH_RUN_HAS_METRIC", "METRIC", "research_run://research-engine/run-fixture", "metric://research-engine/run-fixture/latency", { source_authority: "RUNTIME" }),
    mk("RESEARCH_RUN", "RESEARCH_RUN_HAS_COST", "COST", "research_run://research-engine/run-fixture", "cost://research-engine/exec-fixture", { source_authority: "RUNTIME" }),
    mk("RESEARCH_RUN", "RESEARCH_RUN_HAS_DECISION", "DECISION", "research_run://research-engine/run-fixture", "decision://research-engine/run-fixture", { source_authority: "RUNTIME" }),
    mk("METRIC", "METRIC_HAS_EVIDENCE", "EVIDENCE", "metric://research-engine/run-fixture/latency", "evidence://research-engine/evidence-fixture", { source_authority: "RUNTIME" }),
    mk("COST", "COST_HAS_EVIDENCE", "EVIDENCE", "cost://research-engine/exec-fixture", "evidence://research-engine/evidence-fixture", { source_authority: "RUNTIME" }),
    mk("DECISION", "DECISION_HAS_EVIDENCE", "EVIDENCE", "decision://research-engine/run-fixture", "evidence://research-engine/evidence-fixture", { source_authority: "RUNTIME" }),
    mk("PROCESS", "PROCESS_HAS_EVIDENCE", "EVIDENCE", "process://research-engine/exec-fixture", "evidence://research-engine/evidence-fixture", { source_authority: "RUNTIME" }),
  ];

  const invalid = rows.map((r) => ({ r, v: validateCrossSystemRelationship(r) })).filter((x) => !x.v.valid);
  ok(`all ${rows.length} required type-pairs validate`, invalid.length === 0, JSON.stringify(invalid[0]?.v.errors ?? []));

  // write + read back through the isolated fixture
  const relPath = join(fixture, "relationships.jsonl");
  writeFileSync(relPath, rows.map((r) => JSON.stringify(r)).join("\n"));
  const back = readFileSync(relPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as CrossSystemRelationshipRow);
  ok("round-trips through fixture without loss", back.length === rows.length && back.every((r, i) => r.relationship_id === rows[i].relationship_id));
  ok("deterministic identity is stable across recomputation", back.every((r) => r.relationship_id === logicalRelationshipId(r)));

  // idempotency: same logical edge observed twice
  const again = mk("SERVICE", "SERVICE_HAS_DEPLOYMENT", "DEPLOYMENT", "c08254e4-9679-4984-b388-402f7909bf47", "ac0150a1-0e85-4a8d-8712-d55913b147e5", { source_authority: "RAILWAY" });
  ok("repeat observation yields the SAME logical id", again.relationship_id === rows[5].relationship_id);
  const confirmed = confirmRelationship(rows[5], "2026-08-31T13:00:00.000Z", "ev-railway-2");
  ok("repeat observation updates lineage, not a new edge", confirmed.relationship_id === rows[5].relationship_id && confirmed.revision === 2 && confirmed.evidence_refs!.includes("ev-railway-2"));

  // ---------------- 6. RELATIONSHIP <-> EVIDENCE, both directions ----------------
  console.log("\n6. Relationship <-> evidence readback");
  const evidence: CrossSystemEvidenceRow[] = [
    { evidence_id: "evidence-xsys-1", evidence_ref: "railway:deployment:ac0150a1", evidence_type: "PROVIDER_OBSERVATION", related_resource_id: null, related_capability_id: null, related_relationship_id: rows[5].relationship_id, created_at: now },
    { evidence_id: "evidence-legacy-1", evidence_ref: "resources.jsonl", evidence_type: "REGISTRY", related_resource_id: "resource-31f1c7bd-14a6-4254-a705-83517ce0de28", related_capability_id: null, created_at: now },
  ];
  writeFileSync(join(fixture, "evidence.jsonl"), evidence.map((e) => JSON.stringify(e)).join("\n"));
  ok("relationship -> evidence resolves", evidenceForRelationship(rows[5].relationship_id, evidence).length === 1);
  ok("evidence -> relationship resolves", relationshipForEvidence("evidence-xsys-1", evidence, rows)?.relationship_id === rows[5].relationship_id);
  ok("legacy resource evidence linkage still intact", evidence[1].related_resource_id !== null && evidence[1].related_relationship_id === undefined);

  // ---------------- 10. CONTRACT VALIDATION: rejects, never coerces ----------------
  console.log("\n10. Invalid input is rejected, not coerced");
  const badType = validateCrossSystemRelationship({ ...rows[0], from_type: "SPREADSHEET" as never });
  ok("unknown entity type rejected", !badType.valid);
  const badPair = validateCrossSystemRelationship({ ...rows[0], to_type: "DEPLOYMENT" as never });
  ok("disallowed type-pair rejected", !badPair.valid);
  const badDerived = validateCrossSystemRelationship({ ...rows[2], rule_id: null });
  ok("DERIVED without rule_id rejected", !badDerived.valid);
  const badClaim = validateCrossSystemRelationship({ ...rows[5], source_authority: "AGENT_REPORT", state: "ACTIVE" });
  ok("AGENT_REPORT claim cannot be ACTIVE", !badClaim.valid);
  const badTime = validateCrossSystemRelationship({ ...rows[0], created_at: "31/08/2026" });
  ok("non-ISO timestamp rejected", !badTime.valid);
  const unresolved = validateCrossSystemRelationship(rows[0], { identityExists: () => false });
  ok("unresolved identity rejected when checker supplied", !unresolved.valid);

  // ---------------- 8. STATE lifecycle ----------------
  console.log("\n8. Lifecycle: history is not erased");
  const stale = confirmRelationship(rows[5], "2026-09-01T00:00:00.000Z", "ev-railway-3", "STALE");
  ok("deployment no longer active becomes STALE, edge retained", stale.state === "STALE" && stale.relationship_id === rows[5].relationship_id);

  console.log("\n   vocabulary: entity types =", SUPPORTED_ENTITY_TYPES.length, "| cross-system type-pairs =", CROSS_SYSTEM_TYPE_PAIRS.length);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail > 0) process.exit(1);
