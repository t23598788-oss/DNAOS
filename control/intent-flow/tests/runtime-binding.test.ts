/**
 * พิสูจน์ 18 ข้อของ RUNTIME_OBSERVATION_BINDING_V1
 *
 * ไม่มีข้อไหนให้คนป้อนคำว่า GOOD/BAD เข้ามา ทุกคำตัดสินมาจาก observation
 * ที่อ่านจากคลังหลักฐาน หรือจากหลักฐานควบคุมที่มีรูปร่างเดียวกันเป๊ะ
 */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { readFileSync } from "node:fs";
import { bindRunObservations, readDeclaredSemantics, STEP_BINDING } from "../runtime-binding";
import type { RunSources, RuntimeStepObservation } from "../runtime-binding";
import { analyzeRun } from "../run-analyzer";
import { compareSemantics, classifyTransformation, UNKNOWN } from "../semantics";
import { RECOVERY_FLOW } from "../recovery-flow";
import { implementationForStep } from "../implementation-map";
import { loadAllTasks, loadAllEvidence, loadAllHandoffs } from "../../agent-gateway/contract";

let pass = 0, fail = 0;
function t(name: string, fn: () => void): void {
  try { fn(); pass += 1; console.log(`  PASS ${name}`); }
  catch (e) { fail += 1; console.log(`  FAIL ${name}\n       ${(e as Error).message}`); }
}

const AT = "2026-08-30T00:00:00.000Z";
type Sem = Record<string, string>;
const ev = (kind: string, id: string, sem: Sem = {}, extra: Record<string, unknown> = {}) =>
  ({ evidence_id: id, task_id: "task-controlled", kind, source: "test", recorded_at: AT,
     payload: { ...sem, ...extra } }) as any;

/** สร้างการรันควบคุมที่ครบสิบขั้น โดยใส่ความหมายตามที่กำหนดให้แต่ละขั้น */
function controlledRun(perStep: Record<string, { in?: Sem; out?: Sem; extra?: Record<string, unknown> }> = {}): RunSources {
  const rows: any[] = [];
  for (const b of STEP_BINDING) {
    const spec = perStep[b.step_id] ?? {};
    const kind = b.evidence_kinds[0];
    if (kind === undefined) continue;
    rows.push(ev(kind, `${b.step_id}-in`, spec.in ?? {}, spec.extra ?? {}));
    rows.push(ev(kind, `${b.step_id}-out`, spec.out ?? spec.in ?? {}, spec.extra ?? {}));
  }
  return {
    evidence: rows,
    handoffs: [{ handoff_id: "h1", task_id: "task-controlled", agent_id: "a", role: "r",
      input_reference: "x", files_read: [], files_changed: [], tests_run: [], status: "VERIFIED",
      evidence_refs: [], blockers: [], next_action: null, created_at: AT, updated_at: AT }] as any,
    task: { task_id: "task-controlled", status: "COMPLETED", created_at: AT, updated_at: AT } as any,
  };
}
const run = (src: RunSources) => analyzeRun("run:task-controlled", bindRunObservations("task-controlled", src));

console.log("\n— การรันจริง —");

const tasks = loadAllTasks(), allEv = loadAllEvidence(), allHo = loadAllHandoffs();
const evByTask = new Map<string, any[]>(); for (const e of allEv) { const a = evByTask.get(e.task_id) ?? []; a.push(e); evByTask.set(e.task_id, a); }
const hoByTask = new Map<string, any[]>(); for (const h of allHo) { const a = hoByTask.get(h.task_id) ?? []; a.push(h); hoByTask.set(h.task_id, a); }
const srcOf = (id: string): RunSources => ({
  evidence: evByTask.get(id) ?? [], handoffs: hoByTask.get(id) ?? [],
  task: tasks.find((x) => x.task_id === id) ?? null });

let bestId = "", bestN = 0;
for (const task of tasks) {
  const n = bindRunObservations(task.task_id, srcOf(task.task_id)).filter((o) => o.observed).length;
  if (n > bestN) { bestN = n; bestId = task.task_id; }
}
const realObs = bindRunObservations(bestId, srcOf(bestId));
const realAnalysis = analyzeRun(`run:${bestId}`, realObs);

// 1
t("1. การรันที่สมบูรณ์ถูกฉายลงครบ S1-S10 โดยอัตโนมัติ", () => {
  assert.equal(realObs.length, 10);
  assert.equal(bestN, 10, `สังเกตได้ ${bestN}/10`);
  assert.deepEqual(realObs.map((o) => o.step_id), RECOVERY_FLOW.map((s) => s.flow_step_id));
  for (const o of realObs) assert.ok(o.runtime_evidence_refs.length > 0, `${o.step_id} ไม่มีตัวชี้หลักฐาน`);
});

