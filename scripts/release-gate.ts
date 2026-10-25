/**
 * DNA OS — Scoped Release Gate (owner directive 2026-10-12: สองระบบมี Release
 * Gate แยกกัน ไม่ให้ปัญหา IDE มาขัดขวางการเผยแพร่ระบบธุรกิจ และกลับกัน).
 *
 *   release-gate business   = type-check (พื้นร่วม) + shared suite + business suite
 *   release-gate developer  = type-check (พื้นร่วม) + developer suite
 *
 * ไม่ได้แตะ scripts/deploy-gate.ts เดิม (prebuild/Vercel) — gate นี้เป็นขอบเขต
 * ของทีม/Tracks ใช้ตอนจะปล่อยของสายใดสายหนึ่ง ส่วน deploy-gate ยังเป็น
 * production safety net ตัวเดิมที่รวมทุกอย่างตามเดิม
 *
 * พื้นร่วม (type-check) ยังอยู่ในทั้งสอง gate เพราะโค้ดทั้ง Monorepo compile
 * เป็นโปรแกรมเดียว — ถ้าtype ของฝั่ง business พัง ก็ deploy ฝั่ง developer
 * ไม่ได้เช่นกัน นี่คือข้อจำกัดจริงของ single-tsconfig ไม่ใช่การผสรวม test
 *
 * ใช้: npx tsx scripts/release-gate.ts business|developer
 */
import { execSync } from "child_process";
import { join } from "path";

const ROOT = join(__dirname, "..");

function step(label: string, command: string): boolean {
  process.stdout.write(`\n--- ${label}\n    $ ${command}\n`);
  try {
    execSync(command, { cwd: ROOT, stdio: "inherit" });
    console.log(`    PASS: ${label}`);
    return true;
  } catch {
    console.error(`    FAIL: ${label}`);
    return false;
  }
}

function main(): void {
  const scope = process.argv[2];
  if (scope !== "business" && scope !== "developer") {
    console.error("วิธีใช้: npx tsx scripts/release-gate.ts business|developer");
    process.exit(2);
  }

  console.log(`╔══════════════════════════════════════════╗`);
  console.log(`║  DNA OS Release Gate — ${scope.toUpperCase().padEnd(19)}║`);
  console.log(`╚══════════════════════════════════════════╝`);

  const results: { label: string; ok: boolean }[] = [];

  // พื้นร่วม — Monorepo compile เป็นโปรแกรมเดียว
  results.push({ label: "type-check (พื้นร่วมทั้ง Monorepo)", ok: step("type-check (พื้นร่วมทั้ง Monorepo)", "npx tsc --noEmit") });

  if (scope === "business") {
    results.push({ label: "shared suite (ระบบกลางที่ business พึ่งพา)", ok: step("shared suite", "npx tsx scripts/run-suite.ts shared") });
    results.push({ label: "business suite (ระบบหลัก)", ok: step("business suite", "npx tsx scripts/run-suite.ts business") });
  } else {
    results.push({ label: "developer suite (ระบบพัฒนา)", ok: step("developer suite", "npx tsx scripts/run-suite.ts developer") });
  }

  console.log(`\n=== Release Gate [${scope}] สรุป ===`);
  for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\nRELEASE BLOCKED (${scope}): ${failed.map((f) => f.label).join(" · ")}`);
    console.error(scope === "business"
      ? "ปัญหานี้อยู่ฝั่งระบบธุรกิจ/ระบบกลาง — สาย developer ไม่ถูกกันไว้ (แยก gate แล้ว)"
      : "ปัญหานี้อยู่ฝั่งระบบพัฒนา — สายธุรกิจไม่ถูกกันไว้ (แยก gate แล้ว)");
    process.exit(1);
  }
  console.log(`\nRELEASE READY (${scope})`);
}

main();
