/**
 * ลงทะเบียนเจ้าของ path สำหรับ fixture ผ่าน pipeline จริง — ไม่ append JSON เอง
 * capability_type = TEST_FIXTURE (classification ไม่ใช่ status)
 */
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { inspectWriteOwnershipIndex } from "../../software/capability-registrar/contract";
import type { RegistrationCandidate } from "../../control/event-pipeline/contract";

const OWNED = "tests/__sandbox__/true-test-a/";
async function main() {
  const store = createPersistentFileStore();

  // duplicate/overlap gate ก่อน: มีใครเป็นเจ้าของ path นี้หรือพ่อของมันอยู่แล้วไหม
  const before = inspectWriteOwnershipIndex() as unknown as { entries: readonly Record<string, string>[] };
  const overlap = before.entries.filter((e) => {
    const p = String(e.OWNED_PATH ?? "");
    return p === OWNED || OWNED.startsWith(p) || p.startsWith(OWNED);
  });
  console.log(JSON.stringify({ OVERLAP_COUNT_BEFORE: overlap.length, overlap }, null, 1));
  if (overlap.length) { console.log("STOP: มีเจ้าของอยู่แล้ว"); return; }

  const candidate: RegistrationCandidate = {
    candidate_id: "cand-test-fixture-true-test-a",
    name: "test-fixture-true-test-a",
    kind: "capability",
    capability_type: "TEST_FIXTURE",
    source_location: OWNED,
    owner: "dna-os-infrastructure",
    input: [], output: [], side_effects: [], dependencies: [],
    behavior: "owns the isolated proof fixture directory tests/__sandbox__/true-test-a/ so write-gate can resolve a real owner for end-to-end proof runs",
    version: "1.0.0",
    evidence_refs: ["tests/__pipeline__/register-fixture-owner.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "SOFTWARE_RESOURCE",
    data_classification: "internal",
    source_system: "dna-os-infrastructure",
    scope: OWNED,
  } as RegistrationCandidate;

  const result = runRegistrationPipeline(candidate, store, `corr-fixture-${Date.now()}`);
  console.log(JSON.stringify({ REGISTRATION: result }, null, 1));

  const after = inspectWriteOwnershipIndex() as unknown as
    { entries: readonly Record<string, string>[]; excluded?: readonly Record<string, string>[] };
  const mine = after.entries.filter((e) => String(e.OWNED_PATH ?? "").startsWith("tests/__sandbox__"));
  console.log(JSON.stringify({ OWNERSHIP_ENTRIES_AFTER: after.entries.length,
    TESTS_SANDBOX_OWNERS: mine }, null, 1));
}
main().catch((e) => { console.error("ERR", e?.message ?? e); process.exit(1); });
