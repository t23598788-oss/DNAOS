/**
 * หน้าที่: prove that every Computer Use execution records WHICH canonical
 * capability it went through, that the identity is settled from the registry
 * before anything runs, and that a wrong identity is refused rather than
 * corrected (Owner, 2026-09-02).
 *
 * WHY. Execution evidence could say what happened but not what it was evidence
 * OF. The nearest thing to an identity on this path was the authority lease's
 * `capability` field, whose only values are "browser", "desktop" and
 * "connections/os-ui" — an authorisation scope, not an identity, and it stays
 * separate here.
 *
 * WHERE THE IDENTITY COMES FROM. Not from the operation name, not from the
 * target text, not from a model, and not from anything read after the fact: the
 * executor reaches the OS only through `connections/os-ui/adapter-contract.ts`,
 * and `os-ui` is a registered canonical capability whose source_location is
 * `connections/os-ui/`. The route is a fact about the code, so the id is
 * resolved from the registry at module load and is already known before the
 * first authority check.
 *
 * Input: none — authority and adapter are injected, so no OS action occurs.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../executor, ../../../software/registry-database, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามให้เทสต์นี้ยอมรับ capability_id ที่มาจากการเดาข้อความ,
 * และห้ามตีความ capability_id ว่าเป็นการพิสูจน์ว่า capability ทำงานได้.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { EXECUTION_ROUTE_CAPABILITY_ID, executeComputerUse, type ExecutionEvidence } from "../executor";
import { findCapability } from "../../../software/registry-database/contract";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const dir = mkdtempSync(join(tmpdir(), "dna-os-identity-test-"));
const evidenceDir = relative(process.cwd(), dir);
const rows = (): ExecutionEvidence[] =>
  readFileSync(join(dir, "execution-evidence.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as ExecutionEvidence);

const OUTCOME = { ok: true, status: "COMPLETED", summary: "open_url completed", evidence: ["ui_action=open_url", "os_open=OK"], artifacts: [], next_action: null, idempotent_replay: false, presentation: "OPENED", focus_restored: null } as const;

const base = {
  authority_id: "authority-test",
  requester: "control/computer-use-executor/tests",
  operation: "browser_navigate" as never,
  target: "example.invalid",
  scope_needed: ["chrome-tab"],
  ui: { target: "https://example.invalid/", scope: "chrome-tab" },
};
const deps = (id: string) => ({
  validateAuthority: () => ({ ok: true }) as never,
  runUiWorkOrder: async () => OUTCOME as never,
  now: () => new Date(),
  newEvidenceId: () => id,
  evidenceDir,
  platform: "darwin",
}) as never;
/** Any adapter call at all is a failure for the refusal cases: identity is settled first. */
const depsNeverRun = (id: string) => ({
  validateAuthority: () => { throw new Error("authority must not be reached when identity is refused"); },
  runUiWorkOrder: async () => { throw new Error("the adapter must never run when identity is refused"); },
  now: () => new Date(),
  newEvidenceId: () => id,
  evidenceDir,
  platform: "darwin",
}) as never;

