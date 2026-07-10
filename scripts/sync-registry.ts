/**
 * DNA OS — Registry Auto-Sync
 *
 * สแกน Source Code จริง → เปรียบเทียบกับ module-registry.json
 * อัปเดต exports ที่เปลี่ยน + เพิ่ม module ใหม่ที่ยังไม่ได้ register
 * ข้อมูลทั้งหมดมาจาก Source Code — ห้าม hardcode
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { glob } from "glob";

const ROOT = join(__dirname, "..");
const REGISTRY_PATH = join(ROOT, "registry/module-registry.json");

// ── Types ──────────────────────────────────────────

interface ModuleEntry {
  owner: string;
  layer: string;
  purpose: string;
  purpose_th: string;
  exports: string[];
  status?: "active" | "unregistered" | "stale";
}

interface ModuleRegistry {
  version: number;
  policy: string;
  modules: Record<string, ModuleEntry>;
}

// ── Helpers ────────────────────────────────────────

function loadRegistry(): ModuleRegistry {
  const raw = readFileSync(REGISTRY_PATH, "utf-8");
  return JSON.parse(raw);
}

function saveRegistry(reg: ModuleRegistry) {
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + "\n", "utf-8");
}

function extractExports(content: string): string[] {
  const exports: string[] = [];
  const patterns = [
    /export\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+(?:abstract\s+)?class\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+type\s+(\w+)/g,
    /export\s+interface\s+(\w+)/g,
    /export\s+enum\s+(\w+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1] && !exports.includes(match[1])) {
        exports.push(match[1]);
      }
    }
  }
  // re-export: export { foo, bar }
  for (const match of content.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const name of match[1].split(",")) {
      const trimmed = name.trim().split(/\s+as\s+/).pop()!.trim();
      if (trimmed && !exports.includes(trimmed)) exports.push(trimmed);
    }
  }
  return exports.sort();
}

function layerFromPath(relPath: string): string {
  const parts = relPath.split("/");
  if (parts[0] === "lib" && parts.length >= 2) return parts[1];
  if (parts[0] === "app") return "app";
  if (parts[0] === "components") return "components";
  if (parts[0] === "scripts") return "scripts";
  return parts[0];
}

// ── Main ───────────────────────────────────────────

async function syncRegistry() {
  const registry = loadRegistry();
  let added = 0;
  let updated = 0;

  const files = await glob("**/*.ts", {
    cwd: ROOT,
    ignore: [
      "node_modules/**",
      ".next/**",
      "**/*.d.ts",
      "**/*.test.ts",
      "**/*.spec.ts",
    ],
  });

  for (const file of files) {
    const absPath = join(ROOT, file);
    const content = readFileSync(absPath, "utf-8");
    const exports = extractExports(content);

    if (exports.length === 0) continue;

    const existing = registry.modules[file];
    if (!existing) {
      const layer = layerFromPath(file);
      registry.modules[file] = {
        owner: layer,
        layer,
        purpose: `[Auto-detected] ${file}`,
        purpose_th: `[ตรวจพบอัตโนมัติ] ${file}`,
        exports,
        status: "unregistered",
      };
      console.log(`  + เพิ่ม: ${file} (${exports.length} exports)`);
      added++;
    } else {
      const prevExports = JSON.stringify([...(existing.exports ?? [])].sort());
      const newExports = JSON.stringify(exports);
      if (prevExports !== newExports) {
        registry.modules[file] = { ...existing, exports, status: "active" };
        console.log(`  ~ อัปเดต exports: ${file}`);
        updated++;
      }
    }
  }

  // ตรวจ module ใน registry ที่ไฟล์หายไป
  let missing = 0;
  for (const [path] of Object.entries(registry.modules)) {
    if (!existsSync(join(ROOT, path))) {
      registry.modules[path] = {
        ...registry.modules[path],
        status: "stale",
      };
      console.log(`  ! ไม่พบไฟล์: ${path} (marked stale)`);
      missing++;
    }
  }

  saveRegistry(registry);
  console.log(`\nSync เสร็จ: +${added} ใหม่, ~${updated} อัปเดต, !${missing} หายไป`);
}

syncRegistry().catch((e) => {
  console.error("[sync-registry] Error:", e);
  process.exit(1);
});