// 2
t("2. ไม่มีทางให้คนป้อน GOOD/BAD เข้ามา", () => {
  const src = ["../runtime-binding.ts", "../run-analyzer.ts", "../semantics.ts", "../implementation-map.ts"]
    .map((f) => readFileSync(new URL(f, import.meta.url), "utf8"))
    .join("\n").split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  assert.ok(!/\binput_verdict\b|\boutput_verdict\b/.test(src), "ยังรับ verdict ที่คนกำหนดเอง");
  assert.ok(!/StepVerdict/.test(src), "ยังอ้างชนิด verdict ที่คนป้อน");
  for (const o of realObs) assert.ok(["SUCCESS","FAILURE","NOT_OBSERVED"].includes(o.technical_status));
});

// 3
t("3. อินพุตต้นทางผิดสัญญา -> ชี้ที่การส่งต่อ ไม่ใช่ผู้รับกรรม", () => {
  const a = run(controlledRun({
    S6_EXECUTION: { out: { semantic_identity: "result:A", semantic_type: "ExecutionResult" } },
    S7_RESULT: { in: { semantic_identity: "result:B", semantic_type: "ExecutionResult" },
                 out: { semantic_identity: "result:B" }, extra: { status: "FAILED" } },
  }));
  assert.equal(a.first_bad_boundary, "S6_EXECUTION->S7_RESULT transfer");
  assert.equal(a.responsibility, "DOWNSTREAM_VICTIM_CANDIDATE");
  assert.notEqual(a.root_cause_candidate, "S7_RESULT");
});

// 4
t("4. อินพุตถูก แต่เอาต์พุตของขั้นนั้นเริ่มผิด -> ต้นเหตุอยู่ที่ขั้นนั้น", () => {
  const a = run(controlledRun({ S6_EXECUTION: { extra: { status: "FAILED" } } }));
  assert.equal(a.first_bad_boundary, "S6_EXECUTION output");
  assert.equal(a.responsibility, "LOCAL_ROOT_CAUSE_CANDIDATE");
  assert.equal(a.root_cause_candidate, "S6_EXECUTION");
  assert.equal(a.last_proven_truth, "S5_DISPATCH output");
});

// 5
t("5. เอาต์พุตถูก แต่การส่งต่อทำให้เพี้ยน -> ต้นเหตุอยู่ที่การส่งต่อ", () => {
  const a = run(controlledRun({
    S6_EXECUTION: { out: { semantic_identity: "result:A", semantic_destination: "S7_RESULT" } },
    S7_RESULT: { in: { semantic_identity: "result:A", semantic_destination: "S9_NEXT_DECISION" } },
  }));
  assert.equal(a.first_bad_boundary, "S6_EXECUTION->S7_RESULT transfer");
  assert.equal(a.responsibility, "TRANSFER_ROOT_CAUSE_CANDIDATE");
});

// 6
t("6. ค่าถูกต้องทางเทคนิคแต่ความหมายผิด -> เจอ FIRST_TRUTH_DIVERGENCE", () => {
  const money = { semantic_identity: "v:500", semantic_type: "string",
                  semantic_value_reference: "sha256:500", semantic_meaning: "MONEY", semantic_unit: "THB" };
  const qty = { ...money, semantic_meaning: "QUANTITY", semantic_unit: "ITEM" };
  const a = run(controlledRun({ S6_EXECUTION: { out: money }, S7_RESULT: { in: qty, out: qty } }));
  const b = a.boundaries.find((x) => x.boundary_id === "S6_EXECUTION->S7_RESULT");
  assert.ok(b !== undefined);
  assert.equal(b!.technically_valid, true, "ขอบเขตนี้ต้องผ่านทางเทคนิค");
  assert.equal(b!.truth_preserved, false, "แต่ความจริงต้องถือว่าเปลี่ยนแล้ว");
  assert.equal(a.first_truth_divergence, "S6_EXECUTION->S7_RESULT transfer");
  assert.equal(a.first_bad_boundary, null, "ไม่มีอะไรพังทางเทคนิค");
  assert.equal(a.last_proven_truth, "S5_DISPATCH output");
});

// 7
t("7. หน่วยไม่ตรง ถูกตรวจแยกจากมิติอื่น", () => {
  const c = compareSemantics(
    { identity: "x", type: "number", value_reference: "r", meaning: "WEIGHT", unit: "KG",
      contract_version: "v1", destination: "d", state: "s", authority: "a" },
    { identity: "x", type: "number", value_reference: "r", meaning: "WEIGHT", unit: "LB",
      contract_version: "v1", destination: "d", state: "s", authority: "a" });
  assert.equal(c.mismatch_class, "UNIT_MISMATCH");
  assert.equal(c.truth_preserved, false);
  assert.equal(c.technically_valid, true, "หน่วยผิดไม่ทำให้รูปแบบผิด");
  assert.equal(c.dimensions.find((d) => d.dimension === "MEANING")!.verdict, "MATCH");
});

