/**
 * ui-baseline-guard.ts — ONE NAVIGATION canonical lock
 *
 * ตรวจ diff เทียบกับ tag `ui-baseline-one-navigation` (commit 37ab322: refactor(ui):
 * enforce one surface one navigation one path) กัน navigation shell เก่าหรือ
 * โครงสร้างคู่ขนานย้อนกลับเข้ามาใน source อีกครั้ง:
 *
 *   1. baseline tag ต้อง resolve ได้ (ยังไม่ถูกลบ/ย้าย)
 *   2. ไฟล์เมนูเก่า 7 ตัวที่ถูกลบใน baseline ต้องไม่มีอยู่บนดิสก์
 *   3. `git diff --name-status <baseline>` (เทียบ baseline กับ working tree รวม
 *      ทั้ง committed และค้าง stage) — ห้ามมีสถานะ A (เพิ่มใหม่) ของ:
 *        - path ใด ๆ ในรายการไฟล์เมนูเก่า (การ reintroduce ตรงตัว)
 *        - path ใหม่ที่มีชื่อ HomeBackBar / AppHeader / TabStrip /
 *          BusinessWorkspace (การ reintroduce ภายใต้ชื่อ/ที่อยู่ใหม่)
 *   4. ไฟล์ .ts/.tsx ที่ถูกเพิ่มใหม่หลัง baseline ต้องไม่มี
 *      import/render ของชื่อเมนูเก่า (จับแม้ import จาก path ปลอม)
 *
 * รัน: npm run ui-baseline:guard (หรือ npx tsx scripts/ui-baseline-guard.ts)
 * PASS/FAIL ต่อ check; exit 1 ถ้ามี FAIL
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BASELINE = "ui-baseline-one-navigation";

/** ไฟล์เมนูเก่าที่ถูกลบใน baseline commit — ห้ามกลับมา */
const FORBIDDEN_FILES = [
  "presentation/shell/navigation/HomeBackBar.tsx",
  "presentation/shell/navigation/AppHeader.tsx",
  "presentation/shell/ide/TabStrip.tsx",
  "app/workspace/BusinessWorkspace.tsx",
  "app/workspace/InboxIndicator.tsx",
  "app/workspace/WorkspaceSettings.tsx",
  "app/workspace/_lib/workspaceAppearance.ts",
] as const;

/** ชื่อต้องห้าม — จับทั้ง reintroduce path เดิมและ path ใหม่ที่ใช้ชื่อเดิม */
const FORBIDDEN_NAME = /HomeBackBar|AppHeader|ide\/TabStrip|BusinessWorkspace/;

/** import/render ของเมนูเก่าในไฟล์ที่เพิ่มใหม่ */
const FORBIDDEN_USAGE =
  /import[^\n]*(HomeBackBar|navigation\/AppHeader|ide\/TabStrip|BusinessWorkspace|InboxIndicator|WorkspaceSettings|workspaceAppearance)|<(HomeBackBar|AppHeader|TabStrip|BusinessWorkspace)\b/;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function git(args: string): string {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8" }).trim();
}

console.log("ui-baseline-guard: ONE NAVIGATION canonical lock\n");

// ── 1. baseline tag ยังอยู่ ──────────────────────────────────────────────────
let baselineSha = "";
try {
  baselineSha = git(`rev-parse --verify ${BASELINE}^{commit}`);
} catch {
  /* empty */
}
check(
  `1. baseline tag "${BASELINE}" resolves`,
  baselineSha.length === 40,
  baselineSha.length === 40 ? "" : "tag หายไป — กัน diff เทียบ baseline ไม่ได้",
);
if (baselineSha.length === 40) {
  console.log(`       baseline = ${baselineSha.slice(0, 12)}`);
}

// ── 2. ไฟล์เมนูเก่าต้องไม่มีบนดิสก์ ────────────────────────────────────────
for (const f of FORBIDDEN_FILES) {
  check(`2. deleted file stays deleted: ${f}`, !existsSync(join(ROOT, f)));
}

// ── 3. diff กับ baseline — ห้ามมีไฟล์ต้องห้ามถูกเพิ่ม (A) กลับมา ────────────
if (baselineSha.length === 40) {
  const diff = git(`diff --name-status ${BASELINE} --`).split("\n").filter(Boolean);
  const added = diff.filter((l) => l.startsWith("A\t")).map((l) => l.slice(2));
  // untracked (ยังไม่ git add) ก็ต้องนับเป็น "ถูกเพิ่ม" ไม่ให้หลุด guard
  const untracked = git("ls-files --others --exclude-standard")
    .split("\n")
    .filter(Boolean);
  const allAdded = [...new Set([...added, ...untracked])];

  const reintroducedPath = allAdded.filter((p) =>
    (FORBIDDEN_FILES as readonly string[]).includes(p),
  );
  check(
    "3. no forbidden file re-added (diff vs baseline + untracked, status A)",
    reintroducedPath.length === 0,
    reintroducedPath.join(", "),
  );

  const renamedName = allAdded.filter((p) => FORBIDDEN_NAME.test(p));
  check(
    "4. no NEW file introduced under a forbidden name (HomeBackBar/AppHeader/TabStrip/BusinessWorkspace)",
    renamedName.length === 0,
    renamedName.join(", "),
  );

  // ── 4. ไฟล์ .ts/.tsx ที่เพิ่มใหม่หลัง baseline ต้องไม่ import/render เมนูเก่า ──
  // scope = runtime source เท่านั้น — scripts/ (test/guard) มีสิทธิ์กล่าวถึง
  // ชื่อเมนูเก่าใน negative assertion (เช่น existsSync !file) โดยไม่ใช่ usage
  const RUNTIME_ROOTS = /^(app|components|presentation|core|engines|services|gateway|cognitive|plugins|presenter)\//;
  const addedSources = allAdded.filter((p) => /\.tsx?$/.test(p) && RUNTIME_ROOTS.test(p));
  const badUsage: string[] = [];
  for (const p of addedSources) {
    const abs = join(ROOT, p);
    if (!existsSync(abs)) continue; // ถูกลบอีกรอบภายหลัง
    if (FORBIDDEN_USAGE.test(readFileSync(abs, "utf8"))) badUsage.push(p);
  }
  check(
    `5. newly added sources (${addedSources.length} file(s)) import no forbidden menu component`,
    badUsage.length === 0,
    badUsage.join(", "),
  );
}

console.log(`\nui-baseline: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
