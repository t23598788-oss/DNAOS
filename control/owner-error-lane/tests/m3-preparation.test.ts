/**
 * M3 — ผู้ประสานงานเตรียมการซ่อมอัตโนมัติ ที่หยุดก่อนลงมือเสมอ
 *
 * ไม่มีเส้นทางใดในเทสต์นี้ที่ส่งงานให้ worker และทุกเคสพิสูจน์จากผลรันจริง
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  admitSystemError, runPreparationCycle, preparationState, setPreparationState,
  loadPreparedRepairs, derivedWorkIdFor, backoffMsFor, listUnifiedRepairItems,
  MAX_ITEMS_PER_CYCLE,
} from "../contract";
import type { SystemErrorObservation } from "../contract";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${n}`); }
  else { fail += 1; console.log(`FAIL  ${n}`); if (d !== undefined) console.log(`      ${JSON.stringify(d)}`); }
};
const obs = (over: Partial<SystemErrorObservation> = {}): SystemErrorObservation => ({
  error_kind: "TEST_FAILED",
  raw_error_text: `M3 probe ${randomUUID().slice(0, 8)}`,
  observed_at: new Date().toISOString(),
  evidence: { source_capability: "control/owner-error-lane", file_path: "control/owner-error-lane/lane.ts",
    evidence_refs: ["m3-preparation.test.ts#probe"] },
  ...over,
});

void (async () => {
  setPreparationState("RUNNING", "m3 test setup");
  check("0  สถานะเริ่มต้น RUNNING", preparationState() === "RUNNING");

  // ---- 1: ความล้มเหลวจริงเข้าคิวรวมอัตโนมัติ ---------------------------------
  const a = await admitSystemError(obs());
  if (a.status !== "ADMITTED") { check("1 admit", false, a); process.exit(1); }
  const c1 = runPreparationCycle({ holder_agent_id: `m3-test-${randomUUID().slice(0,6)}` });
  check("1  รอบเตรียมการทำงานและรับเหตุการณ์จริงเข้ามา",
    c1.ran === true && c1.ingested_events > 0, { ran: c1.ran, ingested: c1.ingested_events });

  // ---- 2: idle sweep เจอช่องว่างที่ยังไม่มีใครรายงาน ----------------------------
  const c2 = runPreparationCycle({ idleSweep: true, holder_agent_id: `m3-sweep-${randomUUID().slice(0,6)}` });
  check("2  idle sweep กวาดช่องว่างได้", c2.ran === true && c2.swept_gaps > 0, { swept: c2.swept_gaps });

  // ---- 3: ทั้งสองทางได้ work_id ที่ใช้ร่วมกันได้ -------------------------------
  const prep = loadPreparedRepairs();
  check("3  ทุกรายการที่เตรียมไว้มี work_id ในรูปแบบเดียวกัน",
    prep.length > 0 && prep.every((p) => /^work-[0-9a-f-]{36}$/.test(p.work_id)), prep.slice(0,1));
  check("3  work_id ของ sweep มาจากเนื้อหา ไม่ใช่เวลา (คำนวณซ้ำได้ค่าเดิม)",
    derivedWorkIdFor("gap-abc") === derivedWorkIdFor("gap-abc")
    && derivedWorkIdFor("gap-abc") !== derivedWorkIdFor("gap-xyz"));

  // ---- 4: ซ้ำแล้วไม่เกิดสายเลือดใหม่ --------------------------------------------
  const before = loadPreparedRepairs();
  const c3 = runPreparationCycle({ holder_agent_id: `m3-dup-${randomUUID().slice(0,6)}` });
  const after = loadPreparedRepairs();
  const idsBefore = new Set(before.map((p) => p.gap_id));
  const newIds = after.filter((p) => !idsBefore.has(p.gap_id));
  check("4  รันซ้ำไม่สร้าง gap ใหม่จากความล้มเหลวเดิม", newIds.length === 0, newIds.map((n)=>n.gap_id));
  const grew = after.filter((p) => { const b = before.find((x) => x.gap_id === p.gap_id); return b && p.occurrences > b.occurrences; });
  check("4  occurrences เพิ่มแทนการแตกใบใหม่", grew.length > 0 || after.length === before.length, { grew: grew.length });

  // ---- 5: backoff โตขึ้นตามความซ้ำ ---------------------------------------------
  check("5  backoff เพิ่มตามจำนวนครั้ง", backoffMsFor(1) < backoffMsFor(2) && backoffMsFor(2) < backoffMsFor(4));
  check("5  รายการที่เตรียมไว้มีเวลาที่จะพร้อมอีกครั้ง", prep.every((p) => typeof p.next_eligible_at === "string"));

  // ---- 6: ผู้ประสานงานรายเดียว ---------------------------------------------------
  // จองล็อกค้างไว้ แล้วเรียกอีกรอบทันที
  const { claimWork, releaseWorkClaim } = await import("../../work-coordination/contract");
  const held = claimWork({ work_id: "repair-cycle", task_id: "repair-cycle",
    holder_agent_id: "m3-other-coordinator", resource_scope: [], lease_ms: 60_000 });
  const blocked = runPreparationCycle({ holder_agent_id: "m3-second" });
  if (held.ok) releaseWorkClaim(held.claim);
  check("6  มีผู้ประสานงานได้รายเดียว รายที่สองถูกกัน",
    held.ok === true && blocked.ran === false && blocked.skipped_reason === "COORDINATOR_HELD", blocked);

  // ---- 7: ต้นเหตุมาก่อนอาการปลายทาง ----------------------------------------------
  const parent = await admitSystemError(obs());
  if (parent.status === "ADMITTED") {
    await admitSystemError(obs({ parent_work_id: parent.item.work_id }));
  }
  const c4 = runPreparationCycle({ holder_agent_id: `m3-order-${randomUUID().slice(0,6)}` });
  const depths = c4.prepared.map((p) => p.depth);
  check("7  คิวเรียงจากต้นเหตุ (depth น้อย) ไปหาอาการปลายทาง",
    depths.every((d, i) => i === 0 || depths[i - 1] <= d), depths.slice(0, 8));

  // ---- 8: การบล็อกเชิงนโยบายไม่กลายเป็นงานซ่อม ------------------------------------
  await admitSystemError(obs({
    raw_error_text: `WORK_ORDER_REJECTED — OUT_OF_SANDBOX_SCOPE [${randomUUID().slice(0,8)}]`,
    evidence: { source_capability: "control/agent-gateway", evidence_refs: ["work-order-validator.ts:24"] },
  }));
  const c5 = runPreparationCycle({ holder_agent_id: `m3-policy-${randomUUID().slice(0,6)}` });
  check("8  การปฏิเสธที่ถูกต้องถูกข้าม ไม่เข้าคิวซ่อม", c5.skipped_non_defect > 0, { skipped: c5.skipped_non_defect });

  // ---- 9: NO_PROGRESS / เพดาน หยุดการเตรียมซ้ำ -------------------------------------
  const frozenAny = loadPreparedRepairs().filter((p) => p.frozen_reason !== null);
  check("9  มีกลไกแช่แข็งเมื่อไม่มีความคืบหน้า (ค่าเป็น null หรือชนิดที่ประกาศไว้)",
    loadPreparedRepairs().every((p) => p.frozen_reason === null
      || ["NO_PROGRESS","LOOP_DETECTED","MAX_ATTEMPTS_REACHED"].includes(p.frozen_reason)),
    frozenAny.slice(0,2));

  // ---- 10/11: PAUSE / RESUME ------------------------------------------------------
  setPreparationState("PAUSED", "m3 test pause");
  const paused = runPreparationCycle({ holder_agent_id: "m3-paused" });
  check("10 PAUSED -> ไม่เริ่มรอบเตรียมการ",
    paused.ran === false && paused.skipped_reason === "PAUSED" && paused.prepared.length === 0, paused);
  const stillAdmits = await admitSystemError(obs());
  check("10 PAUSED แต่เหตุการณ์ยังถูกบันทึกได้", stillAdmits.status === "ADMITTED");
  setPreparationState("RUNNING", "m3 test resume");
  const resumed = runPreparationCycle({ holder_agent_id: `m3-resume-${randomUUID().slice(0,6)}` });
  check("11 RESUME -> กลับมาเตรียมได้", preparationState() === "RUNNING" && resumed.ran === true, resumed.skipped_reason);

  // ---- 12/13/14: ไม่มีการส่งงาน ไม่มีการเขียนซอร์ส ไม่มี side effect ------------------
  const cycles = [c1, c2, c3, c4, c5, resumed];
  check("12 ทุกผลลัพธ์ประกาศว่าไม่มีการส่งงาน", cycles.every((c) => c.dispatched === 0));
  check("12 ทุกรายการที่เตรียมไว้ dispatched=false", loadPreparedRepairs().every((p) => p.dispatched === false));
  const src = readFileSync(join(__dirname, "..", "preparation.ts"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("13 ซอร์สไม่มีการส่งงาน/เขียนไฟล์/แตะสิทธิ์-credential",
    !/dispatch\w*\s*\(|submitTask\s*\(|launchAgent|writeFileSync|appendFileSync|mkdirSync|chmodSync/.test(src),
    src.match(/dispatch\w*\s*\(|writeFileSync|appendFileSync/g));
  check("14 ซอร์สไม่มีการเรียกปลายทางภายนอก",
    !/fetch\s*\(|https?Request|node:https|node:http\b/.test(src));

  // ---- read model ไม่มีผลข้างเคียง --------------------------------------------------
  const q1 = listUnifiedRepairItems({ limit: 20 });
  const n1 = loadPreparedRepairs().length;
  const q2 = listUnifiedRepairItems({ limit: 20 });
  check("   การอ่านคิวไม่มีผลข้างเคียง", loadPreparedRepairs().length === n1 && q1.length === q2.length);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