// 8
t("8. identity ไม่ตรง ถูกตรวจแยกจากมิติอื่น", () => {
  const base = { type: "T", value_reference: "r", meaning: "M", unit: "U",
                 contract_version: "v1", destination: "d", state: "s", authority: "a" };
  const c = compareSemantics({ identity: "task-A", ...base }, { identity: "task-B", ...base });
  assert.equal(c.mismatch_class, "IDENTITY_MISMATCH");
  assert.equal(c.technically_valid, false);
  assert.equal(c.truth_preserved, true, "ความหมายและหน่วยยังตรง — คนละมิติกัน");
  assert.equal(c.dimensions.filter((d) => d.verdict === "MISMATCH").length, 1);
});

// 9
t("9. UNKNOWN ยังคงเป็น UNKNOWN ไม่ถูกแปลงเป็นความหมายที่อนุมาน", () => {
  const s = readDeclaredSemantics({ file_path: "control/agent-gateway/gateway.ts",
    amount: 500, currency: "THB", meaning: "MONEY", unit: "THB", description: "โอนเงิน" });
  assert.equal(s.meaning, UNKNOWN, "คีย์ที่ไม่ได้ประกาศตรงตัวต้องไม่ถูกอ่านเป็นความหมาย");
  assert.equal(s.unit, UNKNOWN);
  assert.equal(s.identity, null);
  const c = compareSemantics(
    { identity: null, type: null, value_reference: null, meaning: UNKNOWN, unit: UNKNOWN,
      contract_version: null, destination: null, state: null, authority: null },
    { identity: null, type: null, value_reference: null, meaning: "MONEY", unit: "THB",
      contract_version: null, destination: null, state: null, authority: null });
  assert.equal(c.mismatch_class, "NO_MISMATCH", "UNKNOWN ต้องไม่กลายเป็นความผิด");
  assert.equal(c.truth_preserved, true, "และต้องไม่กลายเป็นความถูกด้วย");
  assert.ok(c.unverifiable_dimensions.includes("MEANING"));
  assert.ok(c.unverifiable_dimensions.includes("UNIT"));
});

// 10
t("10. การแปลงความหมายที่ประกาศไว้ ไม่ใช่ความผิดพลาด", () => {
  const r = classifyTransformation("S3_DECISION", "OWNER_TEXT", "STRUCTURED_INTENT", "transform:owner-text-to-intent");
  assert.equal(r.verdict, "AUTHORIZED_TRANSFORMATION");
  const a = run(controlledRun({ S6_EXECUTION: {
    in: { semantic_meaning: "OWNER_TEXT" }, out: { semantic_meaning: "STRUCTURED_INTENT" },
    extra: { transformation_id: "transform:owner-text-to-intent" } } }));
  assert.equal(a.first_truth_divergence, null, "การแปลงที่ประกาศไว้ต้องไม่ถูกนับเป็นการเบี่ยงเบน");
});

// 11
t("11. การแปลงความหมายที่ไม่มีใครประกาศ เป็นการเบี่ยงเบน", () => {
  const r = classifyTransformation("S6_EXECUTION", "MONEY", "QUANTITY", null);
  assert.equal(r.verdict, "SEMANTIC_DIVERGENCE");
  const a = run(controlledRun({ S6_EXECUTION: {
    in: { semantic_meaning: "MONEY" }, out: { semantic_meaning: "QUANTITY" } } }));
  assert.equal(a.first_truth_divergence, "S6_EXECUTION transformation");
  assert.equal(a.responsibility, "LOCAL_ROOT_CAUSE_CANDIDATE");
  assert.equal(a.proven_root_cause, null, "candidate ไม่เลื่อนเป็น proven เอง");
});

// 12
t("12. อาการปลายทางไม่ถูกกล่าวหาเป็นต้นเหตุ", () => {
  const a = run(controlledRun({
    S3_DECISION: { out: { semantic_identity: "intent:A" } },
    S4_WORK_ORDER: { in: { semantic_identity: "intent:CORRUPT" }, extra: { status: "FAILED" } },
    S6_EXECUTION: { extra: { status: "FAILED" } },
    S8_EVIDENCE: { extra: { status: "FAILED" } },
  }));
  assert.equal(a.responsibility, "DOWNSTREAM_VICTIM_CANDIDATE");
  assert.equal(a.root_cause_candidate, "S3_DECISION->S4_WORK_ORDER");
  assert.ok(!a.implementation_scope.some((p) => p.includes("memory-store")),
    "ขั้นที่มีอาการทีหลังต้องไม่เข้าขอบเขตการซ่อม");
  assert.equal(a.implementation_scope.length, 1, "อาการหลายจุดต้องยุบเหลือขอบเขตเดียว");
});

