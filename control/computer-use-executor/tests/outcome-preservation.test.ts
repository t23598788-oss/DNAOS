/**
 * หน้าที่: prove that every result fact the os-ui adapter reports survives into
 * the persisted execution evidence, under the meaning its producer proved and
 * no stronger (Owner, 2026-09-02).
 *
 * MEASURED BEFORE THIS CHANGE: `UiWorkOrderOutcome` carries nine result fields,
 * the executor receives all nine, and one — `status` — was written. The rest
 * existed in memory and were dropped as the row was written, which is why a
 * `scroll` that only posted a CGEvent and a `scroll` that actually moved a
 * viewport were the same row: `result_status: "COMPLETED"`.
 *
 * THE DANGER THIS TEST GUARDS. Preserving those fields must not quietly promote
 * them. "mouse_helper=OK" and "OK scroll 0,600" are the adapter saying it sent
 * the event; they are dispatch evidence and cases 3 and 9 fail if they ever
 * appear under an observed-effect name. `result_status` keeps meaning dispatch,
 * not success.
 *
 * Input: none — the adapter and authority are injected, so no OS action occurs.
 * Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../executor, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามแก้เทสต์นี้ให้ยอมรับ COMPLETED เป็นหลักฐานว่าผลเกิดขึ้นจริง.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { executeComputerUse, type ExecutionEvidence } from "../executor";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const dir = mkdtempSync(join(tmpdir(), "dna-os-evidence-test-"));
const evidenceDir = relative(process.cwd(), dir);

/** A full nine-field outcome, shaped exactly as the real adapter returns one for an open/focus action. */
const FULL_OUTCOME = {
  ok: true,
  status: "COMPLETED",
  summary: "open_url completed for \"https://example.invalid/\" (opened)",
  evidence: ["ui_action=open_url", "scope=chrome-tab", "risk=HIGH", "os_open=OK", "foreground=true"],
  artifacts: [{ kind: "screenshot_file", ref: "/tmp/shot.png" }],
  next_action: null,
  idempotent_replay: false,
  presentation: "OPENED",
  focus_restored: true,
} as const;

const allowed = { ok: true } as never;
const denied = { ok: false, reason_code: "REQUESTER_MISMATCH", detail: "not this requester" } as never;

const request = {
  work_order_id: "wo-outcome-preservation",
  authority_id: "authority-test",
  requester: "control/computer-use-executor/tests",
  operation: "browser_navigate" as never,
  target: "example.invalid",
  scope_needed: ["chrome-tab"],
  ui: { target: "https://example.invalid/", scope: "chrome-tab" },
} as never;

function readRows(): ExecutionEvidence[] {
  const file = join(dir, "execution-evidence.jsonl");
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as ExecutionEvidence);
}

(async () => {
  // ---- authorised path with a complete producer outcome ----
  const run = await executeComputerUse(request, {
    validateAuthority: () => allowed,
    runUiWorkOrder: async () => FULL_OUTCOME as never,
    now: () => new Date(),
    newEvidenceId: () => "cue-test-full",
    evidenceDir,
    platform: "darwin",
  } as never);

  const persisted = readRows().find((r) => r.evidence_id === "cue-test-full")!;
  const o = persisted.outcome!;

  // 1. every producer field survives producer -> executor -> disk -> readback
  check("1. all nine outcome fields survive to readback",
    o.dispatch_evidence.ok === FULL_OUTCOME.ok
    && o.dispatch_evidence.summary === FULL_OUTCOME.summary
    && o.dispatch_evidence.evidence.length === FULL_OUTCOME.evidence.length
    && o.dispatch_evidence.idempotent_replay === FULL_OUTCOME.idempotent_replay
    && o.artifact_references.length === 1
    && o.presentation_state === FULL_OUTCOME.presentation
    && o.focus_restoration_verified === FULL_OUTCOME.focus_restored
    && o.next_action === FULL_OUTCOME.next_action
    && persisted.result_status === FULL_OUTCOME.status,
    `persisted keys=${Object.keys(o).join(",")}`);

  // 2. result_status still means dispatch, and still carries the producer's status verbatim
  check("2. result_status unchanged in value and meaning", persisted.result_status === "COMPLETED" && run.outcome?.status === "COMPLETED");

  // 3. dispatch evidence stayed dispatch evidence
  check("3. adapter send-log stays under dispatch_evidence",
    o.dispatch_evidence.evidence.includes("os_open=OK") && !JSON.stringify(o.artifact_references).includes("os_open=OK"));

  // 4. producer-defined observed/verified fields preserved exactly
  check("4. presentation_state and focus_restoration_verified preserved exactly",
    o.presentation_state === "OPENED" && o.focus_restoration_verified === true);

  // 5. artifacts and next_action survive
  check("5. artifacts and next_action survive readback",
    o.artifact_references[0]!.kind === "screenshot_file" && o.artifact_references[0]!.ref === "/tmp/shot.png" && o.next_action === null);

  // 6. a row written before this change (no `outcome` key) is still readable
  const legacy = JSON.parse('{"evidence_id":"cue-legacy","work_order_id":"wo-old","execution_owner":"control/computer-use-executor","executor_pid":1,"executor_process_title":"node","requester":"x","authority_id":"a","operation":"scroll","target":"screen","authorized":true,"authorization_reason":"AUTHORIZED","executed":true,"result_status":"COMPLETED","started_at":"2026-09-01T00:00:00.000Z","completed_at":"2026-09-01T00:00:01.000Z"}') as ExecutionEvidence;
  check("6. pre-change rows remain readable, outcome simply absent",
    legacy.result_status === "COMPLETED" && legacy.outcome === undefined);

  // 7. denied path stays fail-closed and records no outcome
  const deniedRun = await executeComputerUse({ ...(request as object), work_order_id: "wo-denied" } as never, {
    validateAuthority: () => denied,
    runUiWorkOrder: async () => { throw new Error("the adapter must never be reached when authority denies"); },
    now: () => new Date(),
    newEvidenceId: () => "cue-test-denied",
    evidenceDir,
    platform: "darwin",
  } as never);
  const deniedRow = readRows().find((r) => r.evidence_id === "cue-test-denied")!;
  check("7. denied path fail-closed: not executed, no outcome, null status",
    deniedRow.authorized === false && deniedRow.executed === false && deniedRow.result_status === null && deniedRow.outcome === null && deniedRun.outcome === null);

  // 8. the executor still returns the untouched producer outcome to its caller
  check("8. caller still receives the producer outcome unchanged", run.outcome?.presentation === "OPENED" && run.outcome?.evidence.includes("os_open=OK"));

  // 9. nothing was renamed into an effect/verified claim
  // Since Step 5 the row carries `effect_verdict`, computed from the expectation
  // and the two observations alone. What must still be impossible is dispatch
  // being renamed into effect: the outcome section itself carries no verdict.
  const serialised = JSON.stringify({ ...persisted, effect_verdict: undefined });
  check("9. no field promotes dispatch into observed effect or a verdict",
    !/observed_effect|effect_verified|"VERIFIED"|proven/i.test(serialised)
    && !("effect_verdict" in o) && !("status" in o)
    && !/"VERIFIED"|"FAILED"|"UNPROVEN"|verdict/.test(JSON.stringify(o)),
    "dispatch outcome carries no effect claim (focus_restoration_verified is the adapter's own focus fact, not an effect verdict)");

  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