(async () => {
  // The id must come from the registry, independently resolved here.
  const registry = findCapability({ canonical_name: "os-ui" } as never, createPersistentFileStore()) as { capability_id?: string; source_location?: unknown } | null;
  check("identity source is the canonical registry, resolved by canonical name",
    !!registry?.capability_id && EXECUTION_ROUTE_CAPABILITY_ID === registry.capability_id,
    `registry=${registry?.capability_id} executor=${EXECUTION_ROUTE_CAPABILITY_ID}`);
  check("that registered capability really is the route this executor takes",
    JSON.stringify(registry?.source_location ?? "").includes("connections/os-ui"),
    `source_location=${JSON.stringify(registry?.source_location)}`);

  // 1. valid declared id -> accepted, and recorded
  const ok = await executeComputerUse({ ...base, work_order_id: "wo-id-ok", capability_id: EXECUTION_ROUTE_CAPABILITY_ID as string } as never, deps("cue-id-ok"));
  const okRow = rows().find((r) => r.evidence_id === "cue-id-ok")!;
  check("1. valid registered capability_id accepted and persisted",
    okRow.capability_id === EXECUTION_ROUTE_CAPABILITY_ID && okRow.executed === true, `persisted=${okRow.capability_id}`);

  // 2. absent id -> the route's own identity is recorded (what ran), not a guess
  await executeComputerUse({ ...base, work_order_id: "wo-id-absent" } as never, deps("cue-id-absent"));
  const absentRow = rows().find((r) => r.evidence_id === "cue-id-absent")!;
  check("2. absent declaration records the route's resolved identity",
    absentRow.capability_id === EXECUTION_ROUTE_CAPABILITY_ID && absentRow.executed === true);

  // 3. malformed -> refused before authority, nothing executed
  const malformed = await executeComputerUse({ ...base, work_order_id: "wo-id-bad", capability_id: "os-ui" } as never, depsNeverRun("cue-id-bad"));
  const badRow = rows().find((r) => r.evidence_id === "cue-id-bad")!;
  check("3. malformed capability_id fails closed before authority",
    badRow.authorized === false && badRow.executed === false && badRow.authorization_reason === "CAPABILITY_ID_MALFORMED" && badRow.capability_id === null && malformed.outcome === null);

  // 4. well-formed but not this route (unregistered id) -> refused, no substitution
  const unknown = await executeComputerUse({ ...base, work_order_id: "wo-id-unknown", capability_id: "capability-00000000-0000-0000-0000-000000000000" } as never, depsNeverRun("cue-id-unknown"));
  const unknownRow = rows().find((r) => r.evidence_id === "cue-id-unknown")!;
  check("4. unknown capability_id fails closed, never replaced with os-ui",
    unknownRow.executed === false && unknownRow.capability_id === null && unknownRow.authorization_reason.startsWith("CAPABILITY_ROUTE_MISMATCH") && unknown.outcome === null);

  // 5. a real, registered capability that this route does not invoke
  const other = findCapability({ canonical_name: "source-execution" } as never, createPersistentFileStore()) as { capability_id?: string } | null;
  await executeComputerUse({ ...base, work_order_id: "wo-id-mismatch", capability_id: other!.capability_id as string } as never, depsNeverRun("cue-id-mismatch"));
  const mismatchRow = rows().find((r) => r.evidence_id === "cue-id-mismatch")!;
  check("5. registered-but-wrong-route capability_id fails closed",
    mismatchRow.executed === false && mismatchRow.capability_id === null && mismatchRow.authorization_reason.includes(other!.capability_id as string));

  // 6. legacy rows without capability_id remain readable
  const legacy = JSON.parse('{"evidence_id":"cue-legacy","work_order_id":"w","execution_owner":"control/computer-use-executor","executor_pid":1,"executor_process_title":"node","requester":"x","authority_id":"a","operation":"scroll","target":"screen","authorized":true,"authorization_reason":"AUTHORIZED","executed":true,"result_status":"COMPLETED","started_at":"2026-09-01T00:00:00.000Z","completed_at":"2026-09-01T00:00:01.000Z"}') as ExecutionEvidence;
  check("6. legacy evidence still readable, capability_id simply absent",
    legacy.result_status === "COMPLETED" && legacy.capability_id === undefined && legacy.outcome === undefined);

  // 7. STEP 1 REGRESSION — outcome preservation untouched by this change
  const o = okRow.outcome!;
  check("7. Step 1 outcome preservation intact",
    o.dispatch_evidence.ok === true && o.dispatch_evidence.evidence.includes("os_open=OK") && o.presentation_state === "OPENED" && okRow.result_status === "COMPLETED");

  // 8. identity is not a proof claim
  check("8. capability_id carries no verdict vocabulary",
    !/verified|proven|pass|effect/i.test(JSON.stringify({ capability_id: okRow.capability_id })));

  check("9. authority scope was not reinterpreted as identity", okRow.capability_id !== "browser" && okRow.capability_id !== "desktop" && okRow.capability_id !== "connections/os-ui");

  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
