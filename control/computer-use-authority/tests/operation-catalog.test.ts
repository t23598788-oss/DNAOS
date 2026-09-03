/**
 * หน้าที่: พิสูจน์ว่า operation catalog ใน status **derive จากนิยาม canonical เท่านั้น**
 * ไม่ใช่ตารางสิทธิ์ชุดที่สอง และไม่มอบอำนาจใด ๆ
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readComputerUseStatus } from "../status-contract";
import { OPERATION_LEVEL, levelOf, requiresExplicitHighRisk, isSecurityLevel } from "../levels";
import { validateAuthority } from "../lease";
import type { ComputerUseOperation } from "../types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (d ? "  -> " + d : "")); }
};

const st = readComputerUseStatus();
const cat = st.operation_catalog;
const canonicalOps = Object.keys(OPERATION_LEVEL) as ComputerUseOperation[];

console.log(`\nCATALOG — ${cat.length} operation`);
ok("จำนวนตรงกับนิยาม canonical พอดี", cat.length === canonicalOps.length, `${cat.length} vs ${canonicalOps.length}`);
ok("ทุก operation ที่เปิดออกมามีอยู่ใน OPERATION_LEVEL จริง",
  cat.every((e) => canonicalOps.includes(e.operation)),
  JSON.stringify(cat.filter((e) => !canonicalOps.includes(e.operation)).map((e) => e.operation)));
ok("ไม่มี operation ใดใน canonical ที่หายไปจาก catalog",
  canonicalOps.every((op) => cat.some((e) => e.operation === op)),
  JSON.stringify(canonicalOps.filter((op) => !cat.some((e) => e.operation === op))));

console.log("\nLEVEL — ต้องเท่ากับ canonical ทุกตัว ไม่ใช่ค่าที่คัดลอกมา");
ok("level ทุกตัว === levelOf(op)", cat.every((e) => e.level === levelOf(e.operation)),
  JSON.stringify(cat.filter((e) => e.level !== levelOf(e.operation))));
ok("level ทุกค่าอยู่ในช่วง L0–L4", cat.every((e) => e.level >= 0 && e.level <= 4));
ok("high_risk_explicit_required === requiresExplicitHighRisk(op)",
  cat.every((e) => e.high_risk_explicit_required === requiresExplicitHighRisk(e.operation)));
ok("security_level === isSecurityLevel(op)",
  cat.every((e) => e.security_level === isSecurityLevel(e.operation)));
ok("L>=3 ทุกตัวต้อง high_risk_explicit_required", cat.filter((e) => e.level >= 3).every((e) => e.high_risk_explicit_required));
ok("L<3 ทุกตัวต้องไม่ required", cat.filter((e) => e.level < 3).every((e) => !e.high_risk_explicit_required));
{
  const l4 = cat.filter((e) => e.security_level).map((e) => e.operation).sort();
  console.log("  L4 (security):", l4.join(", "));
  ok("L4 คือ login/credential_reference/provider_authorization",
    JSON.stringify(l4) === JSON.stringify(["credential_reference", "login", "provider_authorization"]), JSON.stringify(l4));
}

console.log("\nไม่มีตารางสิทธิ์ชุดที่สอง");
{
  const statusSrc = readFileSync(join(__dirname, "..", "status-contract.ts"), "utf8");
  // ตัวเลขระดับต้องไม่ถูกเขียนเป็นค่าคงที่ผูกกับชื่อ operation ในไฟล์ status
  const hardcodedPair = /(screenshot|read_screen|click|type|login|credential_reference|provider_authorization)\s*:\s*[0-4]\b/;
  ok("status-contract.ts ไม่มีคู่ operation:level เขียนตายตัว", !hardcodedPair.test(statusSrc));
  ok("status-contract.ts derive จาก OPERATION_LEVEL", statusSrc.includes("Object.keys(OPERATION_LEVEL)"));
  const apiSrc = readFileSync(join(__dirname, "..", "..", "..", "transport", "owner-command-http", "computer-use-api.ts"), "utf8");
  ok("computer-use-api.ts ไม่ประกาศ OPERATION_LEVEL เอง", !apiSrc.includes("OPERATION_LEVEL"));
  ok("computer-use-api.ts ไม่มีคู่ operation:level เขียนตายตัว", !hardcodedPair.test(apiSrc));
}

console.log("\nEXTERNAL COMMIT — เป็นธงต่อคำขอ ไม่ใช่คุณสมบัติของ operation");
{
  const p = st.external_commit_policy;
  ok("ประกาศว่าเป็น declared_per_request", p.declared_per_request === true);
  ok("ระบุธงฝั่งคำขอและฝั่ง lease", p.request_flag === "is_external_commit" && p.lease_flag === "external_commit_authorized");
  ok("ประกาศว่าไม่สืบทอดจากสิทธิ์ UI control", p.inherits_from_ui_control === false);
  ok("ไม่มี entry ใดใน catalog อ้าง external_commit รายตัว",
    cat.every((e) => !("external_commit_required" in (e as unknown as Record<string, unknown>))));
}

console.log("\nCATALOG ไม่มอบอำนาจ — unknown operation ยัง fail closed");
{
  const unknown = "definitely_not_a_real_operation" as ComputerUseOperation;
  ok("levelOf(unknown) = 4 (fail closed)", levelOf(unknown) === 4);
  ok("unknown ไม่อยู่ใน catalog", !cat.some((e) => e.operation === unknown));
  const v = validateAuthority({ authority_id: "does-not-exist", requester: "agent:claude",
    executor: "control/computer-use-executor", operation: cat[0].operation, target: "screen" } as never);
  ok("อ่าน catalog แล้วยังไม่ได้สิทธิ์ — validateAuthority ยังปฏิเสธ", v.ok === false, JSON.stringify(v));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
