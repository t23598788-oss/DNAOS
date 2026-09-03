/**
 * หน้าที่: พิสูจน์ resolve-on-read ของ executor_capability_id กับข้อมูลจริง
 * โดยไม่เขียนอะไรกลับลง declaration
 */
import { resolveDeclarationExecutor } from "../executor-resolution";
import { listConnections } from "../registry";
import { listConnectionDeclarations } from "../declaration-registry";
import { validateConnectionDeclaration } from "../declaration-registry";
import type { ConnectionDeclaration } from "../../../contracts/connector/connection-declaration";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (d ? "  -> " + d : "")); }
};

const gh = listConnections().find((c) => c.adapter === "github");
const ghDecl = listConnectionDeclarations().find((d) => d.provider_id === "github");
const mcpDecl = listConnectionDeclarations().find((d) => d.provider_id === "dna-os");

console.log("\nของจริงที่เป็นต้นเหตุ");
ok("ConnectionRegistration ของ GitHub มี executor_capability_id",
  gh?.executor_capability_id === "capability-b4a67fea-f3a6-41b3-91c2-cbdb8223977e", String(gh?.executor_capability_id));
ok("ConnectionDeclaration ของ GitHub ยังเป็น null (ไม่ถูกเขียนทับ)",
  ghDecl?.executor_capability_id === null, String(ghDecl?.executor_capability_id));

console.log("\nRESOLVE-ON-READ");
{
  // ผูก reference ในหน่วยความจำเท่านั้น — ไม่เขียนลงทะเบียน
  const linked: ConnectionDeclaration = { ...(ghDecl as ConnectionDeclaration), authorized_by_connection_id: gh!.connection_id };
  const r = resolveDeclarationExecutor(linked);
  ok("effective_executor_capability_id = capability-b4a67fea",
    r.effective_executor_capability_id === "capability-b4a67fea-f3a6-41b3-91c2-cbdb8223977e", String(r.effective_executor_capability_id));
  ok("executor_source = ConnectionRegistration", r.executor_source === "ConnectionRegistration", r.executor_source);
  ok("ไม่ถูกทำเครื่องหมายว่าไม่ครบ เพราะ resolve ได้แล้ว", r.historical_declaration_incomplete === false);
}

console.log("\nHISTORICAL_DECLARATION_INCOMPLETE");
{
  const r = resolveDeclarationExecutor(ghDecl as ConnectionDeclaration);
  ok("GitHub declaration ปัจจุบัน (ไม่มี reference) -> NONE", r.executor_source === "NONE", r.executor_source);
  ok("ถูกรายงานเป็น HISTORICAL_DECLARATION_INCOMPLETE", r.historical_declaration_incomplete === true, r.reason);
}

console.log("\nSEMANTICS ที่ null ถูกต้อง");
{
  const r = resolveDeclarationExecutor(mcpDecl as ConnectionDeclaration);
  ok("MCP มี executor ของตัวเอง -> ConnectionDeclaration", r.executor_source === "ConnectionDeclaration", r.executor_source);
  ok("MCP ไม่ถูกทำเครื่องหมายว่าไม่ครบ (INBOUND local ไม่ต้องมี authorization)",
    r.historical_declaration_incomplete === false);
}

console.log("\nVALIDATION ของ reference");
{
  const base = { ...(ghDecl as ConnectionDeclaration) } as unknown as Record<string, unknown>;
  delete base.connection_id; delete base.declared_at;
  const withBad = { ...base, authorized_by_connection_id: "connection://does-not-exist" };
  ok("อ้าง registration ที่ไม่มีอยู่ -> ถูกปฏิเสธ",
    validateConnectionDeclaration(withBad as never).reasons.includes("AUTHORIZATION_REFERENCE_NOT_FOUND"));
  const withGood = { ...base, authorized_by_connection_id: gh!.connection_id };
  ok("อ้าง registration ที่มีอยู่จริง -> ผ่าน", validateConnectionDeclaration(withGood as never).ok);
  const withNull = { ...base, authorized_by_connection_id: null };
  ok("null ผ่านได้ (ช่องทางที่ไม่ต้องขออนุมัติ)", validateConnectionDeclaration(withNull as never).ok);
}

console.log("\nไม่มีการเขียนกลับ");
ok("declaration ในทะเบียนยังเป็น null เหมือนเดิมหลังทดสอบ",
  listConnectionDeclarations().find((d) => d.provider_id === "github")?.executor_capability_id === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
