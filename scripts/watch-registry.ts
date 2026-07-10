/**
 * DNA OS — Registry File Watcher (Dev Mode)
 *
 * เฝ้าดู core/**, gateway/**, engines/**, cognitive/**, presenter/**, services/**, plugins/**, registry/** และ app/** — ทุกครั้งที่ไฟล์เปลี่ยน:
 *   sync-registry.ts → build-arch-book.ts
 * ใช้ระหว่าง development เท่านั้น (npm run watch)
 */

import chokidar from "chokidar";
import { execSync } from "child_process";
import { join } from "path";

const ROOT = join(__dirname, "..");
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function runSync(changedFile: string) {
  const timestamp = new Date().toLocaleTimeString("th-TH");
  console.log(`\n[${timestamp}] ตรวจพบการเปลี่ยนแปลง: ${changedFile}`);

  try {
    console.log("  → sync-registry...");
    execSync("npx tsx scripts/sync-registry.ts", { cwd: ROOT, stdio: "inherit" });

    console.log("  → build-arch-book...");
    execSync("npx tsx scripts/build-arch-book.ts", { cwd: ROOT, stdio: "inherit" });

    console.log(`  ✓ Registry อัปเดตแล้ว`);
  } catch (e) {
    console.error("  ✗ Error:", e);
  }
}

const watcher = chokidar.watch(
  ["core/**/*.ts", "gateway/**/*.ts", "engines/**/*.ts", "cognitive/**/*.ts", "presenter/**/*.ts", "services/**/*.ts", "plugins/**/*.ts", "registry/**/*.ts", "app/**/*.ts", "scripts/**/*.ts"],
  {
    cwd: ROOT,
    ignored: [
      "**/node_modules/**",
      "**/.next/**",
      "**/*.d.ts",
    ],
    persistent: true,
    ignoreInitial: true,
  }
);

watcher.on("change", (path) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSync(path), 500);
});

watcher.on("add", (path) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSync(path), 500);
});

watcher.on("ready", () => {
  console.log("DNA OS Registry Watcher พร้อมทำงาน");
  console.log("  เฝ้าดู: core, gateway, engines, cognitive, presenter, services, plugins, registry, app/**/*.ts");
  console.log("  กด Ctrl+C เพื่อหยุด\n");
});
