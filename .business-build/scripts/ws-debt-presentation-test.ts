#!/usr/bin/env npx tsx
/**
 * WS-DEBT PRESENTATION REGRESSION TEST (owner mission 2026-10-15)
 * เส้นทางเดียว: AI → debt.list → Result Contract → Dynamic Table Renderer เดิม
 * FULLY READ-ONLY — เรียก canonical reader จริงผ่าน dispatch("debt.list"),
 * ไม่เขียน DB ไม่แก้ธุรกรรม ไม่ส่งแจ้งเตือน
 *
 * ตรวจจุดที่พบจริงก่อนแก้:
 *   · ชื่อบริษัท / ยอด / วันที่ / สถานะ ว่าง → map จากฟิลด์จริงผ่านต้องไม่ว่าง
 *     ตราบเท่าข้อมูลจริงมีค่า (ต้องมี >= 1 รายการในระบบตาม production audit)
 *   · หัวตาราง = ชื่อคำสั่งภายใน → title ต้องไม่มีรูปแบบ "xxx.yyy" บนหัวเรื่องหลัก
 *   · UUID/JSON หลุดขึ้นจอ → ทุกเซลล์ห้าม match UUID รูปเต็มและห้ามเป็น JSON
 *
 * Run: npx tsx scripts/ws-debt-presentation-test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* เส้นทาง test อื่นทำเช่นกัน — ไม่มี .env.local = fail ที่ assertion เอง */ }
}

import { buildChatResult } from "../app/api/chat/_lib/resultContract";
import { dispatch } from "../engines/validation/dispatcher";

let pass = 0; let fail = 0;
const failures: string[] = [];
function check(name: string, cond: unknown, detail?: unknown): void {
  const ok = cond === true;
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  loadEnvLocal();
  console.log("\n═ WS-DEBT PRESENTATION (read-only) ═\n");

  const raw = await dispatch("debt.list", {});
  check("debt.list dispatcher ok", raw.ok === true, raw.violations);
  const rawRows = Array.isArray(raw.data) ? (raw.data as Record<string, unknown>[]) : [];
  check("production has ≥1 open debt (audit premise)", rawRows.length > 0, `got ${rawRows.length}`);
  check("raw reader carries real fields (document_number/customer_name/outstanding_amount)", rawRows.every(
    (r) => "document_number" in r && "customer_name" in r && "outstanding_amount" in r,
  ), rawRows[0] ? Object.keys(rawRows[0]) : []);
  check("status is real derived_status (ไม่ใช่ literal OPEN เดิม)", rawRows.every((r) => "derived_status" in r && String(r.derived_status).length > 0));

  // เส้น AI → Workspace เดิม: ผ่าน buildChatResult ด้วย localCommand รูปเดิมของ bridge
  const req = new Request("http://local.test/api/chat", { method: "POST", headers: { cookie: "" } });
  const result = await buildChatResult(
    req,
    "แสดงยอดค้างชำระของบริษัทที่ยังไม่ได้จ่ายเงิน",
    {},
    { action: "debt.list", payload: {} },
  );
  check("workspace result built (ไม่กลับ null)", result !== null);
  check("result type = table (Dynamic Table Renderer เดิม)", result?.type === "table");
  if (result?.type !== "table") { throw new Error("NOT_A_TABLE — หยุดเผื่อ assertion ย่อยอีกทอด"); }
  const { title, table } = result;
  check("หัวเรื่องไม่มีชื่อคำสั่งภายใน (ไม่มี dotted command)", !/\b\w+\.\w+\b/.test(title ?? ""), title);
  check("หัวเรื่องเป็นภาษาไทยเรื่องธุรกิจ (มีคำว่า หนี้)", !!title && /หนี้/.test(title), title);

  const labels = table.columns.map((c) => c.label);
  check("หัวคอลัมน์เป็นภาษาไทยธุรกิจ ครบ 5 ช่อง", /เลขที่ใบแจ้งหนี้/.test(labels[0]) && labels.join("|") === "เลขที่ใบแจ้งหนี้|บริษัท|ยอดค้างชำระ|วันที่|สถานะ", labels);
  check("แถวจำนวนเท่าคำสั่งจริง", table.rows.length === rawRows.length, `${table.rows.length} vs ${rawRows.length}`);

  for (let i = 0; i < table.rows.length; i++) {
    const [no, company, amount, date, status] = table.rows[i];
    check(`แถว ${i + 1}: ไม่มี UUID/JSON ในทุกช่อง`, table.rows[i].every((v) => !UUID_RE.test(v) && !v.trim().startsWith("{")), table.rows[i]);
    check(`แถว ${i + 1}: เลขที่ใบแจ้งหนี้ = ค่าจริงจาก dispatcher`, no === String(rawRows[i]?.document_number ?? "—"), { no, real: rawRows[i]?.document_number });
    check(`แถว ${i + 1}: ชื่อบริษัทตรง — ไม่โชว์ต่างคน เมื่อข้อมูลมีจริง`, String(rawRows[i]?.customer_name ?? "").trim() === "" ? no !== undefined : company === String(rawRows[i]?.customer_name ?? ""), { company, real: rawRows[i]?.customer_name });
    check(`แถว ${i + 1}: ยอดค้างชำระตรงค่า canonical`, amount.includes(",") && Number(amount.replace(/[^\d.-]/g, "")) === Math.abs(Number(rawRows[i]?.outstanding_amount ?? 0)), { amount, real: rawRows[i]?.outstanding_amount });
    check(`แถว ${i + 1}: วันที่รูปแบบ ISO 8 หลัก หรือ — เมื่อข้อมูลไม่มีจริง`, /^\d{4}-\d{2}-\d{2}$/.test(date) || date === "—", date);
    check(`แถว ${i + 1}: สถานะภาษาไทย (ไม่ใช่รหัสภาษามาทำเป็นหัวข้อ)`, /^(ชำระบางส่วน|ยังไม่ระบุสถานะ|ค้างชำระเกินกำหนด|ค้างชำระ)$/.test(status), status);
  }

  console.log(`\n═ สรุป: ${pass} PASS / ${fail} FAIL ═\n`);
  if (fail > 0) { console.log("FAILED:"); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((e) => { console.error("HARNESS ERROR:", e instanceof Error ? e.message : e); process.exit(2); });
