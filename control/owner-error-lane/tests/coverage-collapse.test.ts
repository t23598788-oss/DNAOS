/**
 * CAPABILITY_OWNERSHIP_COVERAGE + CAUSAL_COLLAPSE — พิสูจน์จากทะเบียนจริง
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bindFailureEvidence, collapseSymptoms, loadPreparedRepairs, runPreparationCycle } from "../contract";
import type { OwnerConsoleItem } from "../contract";
import type { PreparedRepairRecord } from "../preparation";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${n}`); }
  else { fail += 1; console.log(`FAIL  ${n}`); if (d !== undefined) console.log(`      ${JSON.stringify(d)}`); }
};
const ci = (fp?: string, extra: Partial<OwnerConsoleItem> = {}): OwnerConsoleItem => ({
  origin_kind: "SYSTEM_ERROR_COMMAND", owner_visible: true, origin_event_id: `evt-${randomUUID().slice(0,8)}`,
  command_id: `cmd_${randomUUID()}`, task_id: "t", work_id: `work-${randomUUID()}`, parent_work_id: null,
  error_kind: "TEST_FAILED", raw_command_text: "probe", status: "B", current_action: "",
  evidence: fp ? { file_path: fp } : {}, auto_dispatch: null, recorded_at: new Date().toISOString(), ...extra,
});
const rec = (o: Partial<PreparedRepairRecord>): PreparedRepairRecord => ({
  gap_id: `gap-${randomUUID().slice(0,8)}`, work_id: `work-${randomUUID()}`, source_event_id: null,
  origin: "EVENT", root_cause: "IMPLEMENTATION_DEFECT", repair_type: "CODE_DEFECT", repair_id: "r1",
  stop_condition: null, non_defect_reason: null, occurrences: 1, depth: 1, upstream: ["work-root"],
  attempt_count: 0, next_eligible_at: new Date().toISOString(), frozen_reason: null,
  evidence_refs: [], binding_status: "EXACT", bound_component: "x", bound_capability: "cap-1",
  registry_refs: ["r"], missing_evidence: [], observed_at: "svc", proven_cause: null,
  first_seen: "", last_seen: "", prepared_at: "", dispatched: false, ...o,
});

// ---- 1: path ที่ลงทะเบียนจริง -> เจ้าของจริง --------------------------------
const owned = bindFailureEvidence(ci("control/runtime-control/resolver.ts"));
check("1  path ที่ทะเบียนครอบ -> EXACT + capability จริง + registry ref",
  owned.binding_status === "EXACT" && owned.bound_capability !== null && owned.registry_refs.length === 2,
  { s: owned.binding_status, cap: owned.bound_capability });

// ---- 2: ไฟล์ประกอบสืบทอดเจ้าของที่พิสูจน์ได้เท่านั้น ----------------------------
const contract = bindFailureEvidence(ci("control/runtime-control/contract.ts"));
check("2  ไฟล์ที่มีเจ้าของเฉพาะตัว ไม่ถูกกลืนโดยเจ้าของระดับโฟลเดอร์",
  contract.binding_status === "EXACT" && contract.bound_capability !== owned.bound_capability,
  { file: contract.bound_capability, folder: owned.bound_capability });

// ---- 3/4: TEST_ONLY และของนอกทะเบียน ไม่ถูกเดา -------------------------------
const testOnly = bindFailureEvidence(ci("test/acceptance.mjs"));
check("3  ไฟล์เทสต์ของอีกรีโป ไม่ถูกยกเป็น capability production",
  testOnly.binding_status === "UNRESOLVED" && testOnly.bound_capability === null);
const unknown = bindFailureEvidence(ci("app/main.mjs"));
check("4  path ที่ไม่มีเจ้าของ -> UNRESOLVED พร้อมเหตุผล ไม่เดา",
  unknown.binding_status === "UNRESOLVED" && unknown.missing_evidence.includes("MISSING_REGISTRY_RELATION"),
  unknown.missing_evidence);

// ---- 5: ไม่สร้าง capability ใหม่ --------------------------------------------
const capsBefore = readFileSync("software/registry-database/data/canonical/capabilities.jsonl", "utf-8").split("\n").filter((l) => l.trim()).length;
bindFailureEvidence(ci("software/system-graph/projection.ts"));
const capsAfter = readFileSync("software/registry-database/data/canonical/capabilities.jsonl", "utf-8").split("\n").filter((l) => l.trim()).length;
check("5  การผูกไม่สร้างแถวทะเบียนใหม่เลย", capsBefore === capsAfter, { capsBefore, capsAfter });
const src = readFileSync(join(__dirname, "..", "evidence-binding.ts"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
check("5  ตัวผูกไม่มีเส้นทางเขียนทะเบียน", !/commitRegisteredCandidate|registerCapability|writeFileSync|appendFileSync/.test(src));

// ---- 6/7: อยู่รอด restart และตัวเตรียมใช้ข้อมูลจากทะเบียน -------------------------
const cyc = runPreparationCycle({ holder_agent_id: `cov-${randomUUID().slice(0,6)}` });
const exact = loadPreparedRepairs().filter((p) => p.binding_status === "EXACT");
check("6/7 ตัวเตรียมบริโภคความเป็นเจ้าของจากทะเบียน และคงอยู่ข้ามโปรเซส",
  cyc.ran === true && exact.length > 0 && exact.every((e) => e.registry_refs.length > 0),
  { exact: exact.length });

// ---- 9/10/11: การยุบอาการ ------------------------------------------------------
const noProof = collapseSymptoms([rec({}), rec({}), rec({})]);
check("9  ต้นน้ำร่วมอย่างเดียว ไม่ยุบ และไม่กดอาการใด",
  noProof.root_incidents.length === 1 && noProof.proven_root_cause_count === 0
  && noProof.collapsed_symptom_count === 0 && noProof.downstream_repair_suppressed_count === 0, noProof);
const proven = collapseSymptoms([
  rec({ proven_cause: "cap-root", evidence_refs: ["binding:causal proof"] }),
  rec({}), rec({}), rec({}),
]);
check("9  มีหลักฐานเชิงเหตุ -> อาการ 4 ยุบเหลือ root เดียว",
  proven.root_incidents.length === 1 && proven.proven_root_cause_count === 1
  && proven.collapsed_symptom_count === 4 && proven.ready_root_repair_count === 1,
  { inc: proven.root_incidents.length, collapsed: proven.collapsed_symptom_count });
const unrelated = collapseSymptoms([rec({ upstream: ["work-a"] }), rec({ upstream: ["work-b"] })]);
check("10 อาการที่ไม่เกี่ยวกัน แยกกันอยู่", unrelated.root_incidents.length === 2);
check("11 อาการปลายทางถูกกดไว้เมื่อต้นเหตุพิสูจน์แล้วและยังไม่ถูกแก้",
  proven.downstream_repair_suppressed_count === 4 && proven.root_incidents[0].suppressed_downstream.length === 4);
const independent = collapseSymptoms([rec({ upstream: [] })]);
check("11 อาการที่ไม่มีต้นน้ำ ไม่ถูกกด", independent.independent.length === 1 && independent.downstream_repair_suppressed_count === 0);

// ---- 12: ไม่มีการส่งงาน ----------------------------------------------------------
check("12 ไม่มีการส่งงานเลย", cyc.dispatched === 0 && loadPreparedRepairs().every((p) => p.dispatched === false));
const csrc = readFileSync(join(__dirname, "..", "causal-collapse.ts"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
check("12 ตัวยุบอาการไม่มีเส้นทางส่งงาน/เขียนไฟล์", !/dispatch\w*\s*\(|submitTask\s*\(|writeFileSync/.test(csrc));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
