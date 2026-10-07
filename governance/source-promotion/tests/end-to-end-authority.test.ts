/**
 * พิสูจน์ว่าเส้นทางด่านซอร์สเป็นทางเดียวจริงสำหรับแกนหลัก
 * ใช้ executeFileWrite ตัวจริง เขียนไฟล์จริง ไม่ mock อะไรเลย
 */
import { existsSync, rmSync, readFileSync } from "node:fs";
import { executeFileWrite } from "../../../execution/file-write/contract";
import { issuePromotionReceipt, sha256 } from "../receipt";
import type { FileWriteRequest } from "../../../execution/file-write/types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${x}`); } };

const decision = { decision_id: "d-e2e", intent_id: "i-e2e", decision: "ALLOW_CREATE", reason_code: "NO_EXISTING_OVERLAP" } as never;
const req = (target: string, content: string): FileWriteRequest => ({
  correlation_id: "c-e2e", intent_id: "i-e2e", gate_decision_id: "d-e2e",
  operation: "CREATE", target_type: "FILE", target_path: target,
  content, requesting_identity_id: "test:e2e",
});

// เป้าหมายในขอบเขตที่ถูกป้องกัน — governance/source-promotion/ เป็น sealed boundary
const TARGET = "governance/source-promotion/__e2e-probe.ts";
const RUN = new Date().toISOString();
const CONTENT = `// หลักฐานการเลื่อนขั้นจริง ${RUN}\nexport const PROBE = 1;\n`;
if (existsSync(TARGET)) rmSync(TARGET);

console.log("\n── ทางลบ: เขียนแกนหลักโดยไม่มีใบรับรอง");
const r1 = executeFileWrite(req(TARGET, CONTENT), decision);
ok("ถูกปฏิเสธด้วย PROMOTION_RECEIPT_REQUIRED",
   r1.status === "refused" && (r1 as { refusal_code?: string }).refusal_code === "PROMOTION_RECEIPT_REQUIRED",
   `ได้ ${r1.status}/${(r1 as { refusal_code?: string }).refusal_code}`);
ok("ไม่มีไฟล์เกิดขึ้นบนดิสก์", !existsSync(TARGET));

console.log("\n── ทางลบ: ด่านทดสอบไม่ผ่าน = ออกใบรับรองไม่ได้");
for (const outcome of ["FAIL", "NOT_RUN"] as const) {
  const iss = issuePromotionReceipt({ change_id: "chg-e2e", manifest_sha256: sha256("m"),
    approved: [{ path: TARGET, content_sha256: sha256(CONTENT) }],
    test_gate: { outcome, command: "npx tsx …", evidence_ref: "ev" } });
  ok(`ด่านทดสอบ ${outcome} -> ปฏิเสธ`, iss.ok === false && iss.reason_code === "TEST_GATE_NOT_PASSED");
}

console.log("\n── ทางบวก: ทดสอบผ่าน -> ออกใบ -> เขียนสำเร็จ");
const issued = issuePromotionReceipt({ change_id: "chg-e2e", manifest_sha256: sha256("m"),
  approved: [{ path: TARGET, content_sha256: sha256(CONTENT) }],
  test_gate: { outcome: "PASS", command: "npx tsx governance/source-promotion/tests/promotion.test.ts", evidence_ref: "PASS=30 FAIL=0" } });
ok("ออกใบรับรองได้", issued.ok === true);
const r2 = executeFileWrite(req(TARGET, CONTENT), decision);
ok("เขียนสำเร็จผ่านเส้นทางจริง", r2.status === "completed", `ได้ ${r2.status}/${(r2 as { refusal_code?: string }).refusal_code}`);
ok("ไฟล์มีอยู่จริงและเนื้อหาตรง", existsSync(TARGET) && readFileSync(TARGET, "utf8") === CONTENT);

console.log("\n── ทางลบ: ใบเดิมใช้ซ้ำไม่ได้ และเนื้อหาต่างใช้ไม่ได้");
if (existsSync(TARGET)) rmSync(TARGET);
const r3 = executeFileWrite(req(TARGET, CONTENT), decision);
ok("ใช้ใบซ้ำ -> ถูกปฏิเสธ", r3.status === "refused" && (r3 as { refusal_code?: string }).refusal_code === "PROMOTION_RECEIPT_REQUIRED");
const issued2 = issuePromotionReceipt({ change_id: "chg-e2e-2", manifest_sha256: sha256("m2"),
  approved: [{ path: TARGET, content_sha256: sha256(CONTENT) }],
  test_gate: { outcome: "PASS", command: "x", evidence_ref: "y" } });
ok("ออกใบใหม่ได้", issued2.ok === true);
const r4 = executeFileWrite(req(TARGET, `// เนื้อหาคนละอย่าง ${RUN}\n`), decision);
ok("เนื้อหาไม่ตรงแฮช -> ถูกปฏิเสธ", r4.status === "refused" && (r4 as { refusal_code?: string }).refusal_code === "PROMOTION_RECEIPT_REQUIRED");
ok("ไม่มีไฟล์เกิดขึ้น", !existsSync(TARGET));

console.log("\n── งานพัฒนาทั่วไปต้องไม่ถูกกระทบ");
const NORMAL = "connections/n8n/__e2e-probe.ts";
if (existsSync(NORMAL)) rmSync(NORMAL);
const r5 = executeFileWrite(req(NORMAL, "// ปกติ\n"), decision);
ok("เขียนนอกขอบเขตที่ป้องกันได้ตามปกติ", r5.status === "completed", `ได้ ${(r5 as { refusal_code?: string }).refusal_code}`);
if (existsSync(NORMAL)) rmSync(NORMAL);

if (existsSync(TARGET)) rmSync(TARGET);
console.log(`\n  ผลรวม: PASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
