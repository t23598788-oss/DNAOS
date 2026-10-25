/**
 * TENANT PRE-CHANGE EXPORT (read-only) — STEP 3 ของภารกิจ PRODUCTION RUNTIME EXECUTION
 *
 * ก่อน apply migration V1–V3 บน production ต้องมี "ภาพก่อนเปลี่ยน" ของข้อมูลที่อาจได้รับผล:
 *   · companies                     — V1 เพิ่มคอลัมน์ organization_id (ข้อมูลแถวไม่ถูกแก้)
 *   · bank_statement_transactions   — V3 เพิ่มคอลัมน์ organization_id
 *   · bank_notifications            — V3
 *   · storage_evidence              — V3
 *   · file_snapshots                — V3 (PK = content_hash ไม่มี id)
 *   · transactions                  — V3
 *   · resource_transactions         — V3
 *
 * อ่านเท่านั้น (GET/HEAD) — ไม่มี insert/update/delete ใด ๆ · เขียนผลลง backups/<ts>_tenant_prechange/
 * หมายเหตุ: scripts/backup.ts ตัวเดิมยังอ้างชื่อตารางเก่า 5 ตัวที่ไม่มีใน production แล้ว
 * (debt_trackings, document_items, documents, invoice_debts, invoice_payments) จึงไม่ครอบคลุม
 * companies — ไฟล์นี้ปิดช่องว่างนั้นแบบเฉพาะเจาะจง ไม่แก้สคริปต์กลาง
 *
 * Run: npm run tenant-prechange:export
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* env may already be provided */ }
}
loadEnvLocal();

const TABLES = [
  "companies",
  "bank_statement_transactions",
  "bank_notifications",
  "storage_evidence",
  "file_snapshots",
  "transactions",
  "resource_transactions",
] as const;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("ต้องตั้ง NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(process.cwd(), "backups", `${stamp}_tenant_prechange`);
  mkdirSync(dir, { recursive: true });

  const manifest: { table: string; rows: number | null; error?: string }[] = [];
  for (const table of TABLES) {
    // อ่านทีละหน้า (PostgREST จำกัด 1000 แถว/ครั้ง) — read-only เท่านั้น
    const rows: unknown[] = [];
    let error: string | undefined;
    for (let from = 0; from < 20_000; from += 1000) {
      const res = await db.from(table).select("*").range(from, from + 999);
      if (res.error) { error = res.error.message; break; }
      if (!res.data || res.data.length === 0) break;
      rows.push(...res.data);
      if (res.data.length < 1000) break;
    }
    if (!error) writeFileSync(join(dir, `${table}.json`), JSON.stringify(rows, null, 2), "utf8");
    manifest.push({ table, rows: error ? null : rows.length, ...(error ? { error } : {}) });
    console.log(`  ${error ? "✗" : "✓"} ${table.padEnd(30)} ${error ?? `${rows.length} rows`}`);
  }
  writeFileSync(join(dir, "_manifest.json"), JSON.stringify({ tables: manifest, captured_at: new Date().toISOString(), read_only: true }, null, 2), "utf8");
  const failures = manifest.filter((m) => m.error).length;
  console.log(`\n  Path:   ${dir}`);
  console.log(`  Tables: ${manifest.length - failures}/${manifest.length}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e instanceof Error ? e.message : e);
  process.exit(2);
});
