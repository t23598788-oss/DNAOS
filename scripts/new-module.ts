/**
 * DNA OS — New Module CLI
 *
 * สร้างโมดูลใหม่พร้อมบังคับประกาศ:
 *   - declared_callers  (ใครจะ import โมดูลนี้)
 *   - หรือ entry_point: true (API route / script / page ที่ไม่ต้องมีผู้เรียก)
 *
 * Usage:
 *   npx tsx scripts/new-module.ts --path engines/my-module.ts \
 *       --purpose "อธิบายสิ่งที่โมดูลทำ" \
 *       --layer engines \
 *       --callers cognitive/pipeline.ts,app/api/action/route.ts
 *
 *   npx tsx scripts/new-module.ts --path app/api/my-route/route.ts \
 *       --purpose "API endpoint สำหรับ..." \
 *       --layer api \
 *       --entry-point
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const ROOT = join(__dirname, "..");
const REGISTRY_PATH = join(ROOT, "registry/module-registry.json");

// ── Argument parsing ────────────────────────────────

function parseArgs(): {
  path: string;
  purpose: string;
  layer: string;
  callers: string[];
  entryPoint: boolean;
  owner: string;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  };
  const has = (flag: string) => args.includes(flag);

  const path = get("--path");
  const purpose = get("--purpose");
  const layer = get("--layer");
  const callersRaw = get("--callers");
  const entryPoint = has("--entry-point");
  const owner = get("--owner") ?? "";
  const dryRun = has("--dry-run");

  if (!path) { console.error("ERROR: --path is required"); process.exit(1); }
  if (!purpose) { console.error("ERROR: --purpose is required"); process.exit(1); }
  if (!layer) { console.error("ERROR: --layer is required"); process.exit(1); }
  if (!entryPoint && !callersRaw) {
    console.error(
      "\nERROR: ต้องประกาศอย่างใดอย่างหนึ่ง:\n" +
      "  --callers <file1,file2,...>   ไฟล์ที่จะ import โมดูลนี้\n" +
      "  --entry-point                 โมดูลเป็น API route / script / page ที่ไม่ต้องมีผู้เรียก\n\n" +
      "เหตุผล: โมดูลที่ไม่มี caller และไม่ใช่ entry point จะ UNUSED ทันทีหลัง build-arch-book รัน"
    );
    process.exit(1);
  }

  const callers = callersRaw ? callersRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return { path, purpose, layer, callers, entryPoint, owner, dryRun };
}

// ── Validation ──────────────────────────────────────

function validateCallers(callers: string[]): void {
  const missing: string[] = [];
  for (const caller of callers) {
    const callerExts = [caller, caller.endsWith(".ts") ? caller : `${caller}.ts`, `${caller}.tsx`];
    const exists = callerExts.some((p) => existsSync(join(ROOT, p)));
    if (!exists) missing.push(caller);
  }
  if (missing.length > 0) {
    console.error(
      `\nERROR: declared_callers มีไฟล์ที่ยังไม่มีอยู่จริง:\n` +
      missing.map((f) => `  - ${f}`).join("\n") +
      `\n\nต้องสร้างไฟล์ caller ก่อน หรือใช้ --entry-point ถ้าโมดูลนี้ไม่ต้องการ caller`
    );
    process.exit(1);
  }
}

// ── Registry update ─────────────────────────────────

function updateRegistry(
  filePath: string,
  purpose: string,
  layer: string,
  callers: string[],
  entryPoint: boolean,
  owner: string
): void {
  const reg = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));

  if (reg.modules[filePath]) {
    console.error(`ERROR: "${filePath}" มีอยู่ใน registry แล้ว`);
    process.exit(1);
  }

  const entry: Record<string, any> = {
    owner: owner || layer,
    layer,
    purpose_th: purpose,
    exports: [],
    status: "active",
  };
  if (entryPoint) {
    entry.entry_point = true;
  } else {
    entry.declared_callers = callers;
  }

  reg.modules[filePath] = entry;

  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + "\n", "utf-8");
  console.log(`[registry] เพิ่ม "${filePath}" เรียบร้อย`);
}

// ── File scaffold ────────────────────────────────────

function scaffold(filePath: string, purpose: string, layer: string): boolean {
  const absPath = join(ROOT, filePath);
  if (existsSync(absPath)) {
    console.log(`[scaffold] "${filePath}" มีอยู่แล้ว — ข้าม`);
    return false;
  }

  const dir = dirname(absPath);
  mkdirSync(dir, { recursive: true });

  const layerComment = `DNA OS ${layer.toUpperCase()} — ${purpose}`;
  const stub = `/**\n * ${layerComment}\n */\n\n// TODO: implement\nexport {};\n`;

  writeFileSync(absPath, stub, "utf-8");
  console.log(`[scaffold] สร้าง "${filePath}"`);
  return true;
}

// ── Main ─────────────────────────────────────────────

async function main() {
  const { path, purpose, layer, callers, entryPoint, owner, dryRun } = parseArgs();

  console.log(`\nDNA OS — New Module`);
  console.log(`  Path:    ${path}`);
  console.log(`  Purpose: ${purpose}`);
  console.log(`  Layer:   ${layer}`);
  if (entryPoint) {
    console.log(`  Type:    entry_point (ไม่ต้องมี caller)`);
  } else {
    console.log(`  Callers: ${callers.join(", ")}`);
  }
  if (dryRun) console.log(`  [dry-run mode — ไม่เขียนไฟล์จริง]`);
  console.log();

  // Validate callers exist
  if (!entryPoint) validateCallers(callers);

  if (dryRun) {
    console.log("dry-run: ผ่าน validation — ไม่มีการเขียนไฟล์");
    return;
  }

  // Create file scaffold
  scaffold(path, purpose, layer);

  // Register in module-registry.json
  updateRegistry(path, purpose, layer, callers, entryPoint, owner);

  console.log(`\nขั้นตอนถัดไป:`);
  if (!entryPoint) {
    console.log(`  1. เพิ่ม import ใน caller file(s):`);
    for (const caller of callers) {
      console.log(`       import { ... } from "@/${path.replace(/\.ts$/, "")}";`);
      console.log(`       // ใน ${caller}`);
    }
  }
  console.log(`  2. Implement "${path}"`);
  console.log(`  3. รัน: npx tsx scripts/build-arch-book.ts`);
  console.log(`     เพื่อตรวจสอบว่า connection ถูกต้อง\n`);
}

main().catch((e) => {
  console.error("[new-module] Error:", e.message);
  process.exit(1);
});
