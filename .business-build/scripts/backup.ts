/**
 * DNA OS Database Backup
 *
 * Export ทุกตาราง Supabase เป็น JSON → backups/YYYY-MM-DD_HHmmss/
 * รัน: npm run backup
 * Restore: npm run restore -- backups/2026-06-30_120000
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

const TABLES = [
  "app_configs",
  "conversation_states",
  "debt_trackings",
  "document_items",
  "documents",
  "driver_profiles",
  "entity_registry",
  "invoice_debts",
  "invoice_payments",
  "jobs",
  "kv_cache",
  "line_draft_documents",
  "line_events",
  "match_queue",
  "material_types",
  "partners",
  "pit_materials",
  "pit_profiles",
  "resource_transactions",
  "vehicle_types",
];

const MAX_BACKUPS = 30;

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("ต้องตั้ง NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY (หรือ NEXT_PUBLIC_SUPABASE_ANON_KEY)");
    process.exit(1);
  }
  return createClient(url, key);
}

async function backup() {
  const supabase = getClient();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15).replace("T", "_");
  const backupDir = join(process.cwd(), "backups", timestamp);
  mkdirSync(backupDir, { recursive: true });

  console.log(`╔══════════════════════════════════════╗`);
  console.log(`║   DNA OS Backup → ${timestamp}   ║`);
  console.log(`╚══════════════════════════════════════╝`);
  console.log();

  let totalRows = 0;
  let successCount = 0;
  const errors: string[] = [];

  for (const table of TABLES) {
    process.stdout.write(`  ${table.padEnd(25)}`);
    try {
      const { data, error } = await supabase.from(table).select("*").limit(50000);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      writeFileSync(join(backupDir, `${table}.json`), JSON.stringify(rows, null, 2));
      totalRows += rows.length;
      successCount++;
      console.log(`✓ ${rows.length} rows`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${table}: ${msg}`);
      console.log(`✗ ${msg}`);
    }
  }

  const manifest = {
    created_at: new Date().toISOString(),
    tables: TABLES.length,
    success: successCount,
    errors: errors.length,
    total_rows: totalRows,
    error_details: errors.length > 0 ? errors : undefined,
  };
  writeFileSync(join(backupDir, "_manifest.json"), JSON.stringify(manifest, null, 2));

  console.log();
  console.log(`══════════════════════════════════════`);
  console.log(`  Tables: ${successCount}/${TABLES.length}`);
  console.log(`  Rows:   ${totalRows.toLocaleString()}`);
  console.log(`  Path:   ${backupDir}`);
  if (errors.length > 0) {
    console.log(`  Errors: ${errors.length}`);
  }
  console.log(`══════════════════════════════════════`);

  cleanOldBackups();
}

async function restore(backupPath: string) {
  if (!existsSync(backupPath)) {
    console.error(`ไม่พบ backup: ${backupPath}`);
    process.exit(1);
  }

  const manifestPath = join(backupPath, "_manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`ไม่พบ _manifest.json ใน ${backupPath} — ไม่ใช่ backup ที่ถูกต้อง`);
    process.exit(1);
  }

  const supabase = getClient();

  console.log(`╔══════════════════════════════════════╗`);
  console.log(`║   DNA OS Restore ← ${backupPath.split("/").pop()?.padEnd(16)}║`);
  console.log(`╚══════════════════════════════════════╝`);
  console.log();
  console.log(`  ⚠ RESTORE จะ UPSERT ข้อมูล — ไม่ลบข้อมูลเดิมที่ไม่อยู่ใน backup`);
  console.log();

  let totalRows = 0;
  let successCount = 0;

  for (const table of TABLES) {
    const filePath = join(backupPath, `${table}.json`);
    if (!existsSync(filePath)) {
      console.log(`  ${table.padEnd(25)} - skip (no file)`);
      continue;
    }

    process.stdout.write(`  ${table.padEnd(25)}`);
    try {
      const raw = require(filePath);
      const rows = Array.isArray(raw) ? raw : [];
      if (rows.length === 0) {
        console.log(`- empty`);
        continue;
      }

      const batchSize = 500;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error } = await supabase.from(table).upsert(batch, { onConflict: "id" });
        if (error) throw new Error(error.message);
      }

      totalRows += rows.length;
      successCount++;
      console.log(`✓ ${rows.length} rows`);
    } catch (err) {
      console.log(`✗ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log();
  console.log(`══════════════════════════════════════`);
  console.log(`  Restored: ${successCount} tables, ${totalRows.toLocaleString()} rows`);
  console.log(`══════════════════════════════════════`);
}

function cleanOldBackups() {
  const backupsDir = join(process.cwd(), "backups");
  if (!existsSync(backupsDir)) return;

  const dirs = readdirSync(backupsDir)
    .filter((name) => {
      const fullPath = join(backupsDir, name);
      return statSync(fullPath).isDirectory() && existsSync(join(fullPath, "_manifest.json"));
    })
    .sort()
    .reverse();

  if (dirs.length <= MAX_BACKUPS) return;

  const toDelete = dirs.slice(MAX_BACKUPS);
  for (const dir of toDelete) {
    const fullPath = join(backupsDir, dir);
    const files = readdirSync(fullPath);
    for (const file of files) {
      require("fs").unlinkSync(join(fullPath, file));
    }
    require("fs").rmdirSync(fullPath);
    console.log(`  Cleaned old backup: ${dir}`);
  }
}

const args = process.argv.slice(2);
if (args[0] === "restore" && args[1]) {
  restore(args[1]);
} else {
  backup();
}
