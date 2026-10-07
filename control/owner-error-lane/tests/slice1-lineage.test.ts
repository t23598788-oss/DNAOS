/**
 * SLICE 1 (M5/M1/M2) — สายเลือดเดียวตลอดระบบ
 *
 * ใช้ความล้มเหลวจริงที่ผลิตขึ้นแบบควบคุม ไม่มีการส่งงานให้ worker ใด และ
 * ไม่มีเส้นทางใดในไฟล์นี้ที่เรียก dispatch ได้
 */
import { randomUUID } from "node:crypto";
import {
  admitSystemError, linkAdmittedErrorToRepairLoop, classifyNonDefect,
  gapFromConsoleItem, gapIdForError, listUnifiedRepairItems,
} from "../contract";
import type { SystemErrorObservation } from "../contract";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${n}`); }
  else { fail += 1; console.log(`FAIL  ${n}`); if (d !== undefined) console.log(`      ${JSON.stringify(d)}`); }
};

const obs = (over: Partial<SystemErrorObservation> = {}): SystemErrorObservation => ({
  error_kind: "TEST_FAILED",
  raw_error_text: `AssertionError: expected 6 PASS, received 5 [${randomUUID().slice(0, 8)}]`,
  observed_at: new Date().toISOString(),
  evidence: {
    source_capability: "control/owner-error-lane", test_or_build_name: "slice1.test.ts",
    exit_code: 1, stderr: "AssertionError", file_path: "control/owner-error-lane/lane.ts",
    evidence_refs: ["control/owner-error-lane/tests/slice1-lineage.test.ts#case1"],
  },
  ...over,
});

void (async () => {
  // ---- 1: หนึ่งความล้มเหลว = หนึ่งสายเลือด ---------------------------------
  const o = obs();
  const a = await admitSystemError(o);
  check("1  ความล้มเหลวถูกรับเข้า", a.status === "ADMITTED", a);
  if (a.status !== "ADMITTED") { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }
  const item = a.item;
  const link = linkAdmittedErrorToRepairLoop(item);
  check("1  GapRecord พก work_id เดิม ไม่สร้างใหม่",
    link.gap.work_id === item.work_id && link.gap.work_id !== undefined, { gap: link.gap.work_id, item: item.work_id });
  check("1  source_event ถูกรักษาไว้", link.gap.source_event_id === item.origin_event_id);
  check("1  gap identity แยกจาก work identity", link.gap.gap_id.startsWith("gap-") && link.gap.gap_id !== link.gap.work_id);

  // ---- 2: ซ้ำแล้วไม่เกิดงานใหม่ ----------------------------------------------
  const again = await admitSystemError(o);
  check("2  ความล้มเหลวเดิม -> ถูกกันซ้ำที่ชั้นรับเข้า", again.status === "DUPLICATE_SUPPRESSED", again);
  check("2  gap_id ของความล้มเหลวเดิมคงที่ (นับ occurrence ได้ ไม่แตกใบใหม่)",
    gapIdForError(item) === gapIdForError({ ...item, recorded_at: "2027-01-01T00:00:00.000Z" }));
  const bumped = gapFromConsoleItem(item, 7);
  check("2  occurrences เพิ่มได้บน gap เดิม", bumped.gap_id === link.gap.gap_id && bumped.occurrences === 7);

  // ---- 3: อาการปลายทางผูกกับต้นเหตุเมื่อมีหลักฐาน ------------------------------
  const parentWork = item.work_id;
  const childAdmit = await admitSystemError(obs({ parent_work_id: parentWork }));
  check("3  งานลูกชี้ขึ้นหาต้นเหตุด้วย upstream + depth",
    childAdmit.status === "ADMITTED"
    && linkAdmittedErrorToRepairLoop(childAdmit.item).gap.upstream[0] === parentWork
    && linkAdmittedErrorToRepairLoop(childAdmit.item).gap.depth === 1);
  check("3  ไม่มี upstream เมื่อไม่มีหลักฐานความพึ่งพา", link.gap.upstream.length === 0 && link.gap.depth === 0);

  // ---- 4: การปฏิเสธที่ถูกต้อง ไม่กลายเป็นงานซ่อม --------------------------------
  const rejection = obs({
    raw_error_text: `WORK_ORDER_REJECTED — OUT_OF_SANDBOX_SCOPE, WORKSPACE_SCOPE_MISMATCH [${randomUUID().slice(0, 8)}]`,
    evidence: { source_capability: "control/agent-gateway", evidence_refs: ["work-order-validator.ts:24"] },
  });
  const rejAdmit = await admitSystemError(rejection);
  check("4  ประตูที่ทำงานถูก -> VALID_REJECTION ไม่ส่งซ่อม",
    rejAdmit.status === "ADMITTED"
    && linkAdmittedErrorToRepairLoop(rejAdmit.item).linked === false
    && (linkAdmittedErrorToRepairLoop(rejAdmit.item) as { reason: string }).reason === "VALID_REJECTION",
    rejAdmit.status === "ADMITTED" ? linkAdmittedErrorToRepairLoop(rejAdmit.item) : rejAdmit);
  const denied = await admitSystemError(obs({
    raw_error_text: `DENIED EXTERNAL_RESOURCE_POLICY_NOT_DEFINED [${randomUUID().slice(0, 8)}]`,
    evidence: { source_capability: "control-workspace/outbound", evidence_refs: ["outbound.mjs#gate"] },
  }));
  check("4  การบล็อกเชิงนโยบายที่ถูกต้อง -> ไม่ส่งซ่อม",
    denied.status === "ADMITTED" && linkAdmittedErrorToRepairLoop(denied.item).linked === false);
  for (const kind of ["CREDENTIAL_CHANGE", "PRODUCTION_DELETION", "SECURITY_DENIAL"] as const) {
    const r = classifyNonDefect({ ...item, error_kind: kind });
    if (r === null) { check(`4  ${kind} ต้องไม่เป็นเป้าหมายซ่อม`, false, r); break; }
  }
  check("4  ทุกชนิดที่ต้องให้ Owner ตัดสิน ไม่เป็นเป้าหมายซ่อม",
    (["CREDENTIAL_CHANGE", "PRODUCTION_DELETION", "SECURITY_DENIAL", "PRIVILEGE_ESCALATION"] as const)
      .every((k) => classifyNonDefect({ ...item, error_kind: k }) !== null));

  // ---- 5: สองระบบ resolve work_id เดียวกัน -------------------------------------
  check("5  owner-error-lane และ repair-loop เห็น work_id เดียวกัน",
    item.work_id === link.gap.work_id);

  // ---- 6: read model แสดงหนึ่งรายการต่อหนึ่งของเสีย ------------------------------
  const unified = listUnifiedRepairItems({ gaps: [link.gap, bumped], limit: 200 });
  const mine = unified.filter((u) => u.work_id === item.work_id);
  check("6  หนึ่งของเสีย = หนึ่งรายการ แม้ส่ง gap ซ้ำสองใบ", mine.length === 1, mine.length);
  const u = mine[0];
  check("6  รายการรวมมีตัวตนครบสามชั้น",
    u.work_id === item.work_id && u.gap_id === link.gap.gap_id && u.owner_console_id === item.command_id, u);
  check("6  ช่องที่ยังไม่รู้เป็น null ไม่ใช่ค่าที่ดูเหมือนเคยวิเคราะห์แล้ว",
    u.root_cause === null && u.stop_condition === null);

  // ---- 7: หลักฐานตามรอยได้ตลอดสาย ---------------------------------------------
  check("7  evidence_refs โยงกลับถึง event และคอนโซล",
    u.evidence_refs.some((r) => r.includes(String(item.origin_event_id)))
    && u.evidence_refs.some((r) => r.includes(item.command_id)), u.evidence_refs);

  // ---- 8: หยุดก่อนถึง Agent เสมอ ------------------------------------------------
  check("8  ไม่มีการส่งงานให้ worker ในเส้นทางนี้",
    link.linked === true ? link.dispatched === false : true);
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "repair-link.ts"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("8  ซอร์สไม่มีเส้นทางเรียก dispatch/submitTask/launch เลย",
    !/dispatch\w*\s*\(|submitTask\s*\(|launchAgent|startAgent/.test(src), src.match(/dispatch\w*\s*\(|submitTask\s*\(/g));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