// 13
t("13. S10 ผ่านทางเทคนิคพร้อมกับความล้มเหลวเชิงมนุษย์ได้", () => {
  const a = run(controlledRun());
  const s10 = a.human_outcome;
  assert.equal(s10.technical_status, "SUCCESS");
  assert.equal(s10.human_outcome_met, null, "200/COMPLETED ต้องไม่พิสูจน์ความสำเร็จของคน");
  assert.equal(s10.actual_human_outcome, "TECHNICAL_SUCCESS_ONLY");
  const b = run(controlledRun({ S10_OWNER_PRESENTATION: { out: { semantic_state: "OWNER_RECEIVED_RESULT" } } }));
  assert.equal(b.human_outcome.human_outcome_met, true);
});

// 14
t("14. หลักฐานการรันอยู่รอดข้ามการรีสตาร์ต (คนละ process)", () => {
  const script = `import {bindRunObservations} from "${new URL("../runtime-binding.ts", import.meta.url).pathname}";
import {analyzeRun} from "${new URL("../run-analyzer.ts", import.meta.url).pathname}";
const o = bindRunObservations(${JSON.stringify(bestId)});
console.log(JSON.stringify({n:o.filter(x=>x.observed).length, a:analyzeRun("run:${bestId}", o)}));`;
  const out = execFileSync("npx", ["tsx", "--eval", script], { encoding: "utf8", cwd: process.cwd() });
  const fresh = JSON.parse(out.trim().split("\n").pop()!);
  assert.equal(fresh.n, 10, "process ใหม่อ่านจากดิสก์ได้ครบสิบขั้น");
  assert.deepEqual(fresh.a.observed_steps, realAnalysis.observed_steps);
  assert.equal(fresh.a.first_bad_boundary, realAnalysis.first_bad_boundary);
});

// 15
t("15. หลักฐานเดิมให้ผลเดิมทุกครั้ง", () => {
  const a = JSON.stringify(analyzeRun(`run:${bestId}`, bindRunObservations(bestId, srcOf(bestId))));
  const b = JSON.stringify(analyzeRun(`run:${bestId}`, bindRunObservations(bestId, srcOf(bestId))));
  assert.equal(a, b);
  assert.equal(JSON.stringify(run(controlledRun())), JSON.stringify(run(controlledRun())));
});

// 16 + 17
t("16+17. ไม่มี dispatch และไม่มีการเขียนใด ๆ", () => {
  const files = ["../runtime-binding.ts", "../run-analyzer.ts", "../semantics.ts", "../implementation-map.ts"];
  const src = files.map((f) => readFileSync(new URL(f, import.meta.url), "utf8"))
    .join("\n").split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  for (const banned of ["writeFileSync", "appendFileSync", "saveEvidence", "saveTask", "dispatch",
                        "submitTask", "runPreparationCycle", "linkAdmittedErrorToRepairLoop", "execSync"]) {
    assert.ok(!src.includes(banned), `พบ ${banned} ในชั้นอ่านอย่างเดียว`);
  }
});

t("17b. ขนาดคลังหลักฐานไม่เปลี่ยนหลังวิเคราะห์", () => {
  const paths = ["control/agent-gateway/data/evidence.jsonl", "control/agent-gateway/data/tasks.jsonl",
                 "control/agent-gateway/data/handoffs.jsonl"];
  const before = paths.map((p) => statSync(p).size);
  for (const task of tasks.slice(-50)) analyzeRun("x", bindRunObservations(task.task_id, srcOf(task.task_id)));
  assert.deepEqual(paths.map((p) => statSync(p).size), before);
});

t("18. เจ้าของทุกขั้นมาจากทะเบียน ไม่ใช่จากชื่อไฟล์", () => {
  for (const s of RECOVERY_FLOW) {
    const impl = implementationForStep(s.flow_step_id);
    assert.ok(impl !== null, `${s.flow_step_id} ไม่มีการประกาศ path`);
    assert.equal(impl!.ownership_status, "OWNED", `${s.flow_step_id} ไม่มีเจ้าของในทะเบียน`);
    assert.ok(impl!.capability_id!.startsWith("capability-"));
  }
  const bogus = implementationForStep("S_NOT_A_STEP");
  assert.equal(bogus, null, "ขั้นที่ไม่มีการประกาศต้องไม่ได้เจ้าของแถมมา");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
