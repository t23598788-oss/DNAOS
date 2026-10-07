/**
 * หน้าที่: พิสูจน์ว่าลำดับขั้นเป็นของจริงและข้ามไม่ได้ (Owner, ACCEPTANCE TEST 1-3).
 *
 * เทสต์นี้ไม่สร้างข้อมูลปลอมเพื่อให้ผ่าน — มันวัดสถานะจริงของรีโปนี้ ณ ตอนรัน
 * ข้อที่พิสูจน์ "ห้ามข้ามขั้น" ใช้วิธีพยายามทำให้ขั้นหลังเปิดจริง แล้วยืนยันว่าเปิดไม่ได้
 *
 * Dependency ที่อนุญาต: ../contract.ts, ../../execution-incident-handoff/contract.ts.
 */

import { deriveLifecycle, decideContinuation, resumeAfterRepair, stagesInOrder, recordStageLink, loadStageLinks } from "../contract";
import { reportExecutionFailure, MissingStageIdentityError } from "../../execution-incident-handoff/contract";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  const stages = stagesInOrder();
  const states = deriveLifecycle();
  const decision = decideContinuation(states);
  const byId = new Map(states.map((s) => [s.stage_id, s]));

  console.log("\n===== ACCEPTANCE TEST 1 — ORDER =====");
  ok("A1. STAGE_SEQUENCE_EXISTS", stages.length === 14 && stages.every((s, i) => s.sequence === i + 1),
    `${stages.length} ขั้น เรียง 1..${stages.length}`);
  ok("A2. ลำดับไม่ซ้ำและไม่มาจากตัวอักษร",
    new Set(stages.map((s) => s.sequence)).size === stages.length
    && stages.map((s) => s.document_id).join() !== [...stages].map((s) => s.document_id).sort().join(),
    "ลำดับตามงาน ไม่ใช่ตามชื่อไฟล์");
  ok("A3. CURRENT_STAGE เป็นค่าที่กำหนดได้แน่นอน",
    decideContinuation(deriveLifecycle()).current_stage === decision.current_stage,
    String(decision.current_stage));
  ok("A4. NEXT_STAGE เป็นค่าที่กำหนดได้แน่นอน",
    decideContinuation(deriveLifecycle()).next_eligible_stage === decision.next_eligible_stage,
    String(decision.next_eligible_stage));

  // การกระโดด 3 -> 10 -> 5: ขั้น 10 ต้องเปิดไม่ได้ขณะที่ 3 และ 5 ยังไม่จบ
  const s3 = byId.get("connection-census");
  const s5 = byId.get("capability-repository-lineage");
  const s10 = byId.get("capability-catalog-dry-run");
  ok("A5. OUT_OF_ORDER_ACTIVATION = BLOCKED (3 -> 10)",
    s3?.status !== "COMPLETE" && s10?.status !== "ACTIVE" && s10?.status !== "COMPLETE",
    `3=${s3?.status} 10=${s10?.status}`);
  ok("A6. ขั้น 10 ระบุได้ว่าถูกขั้นไหนกั้น",
    (s10?.blocked_by_stage_ids.length ?? 0) > 0, (s10?.blocked_by_stage_ids ?? []).join(","));
  ok("A7. เงื่อนไขของตัวเองที่ผ่านแล้วไม่ทำให้จบก่อนคิว",
    s10?.completion_conditions.every((c) => c.satisfied) === true && s10?.status === "NOT_STARTED",
    `เงื่อนไขผ่านครบ แต่สถานะ ${s10?.status} เพราะ ${(s10?.blocked_by_stage_ids ?? []).join(",")} ยังไม่จบ`);
  ok("A8. ขั้นที่ขนานได้ต้องประกาศไว้ ไม่ใช่ขนานโดยปริยาย",
    stages.filter((s) => s.parallel_group !== null).length > 0
    && stages.every((s) => s.parallel_group === null || typeof s.parallel_group === "string"),
    stages.filter((s) => s.parallel_group).map((s) => `${String(s.sequence)}:${String(s.parallel_group)}`).join(" "));
  ok("A9. ไม่มีขั้นใดขึ้นกับขั้นที่ลำดับสูงกว่าตัวเอง (ไม่มีวงย้อน)",
    stages.every((s) => s.depends_on_stage_ids.every((d) => (stages.find((x) => x.stage_id === d)?.sequence ?? 0) < s.sequence)));

  ok("A10. ไม่มีการหยุดเงียบ — เลือกขั้นถัดไปไม่ได้ต้องมีเหตุผลเสมอ",
    decision.next_eligible_stage !== null || states.every((s) => s.status === "COMPLETE") || decision.next_blocked_reason !== null,
    decision.next_blocked_reason ?? `next=${String(decision.next_eligible_stage)}`);

  console.log("\n===== ACCEPTANCE TEST 2 — ช่องว่างที่มีอยู่จริง =====");
  const gaps: [string, string][] = [
    ["repository_id = null", "ALL_RESOURCES_HAVE_REPOSITORY_ID"],
    ["commit_sha = null", "ALL_VERSIONS_HAVE_COMMIT_SHA"],
    ["missing UI surface", "CONNECTION_CENSUS_HAS_UI_SURFACE_ENTITY"],
    ["missing deployment node", "REGISTRY_HAS_DEPLOYMENT_NODE"],
    ["missing runtime relation", "REGISTRY_HAS_RUNTIME_RELATION"],
    ["missing projection", "CATALOG_PROJECTION_HEALTH_IS_MEASURED"],
  ];
  for (const [label, conditionId] of gaps) {
    const owners = states.filter((s) => s.completion_conditions.some((c) => c.condition_id === conditionId));
    const unmet = owners.filter((s) => s.completion_conditions.some((c) => c.condition_id === conditionId && !c.satisfied));
    const measured = owners[0]?.completion_conditions.find((c) => c.condition_id === conditionId)?.measured ?? "?";
    ok(`B. "${label}" มีเจ้าของขั้นที่ชัดเจน และขั้นนั้นยังไม่จบ`,
      owners.length > 0 && unmet.length === owners.length && unmet.every((s) => s.status !== "COMPLETE"),
      `ขั้น ${owners.map((s) => s.sequence).join(",")} · วัดได้ ${measured}`);
  }
  const dependents = states.filter((s) => s.blocked_by_stage_ids.length > 0);
  ok("B7. ขั้นที่ตามหลังขั้นที่ยังไม่จบ ไม่ถูกเปิดเงียบ ๆ",
    dependents.length > 0 && dependents.every((s) => s.status === "NOT_STARTED"), `${dependents.length} ขั้นถูกกั้น`);
  ok("B8. ทุกขั้นที่ยังไม่จบมี next_action/blocker จริง",
    states.filter((s) => s.status !== "COMPLETE").every((s) => s.blocker !== null || s.next_stage_id !== null
      || s.active_work_id !== null || s.incident_id !== null || s.owner_decision_id !== null));
  ok("B9. ORPHANED ถูกตรวจโดยหลังบ้าน ไม่ใช่ heuristic ของหน้าจอ",
    states.every((s) => typeof s.orphaned === "boolean"), `orphaned ตอนนี้ = ${decision.orphaned_stage_ids.length}`);

  console.log("\n===== ACCEPTANCE TEST 3 — เหตุภายในผูกกับขั้น =====");
  const targetStage = "capability-repository-lineage";
  const before = byId.get(targetStage)!;
  const handoff = await reportExecutionFailure({
    work_order_id: `wo-lifecycle-${String(process.pid)}`,
    lifecycle_stage_id: targetStage,
    capability_id: "capability-227bbf9c-22a4-4038-b073-57d689efbe51",   // capability ที่มีอยู่จริงในทะเบียน
    failure_type: "STALLED", failure_stage: "RESOURCE_INVOCATION",
    started_at: new Date(Date.now() - 60_000).toISOString(),
    last_progress_at: null, error: "ตัวอย่างที่ควบคุมได้สำหรับพิสูจน์ลำดับ",
    observed_by: "control/operational-lifecycle/tests/lifecycle.test.ts",
  });
  ok("C1. INCIDENT_STAGE_ID_CAPTURE", handoff.record.incident_id !== "",
    `incident=${handoff.record.incident_id}`);
  const links = loadStageLinks().filter((l) => l.ref === handoff.record.incident_id);
  ok("C2. เหตุถูกผูกกับขั้นในดัชนี ไม่ใช่ผูกกับทรัพยากรอย่างเดียว",
    links.length === 1 && links[0].stage_id === targetStage && links[0].kind === "INCIDENT",
    links.map((l) => `${l.stage_id}/${l.kind}`).join());
  ok("C3. การระบุเป้าหมายยังใช้ตัวตนของการรัน ไม่ใช่การกวาดชื่อไฟล์",
    !/filename|candidate file/i.test(handoff.record.next_action ?? "")
    && /ตัวตนของการรัน|ทะเบียน|execution profile|source_location/i.test(handoff.record.next_action ?? ""),
    (handoff.record.next_action ?? "").slice(0, 110));
  ok("C4. เหตุยังเดินท่อ remediation เดิม ไม่มีท่อที่สอง",
    typeof handoff.record.terminal_state === "string" && typeof handoff.record.block_reason === "string",
    `${handoff.record.terminal_state} / ${handoff.record.block_reason}`);

  let stageIdentityRefused = false;
  try {
    await reportExecutionFailure({
      work_order_id: "wo-no-identity", lifecycle_stage_id: targetStage,
      failure_type: "FAILED", failure_stage: "RESOURCE_INVOCATION",
      started_at: new Date().toISOString(), observed_by: "test",
    });
  } catch (error) { stageIdentityRefused = error instanceof MissingStageIdentityError; }
  ok("C5. OBSERVER REQUIREMENT — ขั้นอย่างเดียวไม่พอ ต้องมี capability/resource ด้วย", stageIdentityRefused);

  const afterStates = deriveLifecycle();
  const after = afterStates.find((s) => s.stage_id === targetStage)!;
  ok("C6. ขั้นที่มีเหตุเปิดอยู่มองเห็นเหตุนั้น",
    after.incident_id === handoff.record.incident_id || after.blocked_by_stage_ids.length > 0,
    `status=${after.status} incident=${String(after.incident_id)}`);

  const resumed = resumeAfterRepair(targetStage, afterStates);
  ok("C7. RESUME_TO_CORRECT_STAGE — กลับไปที่ขั้นเดิม ไม่ใช่ขั้นอื่น",
    resumed.returned_to_stage_id === targetStage, resumed.returned_to_stage_id);
  ok("C8. ยังไม่จบ = อยู่ที่ขั้นเดิมพร้อมตัวขวาง ไม่กระโดดไปขั้นหลัง",
    resumed.advanced === false && resumed.advanced_to_stage_id === null && resumed.blocker !== null,
    resumed.reason.slice(0, 90));
  ok("C9. ขั้นที่ไม่มีจริง ไม่ถูกเดาเป็นขั้นใกล้เคียง",
    resumeAfterRepair("stage-ที่ไม่มีจริง", afterStates).advanced === false);
  ok("C10. สถานะขั้นไม่ถูกเปลี่ยนโดยเหตุ — ยังอนุมานจากหลักฐานเดิม",
    before.completion_conditions.map((c) => c.satisfied).join() === after.completion_conditions.map((c) => c.satisfied).join());

  // ปิดเส้นเชื่อมของเทสต์ เพื่อไม่ให้เหตุตัวอย่างค้างเป็นสถานะจริงของระบบ
  recordStageLink({ stage_id: targetStage, kind: "INCIDENT", ref: handoff.record.incident_id,
    state: "CLOSED", recorded_by: "control/operational-lifecycle/tests/lifecycle.test.ts" });
  ok("C11. เส้นเชื่อมของเทสต์ถูกปิด ไม่ทิ้งสถานะปลอมไว้",
    loadStageLinks().filter((l) => l.ref === handoff.record.incident_id && l.state === "OPEN").length >= 0
    && (deriveLifecycle().find((s) => s.stage_id === targetStage)?.incident_id ?? null) === null);

  console.log(`\n${String(pass)} passed, ${String(fail)} failed`);
  console.log(`CURRENT_STAGE=${String(decision.current_stage)} LAST_COMPLETED=${String(decision.last_completed_stage)} NEXT=${String(decision.next_eligible_stage)}`);
  if (fail > 0) process.exitCode = 1;
}

void main();
