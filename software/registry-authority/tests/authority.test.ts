/**
 * ทดสอบในสภาพแวดล้อมแยก ไม่แตะ canonical registry จริง
 * จำลอง "เขียนตรงไม่ได้" ด้วยการทำโฟลเดอร์ให้อ่านอย่างเดียว
 * ของจริงจะเป็น root:wheel ซึ่งเข้มกว่า เพราะ tam เปลี่ยนสิทธิ์กลับไม่ได้
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drainOnce } from "../daemon";
import { submitAuthorityRequest, readAuthorityResult } from "../client";
import { validateAuthorityRequest } from "../protocol";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n} ${x}`); } };

const root = mkdtempSync(join(tmpdir(), "regauth-"));
const canonicalDir = join(root, "canonical");
const spoolDir = join(root, "spool");
mkdirSync(canonicalDir, { recursive: true });
mkdirSync(join(spoolDir, "inbox"), { recursive: true });
writeFileSync(join(canonicalDir, "relationships.jsonl"), "");
const paths = { canonicalDir, spoolDir };

console.log("\n── สัญญาคำขอ: ปฏิเสธสิ่งที่ผู้ขอไม่มีสิทธิ์กำหนด");
for (const f of ["path", "dataDir", "command", "chmod", "canonicalDir"]) {
  const r = validateAuthorityRequest({ request_id: "req-abcdefgh", created_at: new Date().toISOString(),
    requester: "t", operation: "ADD_EVIDENCE", table: "evidence", row: {}, [f]: "x" });
  ok(`ปฏิเสธฟิลด์ ${f}`, r.ok === false && r.reason_code === "FORBIDDEN_FIELD");
}
ok("ปฏิเสธตารางที่ไม่อยู่ในรายการ", (() => {
  const r = validateAuthorityRequest({ request_id: "req-abcdefgh", created_at: new Date().toISOString(),
    requester: "t", operation: "ADD_EVIDENCE", table: "../../etc/passwd", row: {} });
  return r.ok === false && r.reason_code === "TABLE_NOT_WRITABLE"; })());
ok("ปฏิเสธปฏิบัติการที่ไม่รู้จัก", (() => {
  const r = validateAuthorityRequest({ request_id: "req-abcdefgh", created_at: new Date().toISOString(),
    requester: "t", operation: "DELETE_EVERYTHING", table: "evidence", row: {} });
  return r.ok === false && r.reason_code === "UNKNOWN_OPERATION"; })());

console.log("\n── ผู้ขอเขียนตรงไม่ได้ เมื่อปลายทางถูกยึด");
chmodSync(canonicalDir, 0o555);
let directWriteFailed = false;
try { appendFileSync(join(canonicalDir, "relationships.jsonl"), "{}\n"); } catch { directWriteFailed = true; }
ok("เขียนไฟล์ใหม่ในโฟลเดอร์ที่ถูกยึด = ถูกปฏิเสธ", (() => {
  try { writeFileSync(join(canonicalDir, "แทรกเอง.jsonl"), "{}\n"); return false; } catch { return true; }
})());
chmodSync(canonicalDir, 0o755);

console.log("\n── คำขอที่ถูกต้องผ่านผู้มีอำนาจ = สำเร็จ");
const id = submitAuthorityRequest(spoolDir, { requester: "test", operation: "ADD_EVIDENCE",
  table: "relationships", row: { from_id: "a", to_id: "b", relationship_kind: "ORCHESTRATES_CAPABILITY" } });
const d1 = drainOnce(paths);
ok("ผู้มีอำนาจรับคำขอและลงมือ", d1.applied === 1 && d1.rejected === 0, JSON.stringify(d1));
const res = readAuthorityResult(spoolDir, id);
ok("มีผลลัพธ์กลับมา APPLIED", res !== null && res.status === "APPLIED");
ok("แถวถูกต่อท้ายจริง", readFileSync(join(canonicalDir, "relationships.jsonl"), "utf8").includes("ORCHESTRATES_CAPABILITY"));

console.log("\n── คำขอที่ผิดกฎถูกปฏิเสธโดยผู้มีอำนาจ ไม่ใช่แค่ตอนตรวจ");
writeFileSync(join(spoolDir, "inbox", "bad.json"), JSON.stringify({
  request_id: "req-badbadbad", created_at: new Date().toISOString(), requester: "attacker",
  operation: "ADD_EVIDENCE", table: "../../../etc/hosts", row: {} }));
const d2 = drainOnce(paths);
ok("ปฏิเสธตารางที่หลุดขอบเขต", d2.rejected === 1 && d2.applied === 0, JSON.stringify(d2));
ok("ไม่มีไฟล์แปลกปลอมถูกสร้าง", !existsSync(join(root, "etc")) && !existsSync("/etc/hosts.jsonl"));

console.log("\n── ไม่มีทางสั่งงานอื่นนอกจากต่อท้ายแถว");
const src = readFileSync(new URL("../daemon.ts", import.meta.url), "utf8");
for (const bad of ["child_process", "exec(", "spawn(", "unlinkSync", "rmSync", "eval("]) {
  ok(`daemon ไม่มี ${bad}`, !src.includes(bad));
}

rmSync(root, { recursive: true, force: true });
console.log(`\n  ผลรวม: PASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
