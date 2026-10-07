/**
 * หน้าที่: พิสูจน์ว่า Provider Project Registry เป็น "ทะเบียนตัวตน" จริง —
 * deterministic, ไม่รับ secret, ไม่เก็บสถานะ, และ DigitalOcean ต้องตกที่ UNRESOLVED
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { registerProviderProject, getProviderProject, listProviderProjects, buildProviderProjectId }
  from "../contract";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (d ? "  -> " + d : "")); }
};

console.log("\nIDENTITY — deterministic");
{
  const a = buildProviderProjectId("railway", { b: "2", a: "1" });
  const b = buildProviderProjectId("railway", { a: "1", b: "2" });
  ok("ลำดับคีย์ไม่มีผลต่อตัวตน", a === b, `${a} vs ${b}`);
  ok("id อ่านออก ไม่ใช่ hash", a.startsWith("provider-project://railway/"), a);
  ok("provider ต่างกัน = ตัวตนต่างกัน",
    buildProviderProjectId("railway", { x: "1" }) !== buildProviderProjectId("supabase", { x: "1" }));
}

console.log("\nสถานะที่ต้องรองรับ");
{
  ok("ไม่มี identifier -> UNRESOLVED",
    registerProviderProject({ provider_id: "p", identifiers: {}, verified_by: ["x"] }).status === "UNRESOLVED");
  ok("identifier ค่าว่าง -> UNRESOLVED",
    registerProviderProject({ provider_id: "p", identifiers: { a: "  " }, verified_by: ["x"] }).status === "UNRESOLVED");
  ok("ไม่มี verified_by -> UNRESOLVED",
    registerProviderProject({ provider_id: "p", identifiers: { a: "1" }, verified_by: [] }).status === "UNRESOLVED");
  ok("ค่ารูปร่าง secret -> UNRESOLVED (ทะเบียนนี้ไม่รับ credential)",
    registerProviderProject({ provider_id: "p", identifiers: { t: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" }, verified_by: ["x"] }).status === "UNRESOLVED");

  // ลงทะเบียนซ้ำด้วยตัวตนเดิม = REUSED ไม่เกิดแถวใหม่
  const before = listProviderProjects().length;
  const again = registerProviderProject({
    provider_id: "railway",
    identifiers: { project: "dna-os-infrastructure", environment_id: "4d28eafa-9735-4405-a585-55ea354bafab" },
    verified_by: ["ทดสอบ idempotency"],
  });
  ok("ลงทะเบียนซ้ำ -> REUSED", again.status === "REUSED", again.status);
  ok("จำนวนแถวไม่เพิ่ม", listProviderProjects().length === before, `${before} -> ${listProviderProjects().length}`);
}

console.log("\nของจริงที่ลงทะเบียนแล้ว");
{
  const railway = getProviderProject("provider-project://railway/environment_id=4d28eafa-9735-4405-a585-55ea354bafab,project=dna-os-infrastructure");
  ok("Railway identity อ่านกลับได้", railway !== null);
  ok("Railway มี verified_by ที่อ้างไฟล์จริง",
    Boolean(railway?.verified_by.some((v) => v.includes("router-invoker.ts"))));
  const supabase = getProviderProject("provider-project://supabase/project_ref=xeytcavxejhyzxwevgto");
  ok("Supabase identity อ่านกลับได้", supabase !== null);
  ok("DigitalOcean ไม่มีในทะเบียน (UNRESOLVED ไม่ถูกบันทึก)",
    listProviderProjects().every((p) => p.provider_id !== "digitalocean"));
}

console.log("\nขอบเขต — ทะเบียนตัวตนเท่านั้น");
{
  const file = join(__dirname, "..", "data", "provider-projects.jsonl");
  const raw = existsSync(file) ? readFileSync(file, "utf8") : "";
  const FORBIDDEN = ["credential", "token", "secret", "password", "status", "healthy", "deploy"];
  const found = FORBIDDEN.filter((f) => new RegExp(`"${f}[^"]*"\\s*:`).test(raw));
  ok("ไม่มี field ที่เก็บ secret หรือสถานะที่เปลี่ยนได้", found.length === 0, JSON.stringify(found));
  ok("ทุกแถวมี verified_by ไม่ว่าง", listProviderProjects().every((p) => p.verified_by.length > 0));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
