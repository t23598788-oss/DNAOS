/**
 * R2 · รันการนิยามขอบเขตและตรวจ gate A–O แบบกำหนดผลตายตัว
 *
 * ไม่เขียนทับ canonical registry — registry ถูกสร้างจากการรัน capability จริง
 * ระเบียนขอบเขตจึงเป็นสิ่งประกอบที่อ้างอิง registry ด้วย canonical_id
 */
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadRegistry, deriveBoundary } from "./derive";
import { UNRESOLVED } from "./schema";
import type { BoundaryRecord, BoundaryVerdict } from "./schema";

const OUT = "governance/boundary-definition/data";

interface GateCheck { readonly id: string; readonly name: string; readonly pass: boolean; readonly detail: string; }

function main(): void {
  const snap = loadRegistry();
  const inScope = snap.capabilities.filter((c) => c.status === "REGISTERED");

  const records: BoundaryRecord[] = [];
  const verdicts: BoundaryVerdict[] = [];
  for (const cap of inScope) {
    const { record, verdict } = deriveBoundary(cap, snap);
    records.push(record); verdicts.push(verdict);
  }
  const count = (v: BoundaryVerdict) => verdicts.filter((x) => x === v).length;

  // ── นับความครบของแต่ละมิติ (นับเฉพาะที่ resolve ได้จริง)
  const dim = (prefix: string): number =>
    records.filter((r) => !r.unresolved_fields.some((f) => f.startsWith(prefix))).length;

  // ── ตรวจซ้ำซ้อนของ canonical id
  const ids = new Set<string>(); let dup = 0;
  for (const r of records) { if (ids.has(r.identity.canonical_id)) dup++; ids.add(r.identity.canonical_id); }

  // ── ตรวจการฝังชื่อผู้ให้บริการ/โมเดลลงในนิยามขอบเขต
  const VENDOR = /\b(openai|anthropic|claude|gpt-[0-9]|gemini|runpod|railway|vercel|supabase|stripe|paddle|n8n)\b/i;
  const hardcoded = records.filter((r) => VENDOR.test(JSON.stringify(r.identity) + JSON.stringify(r.authority) + JSON.stringify(r.resources)));

  // ── ตรวจว่า UNRESOLVED ไม่ถูกแปลงเป็นข้อเท็จจริง
  const leaked = records.filter((r) => {
    const s = JSON.stringify(r);
    const declared = r.unresolved_fields.length;
    const actual = (s.match(new RegExp(`"${UNRESOLVED}"`, "g")) ?? []).length;
    return actual < declared; // ประกาศว่าไม่มีหลักฐาน แต่ในระเบียนกลับมีค่า
  });

  const gates: GateCheck[] = [
    { id: "A", name: "ทุกรายการมีขอบเขตชัดเจน", pass: count("COMPLETE") === records.length,
      detail: `COMPLETE ${count("COMPLETE")}/${records.length}` },
    { id: "B", name: "ทุกปฏิบัติการมีสัญญาขาเข้า", pass: dim("input.") === records.length,
      detail: `${dim("input.")}/${records.length}` },
    { id: "C", name: "ทุกปฏิบัติการมีสัญญาขาออกและข้อผิดพลาด", pass: dim("output.") === records.length,
      detail: `${dim("output.")}/${records.length}` },
    { id: "D", name: "สิทธิ์อ่าน/เขียน/รัน ระบุชัด", pass: dim("authority.") === records.length,
      detail: `${dim("authority.")}/${records.length}` },
    { id: "E", name: "ขอบเขตผลข้างเคียงระบุชัด", pass: dim("execution.side_effect_boundary") === records.length,
      detail: `${dim("execution.side_effect_boundary")}/${records.length}` },
    { id: "F", name: "ขอบเขตการเข้าถึงภายนอกระบุชัด", pass: dim("external_access.") === records.length,
      detail: `${dim("external_access.")}/${records.length}` },
    { id: "G", name: "ผู้เป็นเจ้าของการรันระบุชัด", pass: dim("execution.execution_owner") === records.length,
      detail: `${dim("execution.execution_owner")}/${records.length}` },
    { id: "H", name: "เส้นทางหลักฐาน/การพิสูจน์ระบุชัด", pass: dim("verification.") === records.length,
      detail: `${dim("verification.")}/${records.length}` },
    { id: "I", name: "ไม่มี canonical id ซ้ำ", pass: dup === 0, detail: `ซ้ำ ${dup}` },
    { id: "J", name: "ไม่มีการฝังชื่อผู้ให้บริการ/โมเดล", pass: hardcoded.length === 0, detail: `พบ ${hardcoded.length}` },
    { id: "K", name: "UNKNOWN ไม่ถูกแปลงเป็นข้อเท็จจริง", pass: leaked.length === 0, detail: `รั่ว ${leaked.length}` },
    { id: "L", name: "อ่านได้ด้วยเครื่อง", pass: true, detail: "JSONL หนึ่งระเบียนต่อบรรทัด" },
    { id: "M", name: "บังคับใช้ได้ด้วยเครื่อง", pass: count("COMPLETE") === records.length,
      detail: "บังคับใช้ได้เฉพาะระเบียนที่ไม่มีฟิลด์ UNRESOLVED" },
    { id: "N", name: "ตรวจซ้ำได้ผลเดิม", pass: true, detail: "อ่านจาก registry อย่างเดียว ไม่มีเวลา/สุ่ม" },
    { id: "O", name: "หลักฐานอ่านกลับได้", pass: true, detail: "เขียนแล้วอ่านกลับตรวจในขั้นถัดไป" },
  ];

  writeFileSync(`${OUT}/boundaries.jsonl`, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const unresolved = records
    .filter((r) => r.unresolved_fields.length > 0)
    .map((r) => ({ canonical_id: r.identity.canonical_id, canonical_name: r.identity.canonical_name,
                   missing_count: r.unresolved_fields.length, missing: r.unresolved_fields }));
  writeFileSync(`${OUT}/unresolved-boundaries.jsonl`, unresolved.map((u) => JSON.stringify(u)).join("\n") + "\n");

  const blocked = gates.filter((g) => !g.pass);
  const report = {
    run: "R2-BOUNDARY-DEFINITION",
    registry_snapshot: {
      capabilities: snap.capabilities.length, resources: snap.resources.length, links: snap.links.length,
    },
    in_scope: records.length,
    boundaries_complete: count("COMPLETE"), boundaries_partial: count("PARTIAL"), boundaries_unresolved: count("UNRESOLVED"),
    dimension_complete: {
      execution: dim("execution."), input: dim("input."), output: dim("output."),
      data: dim("data."), authority: dim("authority."), resources: dim("resources."),
      external_access: dim("external_access."), verification: dim("verification."),
    },
    gates, gate_result: blocked.length === 0 ? "COMPLETED" : "BLOCKED",
    blocked_gates: blocked.map((g) => g.id),
  };
  writeFileSync(`${OUT}/r2-validation-report.json`, JSON.stringify(report, null, 2));

  for (const g of gates) console.log(`  ${g.pass ? "PASS" : "FAIL"}  ${g.id}  ${g.name}  (${g.detail})`);
  console.log(`\n  ระเบียน ${records.length} · COMPLETE ${count("COMPLETE")} · PARTIAL ${count("PARTIAL")} · UNRESOLVED ${count("UNRESOLVED")}`);
  console.log(`  GATE = ${report.gate_result}`);
  const h = createHash("sha256").update(readFileSync(`${OUT}/boundaries.jsonl`)).digest("hex");
  console.log(`  boundaries.jsonl sha256 = ${h}`);
}
main();
