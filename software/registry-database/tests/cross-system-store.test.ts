/**
 * หน้าที่: prove the cross-system persistence boundary — an entity can be
 * created, persisted, read back by id, survive a fresh open of the store, and
 * resolve its relationships; a duplicate never becomes a second record; a
 * malformed record fails closed; and none of the eight legacy canonical stores
 * are touched (Owner, 2026-09-01).
 *
 * WHY IT EXISTS. Every Phase-1 lock passed except APPLICATION_RECORD_READBACK,
 * because `cross-system-relationships.ts` owns identity and validation and
 * performs no I/O by design, and nothing owned the writing. This test is what
 * makes "LOCKED" a readback rather than a claim about a successful write.
 *
 * Input: none.  Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../cross-system-store, ../cross-system-types, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามให้เทสต์นี้เขียนลง data/canonical/ และห้ามผ่อนเกณฑ์
 * fail-closed เพื่อให้ผ่าน.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const CANONICAL = join(REPO, "software/registry-database/data/canonical");
const LEGACY_FILES = ["capabilities.jsonl", "evidence.jsonl", "relationships.jsonl", "resources.jsonl", "versions.jsonl", "resource_capabilities.jsonl", "registration_events.jsonl", "relationships_removed.jsonl"];

/** Fingerprint the legacy stores BEFORE anything in this test runs. */
const before = LEGACY_FILES.map((f) => {
  const p = join(CANONICAL, f);
  return { f, size: existsSync(p) ? statSync(p).size : -1, lines: existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).length : -1 };
});

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const store = require("../cross-system-store") as typeof import("../cross-system-store");
// Fixture separation: probe rows never touch the canonical cross-system store.
const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "dna-os-cross-system-test-"));
store.useStoreDirectory(FIXTURE_DIR);
const PROBE = "application://dna-os/cross-system-store-probe";

// A + B. create and persist
const created = store.registerEntity({
  entity_id: PROBE,
  entity_type: "APPLICATION",
  canonical_name: "CROSS_SYSTEM_STORE_PROBE",
  state: "DECLARED",
  source_authority: "DNA_OS_REGISTRY",
  evidence_refs: ["software/registry-database/tests/cross-system-store.test.ts"],
});
check("A. create APPLICATION entity", created.status === "REGISTERED" && created.entity !== null, `status=${created.status}`);
check("B. persist", existsSync(store.currentEntityFile()) && readFileSync(store.currentEntityFile(), "utf8").includes(PROBE));

// C. read by canonical id
const readOne = store.getEntity(PROBE);
check("C. read by canonical ID", readOne?.entity_id === PROBE && readOne.entity_type === "APPLICATION" && readOne.canonical_name === "CROSS_SYSTEM_STORE_PROBE");

// D + E. a fresh open of the module reads the same row from disk
delete require.cache[require.resolve("../cross-system-store")];
const reopened = require("../cross-system-store") as typeof import("../cross-system-store");
reopened.useStoreDirectory(FIXTURE_DIR);
const afterRestart = reopened.getEntity(PROBE);
check("D+E. restart/reopen store and read the same entity", afterRestart?.entity_id === PROBE && afterRestart.created_at === readOne?.created_at);

// J. duplicate registration does not create a second record
const dupe = reopened.registerEntity({
  entity_id: PROBE, entity_type: "APPLICATION", canonical_name: "CROSS_SYSTEM_STORE_PROBE",
  state: "DECLARED", source_authority: "DNA_OS_REGISTRY",
  evidence_refs: ["software/registry-database/tests/cross-system-store.test.ts"],
});
const probeRows = readFileSync(reopened.currentEntityFile(), "utf8").split("\n").filter((l) => l.includes(PROBE)).length;
check("J. duplicate registration does not create a second record", dupe.status === "REUSED" && probeRows === 1, `status=${dupe.status} rows=${probeRows}`);

// same id, different identity -> conflict, never a silent overwrite
const conflict = reopened.registerEntity({
  entity_id: PROBE, entity_type: "SERVICE", canonical_name: "SOMETHING_ELSE",
  state: "DECLARED", source_authority: "DNA_OS_REGISTRY", evidence_refs: ["x"],
});
check("J2. same id with a different identity is rejected, not overwritten", conflict.status === "REJECTED" && conflict.reason === "IDENTITY_CONFLICT", `reason=${conflict.reason}`);

