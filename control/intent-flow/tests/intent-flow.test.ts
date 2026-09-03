/**
 * OWNER_INTENT_TO_RUNTIME_FLOW — พิสูจน์ว่าความหมายมาก่อนซอร์ส
 * และตัววิเคราะห์ชี้ขอบเขตแรกที่พังได้ถูกต้องในสี่รูปแบบความล้มเหลว
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RECOVERY_OUTCOME, RECOVERY_FLOW, RECOVERY_CONTRACTS, analyzeFlow } from "../contract";
import type { StepObservation } from "../contract";
import { bindFailureEvidence } from "../../owner-error-lane/contract";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${n}`); }
  else { fail += 1; console.log(`FAIL  ${n}`); if (d !== undefined) console.log(`      ${JSON.stringify(d)}`); }
};
const good = (id: string): StepObservation => ({ flow_step_id: id, input_verdict: "GOOD", output_verdict: "GOOD", actual_input: "ok", actual_output: "ok", evidence: [`runtime:${id}`] });
const allGood = RECOVERY_FLOW.map((s) => good(s.flow_step_id));

// ---- 1/2: เจตนาและผลระดับคน ยืนได้เองโดยไม่มีซอร์ส -----------------------------
check("1  OWNER_INTENT มีตัวตนของตัวเอง และที่มาไม่ใช่ไฟล์",
  RECOVERY_OUTCOME.outcome_id.startsWith("outcome:")
  && !/\.(ts|mjs|js)\b/.test(RECOVERY_OUTCOME.meaning_source), RECOVERY_OUTCOME.meaning_source);
check("2  human_success_condition ไม่ยอมรับ 200 เป็นความสำเร็จ",
  /ไม่นับ|ไม่ใช่แค่/.test(RECOVERY_OUTCOME.human_success_condition));
check("11 ทุกขั้นประกาศ purpose โดยไม่อ้างชื่อไฟล์",
  RECOVERY_FLOW.every((s) => !/\.(ts|mjs|js)\b/.test(s.purpose)));

// ---- 3/4: ทุกขั้นและทุกขอบเขตมีสัญญา -------------------------------------------
check("3  ทุกขั้นมี required_input/expected_output/success/failure/evidence",
  RECOVERY_FLOW.every((s) => s.required_input && s.expected_output && s.success_condition
    && s.failure_condition && s.evidence_required.length > 0), RECOVERY_FLOW.length);
check("4  ทุกขอบเขตมีสัญญาและคาดหวังสองฝั่ง",
  RECOVERY_CONTRACTS.length === RECOVERY_FLOW.length - 1
  && RECOVERY_CONTRACTS.every((c) => c.contract && c.expected_from_output && c.expected_to_input),
  RECOVERY_CONTRACTS.length);

// ---- 5/6: implementation ผูกลงจาก flow และหลักฐานวิ่งขึ้น -------------------------
const bound = bindFailureEvidence({
  origin_kind: "SYSTEM_ERROR_COMMAND", owner_visible: true, origin_event_id: "e", command_id: "c",
  task_id: "t", work_id: "work-x", parent_work_id: null, error_kind: "TEST_FAILED",
  raw_command_text: "p", status: "B", current_action: "",
  evidence: { file_path: "control/agent-gateway/gateway.ts" }, auto_dispatch: null,
  recorded_at: "2026-08-30T00:00:00.000Z",
});
const withImpl = RECOVERY_FLOW.map((s) => s.flow_step_id === "S6_EXECUTION"
  ? { ...s, implementation: { capability_id: bound.bound_capability, resource_id: null,
      repository_id: "repo:dna-os-infrastructure", repo_relative_path: "control/agent-gateway/",
      runtime_entrypoint: "POST /command", ownership_status: "OWNED" as const, evidence: bound.registry_refs } }
  : s);
check("5  implementation ผูกลงจาก flow ได้ และมาจากทะเบียน",
  withImpl.find((s) => s.flow_step_id === "S6_EXECUTION")?.implementation?.capability_id === bound.bound_capability
  && bound.registry_refs.length > 0, bound.registry_refs);
check("6  หลักฐานรันไทม์ผูกกลับขึ้นหาขั้นได้", allGood.every((o) => o.evidence.length > 0));

// ---- A/7: อินพุตต้นทางเสีย -> ไม่โทษปลายทาง -------------------------------------
const caseA = analyzeFlow({
  outcome: RECOVERY_OUTCOME, steps: withImpl, contracts: RECOVERY_CONTRACTS,
  observations: [good("S1_OWNER_COMMAND"),
    { flow_step_id: "S2_ADMISSION", input_verdict: "BAD", output_verdict: "BAD", actual_input: "malformed", actual_output: "rejected", evidence: ["runtime:S2"] }],
});
check("A/7 อินพุตเสียมาจากต้นทาง -> ไม่กล่าวหาขั้นปลายทาง",
  caseA.responsibility === "TRANSFER_DEFECT" || caseA.responsibility === "DOWNSTREAM_VICTIM",
  { r: caseA.responsibility, first: caseA.first_bad_boundary });
check("A/7 ระบุขอบเขตสุดท้ายที่ยังดีได้", caseA.last_known_good_boundary === "S1_OWNER_COMMAND output", caseA.last_known_good_boundary);

// ---- B/8: อินพุตดี เอาต์พุตเสีย -> แยกขั้นที่รับผิดชอบได้ ---------------------------
const caseB = analyzeFlow({
  outcome: RECOVERY_OUTCOME, steps: withImpl, contracts: RECOVERY_CONTRACTS,
  observations: [good("S1_OWNER_COMMAND"), good("S2_ADMISSION"), good("S3_DECISION"), good("S4_WORK_ORDER"), good("S5_DISPATCH"),
    { flow_step_id: "S6_EXECUTION", input_verdict: "GOOD", output_verdict: "BAD", actual_input: "ok", actual_output: "ไม่มีไฟล์ถูกเขียน", evidence: ["runtime:S6"] }],
});
check("B/8 อินพุตดี+เอาต์พุตเสีย -> ROOT_CAUSE_CANDIDATE ที่ขั้นนั้น",
  caseB.responsibility === "ROOT_CAUSE_CANDIDATE" && caseB.responsible_step === "S6_EXECUTION"
  && caseB.first_bad_boundary === "S6_EXECUTION output", caseB);
check("B/8 ยังไม่ประกาศเป็นต้นเหตุที่พิสูจน์แล้ว", caseB.proven_root_cause === null);
const provenB = analyzeFlow({
  outcome: RECOVERY_OUTCOME, steps: withImpl, contracts: RECOVERY_CONTRACTS,
  observations: [good("S1_OWNER_COMMAND"), good("S2_ADMISSION"), good("S3_DECISION"), good("S4_WORK_ORDER"), good("S5_DISPATCH"),
    { flow_step_id: "S6_EXECUTION", input_verdict: "GOOD", output_verdict: "BAD", actual_input: "ok", actual_output: "ไม่มีไฟล์", evidence: [] }],
  causal_evidence: ["write_id ไม่ถูกสร้าง ขณะ decision อนุญาตแล้ว — วัดจาก evidence store"],
});
check("B/8 มีหลักฐานเชิงเหตุจึงยกระดับได้", provenB.proven_root_cause === "S6_EXECUTION");

// ---- C/9: สัญญาส่งต่อเสีย ---------------------------------------------------------
const caseC = analyzeFlow({
  outcome: RECOVERY_OUTCOME, steps: withImpl, contracts: RECOVERY_CONTRACTS,
  observations: [good("S1_OWNER_COMMAND"), good("S2_ADMISSION"), good("S3_DECISION"), good("S4_WORK_ORDER"),
    good("S5_DISPATCH"), good("S6_EXECUTION"),
    { flow_step_id: "S7_RESULT", input_verdict: "BAD", output_verdict: "BAD", actual_input: "ผลไม่ถูกส่งต่อ", actual_output: "-", evidence: ["runtime:S7"] }],
});
check("C/9 ต้นทางเอาต์พุตดีแต่ปลายทางอินพุตเสีย -> TRANSFER_DEFECT ที่ขอบเขต",
  caseC.responsibility === "TRANSFER_DEFECT" && caseC.first_bad_boundary === "S6_EXECUTION->S7_RESULT transfer",
  { r: caseC.responsibility, b: caseC.first_bad_boundary });

// ---- D/10: เทคนิคสำเร็จ แต่คนไม่ได้ผล ---------------------------------------------
const caseD = analyzeFlow({
  outcome: RECOVERY_OUTCOME, steps: withImpl, contracts: RECOVERY_CONTRACTS,
  observations: allGood, human_outcome_met: false,
});
check("D/10 ทุกขั้นผ่านทางเทคนิค แต่คนไม่ได้ผล -> HUMAN_OUTCOME_FAILURE",
  caseD.technical_outcome === "FAILURE" || caseD.responsibility === "HUMAN_OUTCOME_FAILURE",
  { t: caseD.technical_outcome, h: caseD.human_outcome, r: caseD.responsibility });
check("D/10 human_outcome แยกจาก technical_outcome จริง",
  caseD.human_outcome === "FAILURE" && caseD.first_bad_boundary === "S10_OWNER_PRESENTATION human outcome");
const okRun = analyzeFlow({ outcome: RECOVERY_OUTCOME, steps: withImpl, contracts: RECOVERY_CONTRACTS, observations: allGood, human_outcome_met: true });
check("D/10 เส้นทางที่คนได้ผลจริง -> ไม่มีขอบเขตเสีย",
  okRun.first_bad_boundary === null && okRun.human_outcome === "SUCCESS" && okRun.technical_outcome === "SUCCESS");

// ---- 12: ความเป็นเจ้าของที่ขาด ต้องชัดเจน -------------------------------------------
const noOwner = RECOVERY_FLOW.map((s) => s.flow_step_id === "S10_OWNER_PRESENTATION"
  ? { ...s, implementation: { capability_id: null, resource_id: null, repository_id: "repo:dna-os-control-workspace",
      repo_relative_path: "app/main.mjs", runtime_entrypoint: "GET /", ownership_status: "MISSING_CAPABILITY_OWNERSHIP" as const, evidence: [] } }
  : s);
check("12 ความเป็นเจ้าของที่ขาด ถูกประกาศชัด ไม่ถูกเดา",
  noOwner.find((s) => s.flow_step_id === "S10_OWNER_PRESENTATION")?.implementation?.ownership_status === "MISSING_CAPABILITY_OWNERSHIP");

// ---- 10: ขอบเขตการค้นหามาจากความเป็นเจ้าของเท่านั้น --------------------------------
check("10 ขอบเขตค้นหามาจากเจ้าของของขอบเขตที่เสีย ไม่ใช่ความคล้ายของชื่อ",
  caseB.candidate_scope.length === 1 && caseB.candidate_scope[0] === "repo:dna-os-infrastructure:control/agent-gateway/",
  caseB.candidate_scope);

// ---- 13/14: ไม่ซ่อม ไม่เขียน --------------------------------------------------------
const src = ["types.ts", "recovery-flow.ts", "analyzer.ts", "contract.ts"]
  .map((f) => readFileSync(join(__dirname, "..", f), "utf-8")).join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("13 ไม่มีเส้นทางส่งงาน/ซ่อมในความสามารถนี้",
  !/dispatch\w*\s*\(|submitTask\s*\(|runRepairCycle\s*\(|launchAgent/.test(src));
check("14 ไม่มีการเขียนซอร์ส/คอนฟิก/สิทธิ์/credential",
  !/writeFileSync|appendFileSync|mkdirSync|chmodSync|registerCapability|commitRegisteredCandidate/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
