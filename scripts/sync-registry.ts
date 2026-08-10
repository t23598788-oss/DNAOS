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

// Exported (TASK-076 / FCR-026, registry-integrity-gate.ts) — the gate reuses
// this exact shape via `import type` (erased at compile time, isolatedModules:
// true in tsconfig.json, so this adds zero runtime coupling and cannot trigger
// this file's own syncRegistry().catch(...) side effect at the bottom) instead
// of inventing a second, competing registry-entry schema (Rule 101/103).
export interface ModuleEntry {
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

// KM-001 (registry/existence.json known_mistakes): this duplicates scripts/build-arch-book.ts's
// extractExportsFromFile. Both independently had the same .tsx-blindness bug class 3 times this
// session — check that file too when fixing a parsing bug here.
function extractExports(content: string): string[] {
  const exports: string[] = [];
  const patterns = [
    /export\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+(?:abstract\s+)?class\s+(\w+)/g,
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+type\s+(\w+)/g,
    /export\s+interface\s+(\w+)/g,
    /export\s+enum\s+(\w+)/g,
    /export\s+default\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+default\s+(?:abstract\s+)?class\s+(\w+)/g,
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
  // bare `export default <expr>` (anonymous, or an identifier already covered above)
  if (exports.length === 0 && /export\s+default\s+/.test(content)) {
    exports.push("default");
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

// Rule 100 — Core Learning Policy (registry/existence.json known_mistakes). Single source
// of truth read here, not hardcoded — the same list scripts/check-imports.sh and
// scripts/build-arch-book.ts read. Module Registration is the earliest point a new file
// can be checked against a known confirmed duplicate, before it's ever committed.
function loadConfirmedDuplicatePairs(): { keep: string; deprecated: string; reason: string }[] {
  try {
    const existence = JSON.parse(readFileSync(join(ROOT, "registry/existence.json"), "utf-8"));
    return existence.known_mistakes?.confirmed_duplicate_pairs?.pairs ?? [];
  } catch {
    return [];
  }
}

// ── Main ───────────────────────────────────────────

async function syncRegistry() {
  const registry = loadRegistry();
  const confirmedPairs = loadConfirmedDuplicatePairs();
  let added = 0;
  let updated = 0;

  const files = await glob("**/*.{ts,tsx}", {
    cwd: ROOT,
    ignore: [
      // Real gap found live 2026-07-27: "node_modules/**" only matched a
      // top-level folder — scripts/bank-statement-sync/node_modules (a
      // real, separate package.json for Playwright, deliberately kept out
      // of the main app's dependency tree) got scanned as if it were real
      // app source, flagging 88 real npm packages as UNREGISTERED modules.
      "**/node_modules/**",
      ".next/**",
      // Workspace trash (owner, 2026-08-05, /admin/ide Phase 3) — items
      // moved here can be arbitrary trashed source files (.ts/.tsx),
      // which would otherwise get flagged as new "unregistered" modules.
      ".dnaos-trash/**",
      "**/*.d.ts",
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/*.test.tsx",
      "**/*.spec.tsx",
    ],
  });

  for (const file of files) {
    const absPath = join(ROOT, file);
    const content = readFileSync(absPath, "utf-8");
    const exports = extractExports(content);

    // Root cause fix (Step 10.5, Phase 12): a real file with zero real
    // top-level exports (e.g. a standalone script using a local main()
    // IIFE pattern, never exported) is STILL a real module — it must
    // still be registered, honestly, with a real empty exports array.
    // The previous `if (exports.length === 0) continue;` silently made
    // such files permanently invisible to the registry (never added,
    // never reported, no warning) — reproduced live: scripts/release-
    // test.ts, compatibility-test.ts, country-test.ts, and document-
    // lifecycle-test.ts (Step 10) all have genuinely zero real exports
    // and were silently skipped every sync run. This is a real, narrow
    // fix to the actual defect (silent invisibility), never a whitelist,
    // never an ignore-list, never file-name-specific.

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

      // Rule 100 / KM-002: warn immediately if this brand-new file is one half of an
      // already-known confirmed duplicate pair — earliest possible warning point.
      const asKeep = confirmedPairs.find((p) => p.keep === file);
      const asDeprecated = confirmedPairs.find((p) => p.deprecated === file);
      if (asKeep) {
        console.log(`  WARNING: '${file}' is the KEEP side of a confirmed duplicate pair (${asKeep.deprecated} is deprecated) — ${asKeep.reason}`);
      }
      if (asDeprecated) {
        console.log(`  WARNING: '${file}' is the DEPRECATED side of a confirmed duplicate pair — โปรดใช้ '${asDeprecated.keep}' แทน. ${asDeprecated.reason}`);
      }
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
