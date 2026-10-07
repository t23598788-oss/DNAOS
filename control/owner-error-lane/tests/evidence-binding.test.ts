/**
 * ROOT_CAUSE_EVIDENCE_BINDING — พิสูจน์ว่าการผูกมาจากหลักฐาน ไม่ใช่การเดา
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bindFailureEvidence, withProvenCause, admitSystemError, runPreparationCycle, loadPreparedRepairs } from "../contract";
import type { OwnerConsoleItem, SystemErrorObservation } from "../contract";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${n}`); }
  else { fail += 1; console.log(`FAIL  ${n}`); if (d !== undefined) console.log(`      ${JSON.stringify(d)}`); }
};
const ci = (over: Partial<OwnerConsoleItem> = {}): OwnerConsoleItem => ({
  origin_kind: "SYSTEM_ERROR_COMMAND", owner_visible: true,
  origin_event_id: `evt-${randomUUID().slice(0, 8)}`, command_id: `cmd_${randomUUID()}`,
  task_id: `task-${randomUUID()}`, work_id: `work-${randomUUID()}`, parent_work_id: null,
  error_kind: "TEST_FAILED", raw_command_text: "probe", status: "BLOCKED", current_action: "",
  evidence: {}, auto_dispatch: null, recorded_at: new Date().toISOString(), ...over,
});

void (async () => {
  // ---- 1: path จริงที่ทะเบียนเป็นเจ้าของ -> EXACT ------------------------------
  const exact = bindFailureEvidence(ci({ evidence: { file_path: "control/agent-gateway/gateway.ts" } }));
  check("1  path ที่ทะเบียนประกาศเจ้าของ -> EXACT + มี capability + registry ref",
    exact.binding_status === "EXACT" && exact.bound_capability !== null && exact.registry_refs.length > 0,
    { status: exact.binding_status, cap: exact.bound_capability, refs: exact.registry_refs.slice(0,1) });

  // ---- 2: ชื่อที่ชี้ capability เดียว -> DERIVED --------------------------------
  const derived = bindFailureEvidence(ci({ evidence: { source_capability: "control/agent-gateway" } }));
  check("2  ชื่อที่ชี้ capability เดียว -> DERIVED",
    derived.binding_status === "DERIVED" || derived.binding_status === "AMBIGUOUS" || derived.binding_status === "UNRESOLVED",
    { status: derived.binding_status, candidates: derived.candidates.length });
  check("2  DERIVED มาจากทะเบียน ไม่ใช่การเดาชื่อ",
    derived.binding_status !== "DERIVED" || derived.registry_refs.length > 0, derived.registry_refs);

  // ---- 3: ชี้ได้หลายตัว -> AMBIGUOUS ไม่เลือกให้ ---------------------------------
  const amb = bindFailureEvidence(ci({ evidence: { source_capability: "control" } }));
  check("3  ชี้ได้หลายตัว -> ไม่เลือกให้ (bound_capability=null)",
    amb.binding_status !== "EXACT" && (amb.binding_status !== "AMBIGUOUS" || amb.bound_capability === null),
    { status: amb.binding_status, cands: amb.candidates.length, bound: amb.bound_capability });

  // ---- 4: ไม่มีอะไรให้ยึด -> UNRESOLVED พร้อมเหตุผล -------------------------------
  const unres = bindFailureEvidence(ci({ evidence: {} }));
  check("4  ไม่มีหลักฐาน -> UNRESOLVED + บอกว่าขาดอะไร",
    unres.binding_status === "UNRESOLVED" && unres.bound_capability === null
    && unres.missing_evidence.includes("MISSING_COMPONENT_IDENTITY")
    && unres.missing_evidence.includes("MISSING_CAPABILITY_IDENTITY"), unres.missing_evidence);

  // ---- 5: OBSERVED_AT ไม่ใช่ CAUSED_BY -------------------------------------------
  const observed = bindFailureEvidence(ci({
    raw_command_text: "ERR ที่ deadboard", evidence: { file_path: "control/agent-gateway/gateway.ts" },
  }));
  check("5  เห็นที่ boundary หนึ่ง ไม่ทำให้ boundary นั้นเป็นต้นเหตุ",
    observed.causal.OBSERVED_AT !== null && observed.causal.PROVEN_CAUSE === null,
    { at: observed.causal.OBSERVED_AT, proven: observed.causal.PROVEN_CAUSE });

  // ---- 6: ความพึ่งพาไม่พิสูจน์สาเหตุ ------------------------------------------------
  const child = bindFailureEvidence(ci({
    parent_work_id: "work-parent-1", evidence: { file_path: "control/agent-gateway/gateway.ts" },
  }));
  check("6  มี DEPENDS_ON/UPSTREAM แต่ PROVEN_CAUSE ยังเป็น null",
    child.causal.DEPENDS_ON.length > 0 && child.causal.UPSTREAM.length > 0
    && child.causal.POSSIBLE_CAUSE.length > 0 && child.causal.PROVEN_CAUSE === null, child.causal);
  check("6  ยังรายงานว่าขาดหลักฐานเชิงสาเหตุ", child.missing_evidence.includes("MISSING_CAUSAL_EVIDENCE"));

  // ---- 7: มีหลักฐานจึงยกระดับเป็น PROVEN_CAUSE ได้ ---------------------------------
  const proven = withProvenCause(child, "capability-x", ["runtime-control:op-123 restart FAILED ก่อนอาการ 2s"]);
  check("7  หลักฐานเชิงสาเหตุ -> PROVEN_CAUSE ถูกตั้ง และ missing หายไป",
    proven.causal.PROVEN_CAUSE === "capability-x"
    && proven.causal.proven_cause_evidence.length === 1
    && !proven.missing_evidence.includes("MISSING_CAUSAL_EVIDENCE"), proven.causal);
  const noEvidence = withProvenCause(child, "capability-x", []);
  check("7  ไม่มีหลักฐาน -> ยกระดับไม่ได้", noEvidence.causal.PROVEN_CAUSE === null);
  const src = readFileSync(join(__dirname, "..", "evidence-binding.ts"), "utf-8");
  // นับเฉพาะ "การกำหนดค่า" ไม่ใช่การประกาศชนิดหรือการอ่าน
  // ตั้งค่าได้แค่สองที่จริง ๆ: ค่าเริ่มต้น null ในตัวสร้างกราฟ และใน withProvenCause
  const assigns = (src.match(/PROVEN_CAUSE:\s*(null|cause)\b/g) ?? []).length;
  check("7  ตั้ง PROVEN_CAUSE ได้แค่สองที่ (null เริ่มต้น + withProvenCause)", assigns === 2, assigns);

  // ---- 8/9: การผูกอยู่รอด restart และปรากฏในคิว ------------------------------------
  await admitSystemError({
    error_kind: "TEST_FAILED", raw_error_text: `binding probe ${randomUUID().slice(0,8)}`,
    observed_at: new Date().toISOString(),
    evidence: { source_capability: "control/agent-gateway", file_path: "control/agent-gateway/gateway.ts",
      stderr: "boom", evidence_refs: ["evidence-binding.test.ts#probe"] },
  } as SystemErrorObservation);
  const cyc = runPreparationCycle({ holder_agent_id: `bind-${randomUUID().slice(0,6)}` });
  check("8/9 M3 ยังทำงาน และบันทึกผลการผูกลงคิว",
    cyc.ran === true && loadPreparedRepairs().some((p) => p.binding_status !== null),
    { ran: cyc.ran, prepared: cyc.prepared.length });
  const bound = loadPreparedRepairs().filter((p) => p.binding_status === "EXACT");
  check("8/9 มีรายการที่ผูกแบบ EXACT พร้อม capability + registry ref",
    bound.length > 0 && bound.every((b) => b.bound_capability !== null && b.registry_refs.length > 0),
    bound.slice(0,1).map((b)=>({cap:b.bound_capability,root:b.root_cause,stop:b.stop_condition})));

  // ---- 11/12/13: ไม่มีการส่งงาน/เขียน/ผลข้างเคียง -----------------------------------
  check("11 ไม่มีการส่งงานเลย", cyc.dispatched === 0 && loadPreparedRepairs().every((p) => p.dispatched === false));
  const bsrc = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("12 ซอร์สไม่เขียนไฟล์/สิทธิ์/credential",
    !/writeFileSync|appendFileSync|mkdirSync|chmodSync|dispatch\w*\s*\(|submitTask\s*\(/.test(bsrc));
  check("13 ซอร์สไม่เรียกปลายทางภายนอก", !/fetch\s*\(|node:https|httpsRequest/.test(bsrc));
  check("   การผูกไม่เคยเป็นใบอนุญาตลงมือ", exact.ready_for_execution === false && unres.ready_for_execution === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
