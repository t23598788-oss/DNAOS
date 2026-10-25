/**
 * DNA OS — Two-Track Suite Runner (owner directive 2026-10-12).
 *
 * รัน test ตามคณะที่ registry/test-suites.json จำแนกไว้ (business / developer /
 * shared) โดยเรียก package.json script จริง — ไม่ duplicate คำสั่ง test ใด ๆ
 *
 * กติกาที่บังคับทุกครั้ง:
 *   1. COMPLETENESS — ทุก package.json script ที่ลงท้าย :test/:guard ต้องอยู่ใน
 *      คณะใดคณะหนึ่งของ manifest ถ้ามี script ใหม่หลุดจากการจำแนก = FAIL
 *      (กันไม่ให้ test หายไปจากระบบเงียบ ๆ หลัง split)
 *   2. GHOST — รายการใน manifest ที่ไม่มีใน package.json = FAIL (manifest เก่า)
 *   3. DUPLICATE — ชื่อเดียวกันอยู่เกินหนึ่งคณะ = FAIL
 *   4. KNOWN_MISSING — script ที่ชี้ไฟล์ไม่มีอยู่จริง (ค้างก่อน split) แสดง
 *      WARN ทุกรอบ ข้ามการรัน ไม่นับ FAIL — ไม่มีการสร้างไฟล์เท็จมาแทน
 *
 * ใช้: npx tsx scripts/run-suite.ts business|developer|shared|all [--dry-run]
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const ROOT = join(__dirname, "..");

interface SuiteManifest {
  suites: Record<string, { display_name: string; tests: string[] }>;
  known_missing: Record<string, string>;
}

function loadManifest(): SuiteManifest {
  const parsed = JSON.parse(readFileSync(join(ROOT, "registry", "test-suites.json"), "utf-8")) as SuiteManifest;
  if (!parsed?.suites?.business || !parsed?.suites?.developer || !parsed?.suites?.shared) {
    throw new Error("TEST_SUITES_MANIFEST_INVALID: ต้องมี suites business/developer/shared ครบ");
  }
  return parsed;
}

function testScriptsOfPackageJson(): string[] {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { scripts: Record<string, string> };
  return Object.keys(pkg.scripts).filter((k) => k.endsWith(":test") || k.endsWith(":guard"));
}

/** ไฟล์เป้าหมายของ script — จับจาก "npx tsx <path>" หรือ "tsx <path>" เท่านั้น */
function targetFileOf(scriptCommand: string): string | null {
  const m = scriptCommand.match(/(?:npx\s+)?tsx\s+(\S+)/);
  return m ? m[1] : null;
}

function completenessCheck(manifest: SuiteManifest, scripts: string[]): string[] {
  const problems: string[] = [];
  const all = Object.values(manifest.suites).flatMap((s) => s.tests);
  for (const s of scripts) if (!all.includes(s)) problems.push(`UNCLASSIFIED: ${s} ไม่ได้ถูกจัดในคณะใดของ registry/test-suites.json`);
  for (const s of all) if (!scripts.includes(s)) problems.push(`GHOST: manifest มี ${s} แต่ไม่มีใน package.json`);
  const dup = all.filter((s, i) => all.indexOf(s) !== i);
  for (const d of new Set(dup)) problems.push(`DUPLICATE: ${d} อยู่เกินหนึ่งคณะ`);
  return problems;
}

async function runSuite(name: string, manifest: SuiteManifest, dryRun: boolean): Promise<{ passed: number; failed: number; skipped: number; failures: string[] }> {
  const suite = manifest.suites[name];
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { scripts: Record<string, string> };
  console.log(`\n━━━ ${suite.display_name} (${suite.tests.length} tests) ━━━`);

  let passed = 0, failed = 0, skipped = 0;
  const failures: string[] = [];

  for (const test of suite.tests) {
    if (manifest.known_missing[test]) {
      skipped += 1;
      console.log(`  SKIP ${test} — known_missing: ${manifest.known_missing[test].slice(0, 80)}…`);
      continue;
    }
    const target = targetFileOf(pkg.scripts[test] ?? "");
    if (target && !existsSync(join(ROOT, target))) {
      skipped += 1;
      console.log(`  WARN ${test} — ไฟล์เป้าหมาย ${target} ไม่มีอยู่จริง (ควรเพิ่มใน known_missing)`);
      continue;
    }
    if (dryRun) {
      console.log(`  DRY  ${test}`);
      continue;
    }
    try {
      execSync(`npm run ${test}`, { cwd: ROOT, stdio: "pipe", encoding: "utf-8" });
      passed += 1;
      console.log(`  ok   ${test}`);
    } catch (e) {
      failed += 1;
      failures.push(test);
      const out = [(e as { stdout?: string }).stdout ?? "", (e as { stderr?: string }).stderr ?? ""].join("\n").trim();
      console.log(`  FAIL ${test}${out ? `\n${out.split("\n").slice(-6).map((l) => `         ${l}`).join("\n")}` : ""}`);
    }
  }
  return { passed, failed, skipped, failures };
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  const valid = ["business", "developer", "shared", "all"];
  if (!valid.includes(arg)) {
    console.error(`วิธีใช้: npx tsx scripts/run-suite.ts ${valid.join("|")} [--dry-run]`);
    process.exit(2);
  }

  const manifest = loadManifest();
  const scripts = testScriptsOfPackageJson();

  const problems = completenessCheck(manifest, scripts);
  if (problems.length > 0) {
    console.error("=== SUITE INTEGRITY FAIL — registry/test-suites.json ไม่ตรงกับ package.json ===");
    for (const p of problems) console.error(`  ${p}`);
    console.error("  แก้ manifest ให้ครบก่อนรัน — test ห้ามหายจากระบบเงียบ ๆ");
    process.exit(1);
  }
  console.log(`Suite integrity: ผ่าน (${scripts.length} scripts จำแนกครบ ไม่ซ้ำ ไม่มี ghost)`);

  const targets = arg === "all" ? ["business", "developer", "shared"] : [arg];
  const totals = { passed: 0, failed: 0, skipped: 0 };
  const allFailures: string[] = [];
  for (const t of targets) {
    const r = await runSuite(t, manifest, dryRun);
    totals.passed += r.passed; totals.failed += r.failed; totals.skipped += r.skipped;
    allFailures.push(...r.failures);
  }

  console.log(`\n=== สรุป: pass ${totals.passed} · fail ${totals.failed} · skip ${totals.skipped} ===`);
  if (allFailures.length > 0) {
    console.error(`คณะที่ไม่ผ่าน: ${allFailures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error("RUNNER_ERROR:", e instanceof Error ? e.message : e); process.exit(1); });