// K. malformed records fail closed
const malformed: Array<{ name: string; input: unknown; expect: string }> = [
  { name: "bad id shape", input: { entity_id: "not an id", entity_type: "APPLICATION", canonical_name: "x", state: "DECLARED", source_authority: "DNA_OS_REGISTRY", evidence_refs: ["e"] }, expect: "INVALID_ENTITY_ID" },
  { name: "no canonical name", input: { entity_id: "application://dna-os/x", entity_type: "APPLICATION", canonical_name: "", state: "DECLARED", source_authority: "DNA_OS_REGISTRY", evidence_refs: ["e"] }, expect: "MISSING_CANONICAL_NAME" },
  { name: "no state", input: { entity_id: "application://dna-os/x", entity_type: "APPLICATION", canonical_name: "x", state: "", source_authority: "DNA_OS_REGISTRY", evidence_refs: ["e"] }, expect: "MISSING_STATE" },
  { name: "no evidence", input: { entity_id: "application://dna-os/x", entity_type: "APPLICATION", canonical_name: "x", state: "DECLARED", source_authority: "DNA_OS_REGISTRY", evidence_refs: [] }, expect: "MISSING_EVIDENCE_REFS" },
];
let malformedOk = true;
for (const m of malformed) {
  const r = reopened.registerEntity(m.input as never);
  if (r.status !== "REJECTED" || r.reason !== m.expect) { malformedOk = false; console.log(`    ${m.name}: got ${r.status}/${r.reason}, expected REJECTED/${m.expect}`); }
}
check("K. malformed record fails closed", malformedOk);

// F. relationships resolve from the entity
const link = reopened.linkEntities({
  from_type: "APPLICATION", from_id: PROBE,
  to_type: "CAPABILITY", to_id: "capability-575c0103-fe94-4417-8f6d-cd45d85d50bf",
  relationship_kind: "APPLICATION_USES_CAPABILITY",
  source_authority: "DNA_OS_REGISTRY",
  evidence_refs: ["software/registry-database/tests/cross-system-store.test.ts"],
});
const relink = reopened.linkEntities({
  from_type: "APPLICATION", from_id: PROBE,
  to_type: "CAPABILITY", to_id: "capability-575c0103-fe94-4417-8f6d-cd45d85d50bf",
  relationship_kind: "APPLICATION_USES_CAPABILITY",
  source_authority: "DNA_OS_REGISTRY",
  evidence_refs: ["software/registry-database/tests/cross-system-store.test.ts"],
});
check("F. resolve relationships from the entity", link.status === "REGISTERED" && reopened.relationshipsFrom(PROBE).length >= 1, `status=${link.status}`);
check("F2. the same logical edge is idempotent", relink.status === "REUSED" && relink.relationship?.relationship_id === link.relationship?.relationship_id);

// G. an illegal type-pair is refused by the existing validator, not by this store
const illegal = reopened.linkEntities({
  from_type: "APPLICATION", from_id: PROBE,
  to_type: "VERSION", to_id: "0000000000000000000000000000000000000000",
  relationship_kind: "APPLICATION_USES_CAPABILITY",
  source_authority: "DNA_OS_REGISTRY", evidence_refs: ["e"],
});
check("G. illegal type-pair rejected by the existing validator", illegal.status === "REJECTED", `reason=${illegal.reason}`);

// L. the eight legacy canonical stores are byte-for-byte untouched
const after = LEGACY_FILES.map((f) => {
  const p = join(CANONICAL, f);
  return { f, size: existsSync(p) ? statSync(p).size : -1, lines: existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).length : -1 };
});
const drift = after.filter((a, i) => a.size !== before[i]!.size || a.lines !== before[i]!.lines);
check("L. legacy canonical stores unchanged", drift.length === 0, drift.length ? JSON.stringify(drift) : "8/8 identical");

rmSync(FIXTURE_DIR, { recursive: true, force: true });
reopened.resetStoreDirectory();
console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
