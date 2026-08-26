/**
 * หน้าที่: §7 พิสูจน์ว่า `runContinuationJoin` ถูกเรียกจาก **production จริง**
 * ไม่ใช่จาก proof
 *
 * proof นี้ **ไม่เรียก `runContinuationJoin` เลย** มันทำสิ่งเดียว: ผลัก task
 * จริงผ่าน funnel จริงจนถึงสถานะที่ authoritative แล้วพิสูจน์จาก **หลักฐานที่
 * production เขียนไว้เอง** ว่า join ได้ทำงาน
 *
 * นี่คือความต่างระหว่าง IMPLEMENTED_NOT_RUNTIME_PROVEN กับ runtime-proven:
 * ไม่ใช่ว่าโค้ดมีอยู่ ไม่ใช่ว่าเทสต์ผ่าน แต่คือ **มีร่องรอยที่ production ทิ้งไว้**
 *
 * Input: none — data dir และ journal ของตัวเองใน scratchpad
 * Output: exit 0 เมื่อครบ, exit 1 เมื่อไม่ครบ
 * Dependency ที่อนุญาต: Node built-ins + contract ของ agent-gateway
 * สิ่งที่ห้ามแตะ:
 * - **ห้ามเรียก `runContinuationJoin` หรือ `emitDependencyEvents` ตรง ๆ**
 *   ถ้าเรียก มันจะไม่ได้พิสูจน์อะไรเลย
 * - ห้ามเขียนลง production store
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = process.cwd();
const root = mkdtempSync(join(tmpdir(), "continuation-runtime-"));
const gatewayData = join(root, "gateway-data");
mkdirSync(gatewayData, { recursive: true });
process.env.WORK_SESSION_STATE_ROOT = root;
process.env.AGENT_GATEWAY_DATA_DIR = gatewayData;

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string): void => { checks.push({ name, ok, detail }); };

let aborted = "";
(async () => {
try {
  const selfSource = readFileSync(resolve(REPO, "control/capability-creation/tests/continuation-runtime-proof.ts"), "utf8");
  const body = selfSource.split("// ---- assertions ----")[0];
  check("this proof never calls the join itself — the only caller can be production",
    !/\brunContinuationJoin\s*\(/.test(body) && !/\bemitDependencyEvents\s*\(/.test(body),
    "verified by reading this file's own source above the assertions marker");

  const { submitTask, getTask } = require(resolve(REPO, "control/agent-gateway/contract.ts")) as typeof import("../../agent-gateway/contract");
  const wc = require(resolve(REPO, "control/work-continuation/contract.ts")) as typeof import("../../work-continuation/contract");

  // A real waiting row that a real census fact can satisfy. `execution/run` is
  // a real capability the live census really carries, so the join's own census
  // read will produce the event — nothing here fabricates one.
  const waitingPath = join(root, "waiting.jsonl");
  // Production reads control/work-continuation's default journal. This points
  // the SAME production code at a scratch file so the proof exercises the real
  // path without writing into the live one.
  process.env.WORK_CONTINUATION_WAITING_PATH = waitingPath;
  const workId = `work-continuation-runtime-${Date.now().toString(36)}`;
  wc.appendWaiting({
    work_id: workId, current_phase: "BLOCKED", status: "WAITING",
    blocked_on: [wc.capabilityKeyOf("execution/run")],
    required_evidence: [], required_resources: [], required_capabilities: [wc.capabilityKeyOf("execution/run")],
    required_runtime_state: [], required_external_state: [],
    resume_condition: "ALL_AVAILABLE", exact_state: null,
    next_action: "finish the blocked capability wiring",
    resolved_work_context_ref: null, last_verified_revision: null,
    evidence_refs: [wc.capabilityKeyOf("execution/run")],
    resume_attempt_count: 0, last_resume_reason: null, last_input_digest: null, last_result_digest: null,
    required_worker_class: null, recorded_at: new Date().toISOString(),
  } as never, waitingPath);

  // THE ONLY THING THIS PROOF DOES: push a real task through the real funnel.
  const task = await submitTask(
    "continuation runtime proof — a real transition to an authoritative verdict",
    { user_id: "proof", workspace_id: "proof", conversation_id: "proof", parent_task_id: null },
    "continuation-runtime-proof", [],
  );
  const settled = getTask(task.task_id);
  check("a real task reached an authoritative verdict through the production funnel",
    settled?.status === "BLOCKED" || settled?.status === "FAILED" || settled?.status === "COMPLETED",
    `task ${task.task_id} -> ${settled?.status} via submitTask -> persistStatus`);

  // ---- assertions ----
  // Production wrote its own evidence. We read it; we did not produce it.
  const evidencePath = join(gatewayData, "evidence.jsonl");
  const rows = readFileSync(evidencePath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { source?: string; kind?: string; payload?: Record<string, unknown> });
  const joinRows = rows.filter((r) => r.source === "control/capability-creation/production.ts#runContinuationJoin");
  check("production really invoked the join and recorded it — not a call from this file",
    joinRows.length > 0,
    `${joinRows.length} evidence row(s) with source control/capability-creation/production.ts#runContinuationJoin`);
  const resumed = joinRows.find((r) => r.payload?.resumed_work_id === workId);
  check("the join, running in production, woke the work that was really waiting",
    resumed !== undefined,
    resumed ? `resumed_work_id=${String(resumed.payload?.resumed_work_id)} verdict=${String(resumed.payload?.verdict)} triggered_by=${String(resumed.payload?.triggered_by)}` : "the waiting row was not woken");
  check("the decision carried the persisted next_action forward rather than re-deriving it",
    String(resumed?.payload?.next_action ?? "") === "finish the blocked capability wiring",
    String(resumed?.payload?.next_action ?? "(none)"));
} catch (error) {
  aborted = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("\n[CONTINUATION RUNTIME PROOF]");
for (const c of checks) console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}\n      ${c.detail}`);
if (aborted) console.log(`\n  ✘ proof aborted: ${aborted}`);
const failed = checks.filter((c) => !c.ok).length + (aborted ? 1 : 0);
console.log(`\nRESULT: ${checks.length - checks.filter((c) => !c.ok).length} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
})();
