/**
 * CASE 1–14: ความผิดพลาดของระบบกลายเป็นงานที่ตามรอยได้
 *
 * เทสต์นี้ไม่รันคำสั่งจริงและไม่ส่งงานให้ worker ใด — มันพิสูจน์ว่าเมื่อระบบ
 * สังเกตความล้มเหลว มันสร้างตัวตนครบสายและกันซ้ำได้จริง
 */
import { randomUUID } from "node:crypto";
import {
  admitSystemError, decideAutoDispatch, buildAiWorkPackage, errorEventIdOf,
  listOwnerConsoleItems, AUTO_DISPATCH_ELIGIBLE, OWNER_ATTENTION_REQUIRED, MAX_REPAIR_DEPTH,
} from "../contract";
import type { SystemErrorObservation } from "../contract";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${n}`); }
  else { fail += 1; console.log(`FAIL  ${n}`); if (d !== undefined) console.log(`      ${JSON.stringify(d)}`); }
};

const obs = (over: Partial<SystemErrorObservation> = {}): SystemErrorObservation => ({
  error_kind: "TEST_FAILED",
  raw_error_text: `owner-command test 5/6. Expected work_id but received null. [${randomUUID().slice(0, 8)}]`,
  observed_at: new Date().toISOString(),
  evidence: {
    source_capability: "control/owner-command", test_or_build_name: "owner-command.test.ts",
    exit_code: 1, stderr: "AssertionError: expected work_id, got null",
    file_path: "control/owner-command/owner-command.ts",
    evidence_refs: ["control/owner-command/tests/owner-command.test.ts#case5"],
  },
  ...over,
});

void (async () => {
  // ---- CASE 1–4: สายตัวตนครบ ----------------------------------------------
  const base = obs();
  const a = await admitSystemError(base);
  check("CASE 1  ความผิดพลาดถูกรับเข้าคอนโซล", a.status === "ADMITTED", a);
  if (a.status !== "ADMITTED") { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }
  const item = a.item;
  check("CASE 2  event -> command -> task -> work ครบทั้งสี่",
    item.origin_event_id !== null && item.command_id.startsWith("cmd_")
    && item.task_id !== null && item.work_id.startsWith("work-"),
    { e: item.origin_event_id, c: item.command_id, t: item.task_id, w: item.work_id });
  check("CASE 3  ต้นทางเป็นระบบ ไม่ใช่ Owner พิมพ์",
    item.origin_kind === "SYSTEM_ERROR_COMMAND" && item.owner_visible === true);
  check("CASE 4  ข้อความดิบของเครื่องยังอยู่ ไม่ถูกแปลงเป็นร้อยแก้ว",
    item.raw_command_text.includes("Expected work_id but received null")
    && item.evidence?.stderr === "AssertionError: expected work_id, got null"
    && item.evidence?.exit_code === 1, item.raw_command_text.slice(0, 80));

  // ---- CASE 5: กันซ้ำ -------------------------------------------------------
  const again = await admitSystemError(base);
  check("CASE 5  ความล้มเหลวเดิมที่ไม่เปลี่ยน -> ไม่สร้างงานซ่อมใหม่",
    again.status === "DUPLICATE_SUPPRESSED", again);
  check("CASE 5  ตัวตนของความล้มเหลวมาจากเนื้อหา ไม่ใช่เวลา",
    errorEventIdOf(base) === errorEventIdOf({ ...base, observed_at: "2027-01-01T00:00:00.000Z" }));
  const different = await admitSystemError(obs());
  check("CASE 5  ความล้มเหลวที่ต่างออกไป -> สร้างงานใหม่ได้",
    different.status === "ADMITTED" && different.item.work_id !== item.work_id);

  // ---- CASE 6: สายเลือดแม่-ลูก ไม่เขียนทับงานเดิม ------------------------------
  const parentWork = `work-${randomUUID()}`;
  const child = await admitSystemError(obs({ parent_work_id: parentWork, parent_task_id: "task-parent" }));
  check("CASE 6  งานซ่อมชี้กลับไปหางานแม่ และมีตัวตนของตัวเอง",
    child.status === "ADMITTED" && child.item.parent_work_id === parentWork
    && child.item.work_id !== parentWork, child);

  // ---- CASE 7–9: การตัดสินการส่งอัตโนมัติ ---------------------------------------
  for (const kind of OWNER_ATTENTION_REQUIRED) {
    const d = decideAutoDispatch(obs({ error_kind: kind }), "BOOTSTRAP_OWNER_BUILD", true);
    if (d.code !== "OWNER_ATTENTION_REQUIRED" || d.dispatched) {
      check(`CASE 7  ${kind} ต้องไม่ถูกซ่อมอัตโนมัติ`, false, d); break;
    }
  }
  check("CASE 7  ทุกชนิดที่ต้องให้ Owner ตัดสิน ไม่ถูกส่งอัตโนมัติแม้ในโหมด bootstrap และติดอาวุธแล้ว",
    OWNER_ATTENTION_REQUIRED.every((k) => {
      const d = decideAutoDispatch(obs({ error_kind: k }), "BOOTSTRAP_OWNER_BUILD", true);
      return d.code === "OWNER_ATTENTION_REQUIRED" && !d.dispatched;
    }));
  check("CASE 8  ชนิดที่พัฒนาได้ ในโหมดปกติ -> ไม่ส่ง",
    AUTO_DISPATCH_ELIGIBLE.every((k) => decideAutoDispatch(obs({ error_kind: k }), "NORMAL", true).code === "NOT_BOOTSTRAP_MODE"));
  check("CASE 9  โซ่การซ่อมลึกเกินขอบเขต -> ไม่ส่ง",
    decideAutoDispatch(obs({ repair_depth: MAX_REPAIR_DEPTH }), "BOOTSTRAP_OWNER_BUILD", true).code === "REPAIR_DEPTH_EXCEEDED");
  check("CASE 9  ลึกเกินขอบเขตจริง ๆ -> ปฏิเสธตั้งแต่รับ",
    (await admitSystemError(obs({ repair_depth: MAX_REPAIR_DEPTH + 1 }))).status === "REFUSED");

  // ---- CASE 10: พัสดุงานมีความผิดพลาดจริง -------------------------------------
  const pkg = buildAiWorkPackage(base, item.work_id, item.origin_event_id!, "BOOTSTRAP_OWNER_BUILD");
  check("CASE 10 พัสดุที่ส่งให้ AI มีความล้มเหลวจริง ไม่ใช่คำถามกว้าง ๆ",
    pkg.raw_error.includes("Expected work_id but received null")
    && pkg.evidence.stderr !== undefined && pkg.evidence.exit_code === 1
    && pkg.source_event_id === item.origin_event_id
    && pkg.corrective_work_id === item.work_id
    && !/ช่วยตรวจ|please check the system/i.test(JSON.stringify(pkg)), pkg.raw_error.slice(0, 60));
  check("CASE 10 พัสดุไม่มีค่าที่ถูกแต่งขึ้นแทนของที่ไม่ได้วัด",
    pkg.repository_id === null && pkg.workspace_id === null);

  // ---- CASE 11–12: ฟีดสองเลน --------------------------------------------------
  const feed = listOwnerConsoleItems(200);
  const mine = feed.find((f) => f.command_id === item.command_id);
  check("CASE 11 ความผิดพลาดปรากฏในฟีดของ #command โดย Owner ไม่ได้พิมพ์อะไร",
    mine !== undefined && mine.origin_kind === "SYSTEM_ERROR_COMMAND"
    && mine.work_id === item.work_id && mine.task_id === item.task_id, mine);
  check("CASE 12 ฟีดยังมีเลนของ Owner อยู่ด้วย ไม่ถูกแทนที่",
    feed.some((f) => f.origin_kind === "OWNER_COMMAND"),
    feed.slice(0, 3).map((f) => f.origin_kind));

  // ---- CASE 13–14: สิ่งที่ยังไม่ถูกทำ ต้องรายงานตามจริง ---------------------------
  check("CASE 13 มีสิทธิ์ถูกส่ง ไม่เท่ากับถูกส่งแล้ว",
    item.auto_dispatch !== null && item.auto_dispatch.dispatched === false
    && item.auto_dispatch.code === "DISPATCH_DISARMED", item.auto_dispatch);
  check("CASE 14 ไม่มีเหตุผลภายในของโมเดลอยู่ในสิ่งที่แสดง",
    !/reasoning|chain_of_thought|thinking/i.test(JSON.stringify(item)));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
