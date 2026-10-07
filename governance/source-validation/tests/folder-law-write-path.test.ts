/**
 * พิสูจน์ว่ากฎหมายโฟลเดอร์ถูกบังคับใช้ที่เส้นทางเขียนจริง ไม่ใช่แค่มีตัวตรวจอยู่เฉย ๆ
 * ใช้ executeFileWrite ตัวจริง พร้อม WriteGateDecision ที่ ALLOW แล้ว
 * ถ้าเกตไม่ทำงาน ไฟล์ที่ผิดกฎจะถูกเขียนลงดิสก์จริง
 */
import { existsSync, rmSync } from "node:fs";
import { executeFileWrite } from "../../../execution/file-write/contract";
import type { FileWriteRequest } from "../../../execution/file-write/types";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

const decision = {
  decision_id: "dec-folder-law-proof", intent_id: "int-folder-law-proof",
  decision: "ALLOW_CREATE", reason_code: "NO_EXISTING_OVERLAP",
} as never;

const req = (target: string): FileWriteRequest => ({
  correlation_id: "corr-folder-law-proof", intent_id: "int-folder-law-proof",
  gate_decision_id: "dec-folder-law-proof", operation: "CREATE",
  target_type: "FILE", target_path: target,
  content: "// proof\n", requesting_identity_id: "test:folder-law",
});

console.log("\n── ไฟล์ที่ผิดกฎต้องถูกปฏิเสธ แม้ Write Gate จะ ALLOW แล้ว");
for (const [target, why] of [
  ["__folder-law-proof-root.ts", "ไฟล์ source ที่รากของ repo"],
  ["control/__folder-law-proof-loose.ts", "วางตรงในกลุ่มหลัก"],
] as const) {
  const r = executeFileWrite(req(target), decision);
  ok(`ปฏิเสธ: ${why}`, r.status === "refused" && r.refusal_code === "CAPABILITY_FOLDER_LAW_REJECTED",
     `ได้ ${r.status}/${(r as { refusal_code?: string }).refusal_code}`);
  ok(`ไม่มีไฟล์หลงเหลือบนดิสก์: ${target}`, !existsSync(target));
}

console.log("\n── ไฟล์ที่ถูกกฎต้องผ่านด่านนี้ไปได้");
const legit = "governance/source-validation/__folder-law-proof.ts";
const r = executeFileWrite(req(legit), decision);
ok("ไม่ถูกปฏิเสธด้วยกฎหมายโฟลเดอร์",
   (r as { refusal_code?: string }).refusal_code !== "CAPABILITY_FOLDER_LAW_REJECTED",
   `ได้ ${(r as { refusal_code?: string }).refusal_code}`);
if (existsSync(legit)) rmSync(legit);

console.log(`\n  ผลรวม: PASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
