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
  // Historical evidence for files that no longer exist in Source (Owner directive
  // 2026-09-22: Git/Source = source of truth). A retired path is recorded here
  // instead of being left inside `modules` as status:"stale" — this repo's own
  // scripts/registry-integrity-gate.ts classifies such an entry as a DELETED/STALE
  // finding and states plainly that "the entry must be removed". Keeping it in
  // `modules` also made build-arch-book.ts count it as a current BROKEN module.
  retired?: RetiredEntry[];
}

/** Historical record of a registry entry whose file is gone from Source. Not a module. */
export interface RetiredEntry {
  path: string;
  retired_at: string;
  reason: string;
  last_status?: string;
  purpose_th?: string;
}

// ── Helpers ────────────────────────────────────────

function loadRegistry(): ModuleRegistry {
  const raw = readFileSync(REGISTRY_PATH, "utf-8");
  return JSON.parse(raw);
}

function saveRegistry(reg: ModuleRegistry) {
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + "\n", "utf-8");
}

// Git/Source = source of truth (Owner directive, 2026-09-22): a module's
// description must come from what the module itself declares — never from a
// per-file hardcoded table in this script and never from a guess. Reads the
// first comment the file really has: a leading `//` block, or the first
// `/** … */` block within the file's first 40 lines. Returns null when the file
// declares nothing, so the caller leaves it `unregistered` and reports it
// instead of inventing a purpose (Guard 13 rejects auto-stub purposes).
function purposeFromSource(content: string): string | null {
  const head = content.split("\n").slice(0, 40);
  for (const raw of head) {
    const line = raw.trim();
    if (!line) continue;
    // A file-level directive is not content — step over it instead of stopping.
    if (/^["']use (client|server)["'];?$/.test(line)) continue;
    if (line.startsWith("//")) {
      const text = line.replace(/^\/\/+\s*/, "").trim();
      if (text && !/^(eslint|@ts-|!)/i.test(text)) return text;
      continue;
    }
    break;
  }
  const block = head.join("\n").match(/\/\*\*([\s\S]*?)\*\//);
  if (block) {
    const first = block[1]
      .split("\n")
      .map((l) => l.replace(/^\s*\*?\s?/, "").trim())
      .find(Boolean);
    if (first) return first;
  }
  // Fallback: most real files put their doc comment after the import block and
  // before the first export — take the first comment line that appears before
  // any `export`. Still strictly what the file itself declares; still no guessing.
  for (const raw of head) {
    const line = raw.trim();
    if (!line || /^["']use (client|server)["'];?$/.test(line)) continue;
    if (/^export\b/.test(line)) break;
    if (line.startsWith("//")) {
      const text = line.replace(/^\/\/+\s*/, "").trim();
      if (text && !/^(eslint|@ts-|!)/i.test(text)) return text;
    }
  }
  return null;
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
  let promoted = 0;

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
      // Standalone tool packages (verified-provenance ignore, 2026-10-24):
      // external-packages/ holds SEPARATE npm-style packages (own
      // package.json/tsconfig — checked: semantic-preflight), same class as
      // the scripts/bank-statement-sync/node_modules case that had to be
      // excluded below: scanning them as if they were main-app source
      // auto-stubbed 2 false module entries whose only effect was a permanent
      // UNREGISTERED drift at every build. Not app architecture — if adopted
      // as one, register then, like every other layer.
      // Workspace trash (owner, 2026-08-05, /admin/ide Phase 3) — items
      // moved here can be arbitrary trashed source files (.ts/.tsx),
      // which would otherwise get flagged as new "unregistered" modules.
      "external-packages/**",
      ".dnaos-trash/**",
      // Local recovery/evidence dumps (owner-side backups under recovery/**):
      // not app source and never committed, so registering them made
      // registry-integrity-gate.ts classify thousands of UNTRACKED entries as
      // part of every commit and block it. Same class as .dnaos-trash/**.
      "recovery/**",
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
      const derived = purposeFromSource(content);
      registry.modules[file] = {
        owner: layer,
        layer,
        purpose: derived ?? `[Auto-detected] ${file}`,
        purpose_th: derived ?? `[ตรวจพบอัตโนมัติ] ${file}`,
        exports,
        // A file that exists in Source AND declares what it is in its own header
        // is registered/active straight away. A file that declares nothing stays
        // `unregistered` so the real gap is reported, never covered up.
        status: derived ? "active" : "unregistered",
      };
      console.log(`  + เพิ่ม: ${file} (${exports.length} exports, ${derived ? "active (จาก header ของ source)" : "unregistered — ไฟล์ไม่มี header ให้ดึง purpose"})`);
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
      // An entry previously auto-added as `unregistered` is re-described from the
      // file's own header, so it becomes a real registration instead of staying an
      // auto-stub (Guard 13 in scripts/pre-commit-check.sh rejects auto-stubs at
      // commit time). No purpose is ever invented here — no header ⇒ no promotion.
      if (registry.modules[file].status === "unregistered") {
        const derived = purposeFromSource(content);
        if (derived) {
          registry.modules[file] = {
            ...registry.modules[file],
            purpose: derived,
            purpose_th: derived,
            status: "active",
          };
          console.log(`  ^ ลงทะเบียนจาก header ของ source: ${file}`);
          promoted++;
        }
      }
    }
  }

  // Registry entries whose file is gone from Source ⇒ retire them (move out of
  // `modules` into the `retired` evidence list). Git/Source is the source of
  // truth: the registry follows Source, never the other way round — no deleted
  // file is ever re-created to satisfy the registry, and a retired path is never
  // counted as a current BROKEN module.
  let retiredCount = 0;
  registry.retired = registry.retired ?? [];
  for (const [path, entry] of Object.entries(registry.modules)) {
    if (!existsSync(join(ROOT, path))) {
      delete registry.modules[path];
      registry.retired.push({
        path,
        retired_at: new Date().toISOString(),
        reason: "ไฟล์ไม่มีอยู่ใน Source แล้ว (Git/Source = source of truth) — ย้ายออกจาก modules ไม่นับเป็น BROKEN ปัจจุบัน",
        last_status: entry.status ?? "unknown",
        purpose_th: entry.purpose_th,
      });
      console.log(`  → retired: ${path} (ย้ายออกจาก modules → retired[] เก็บเป็นหลักฐาน)`)
      retiredCount++;
    }
  }

  saveRegistry(registry);
  console.log(`\nSync เสร็จ: +${added} ใหม่, ~${updated} อัปเดต, ^${promoted} ลงทะเบียนจาก source, →${retiredCount} retired (ไฟล์หายจาก Source)`);
}

syncRegistry().catch((e) => {
  console.error("[sync-registry] Error:", e);
  process.exit(1);
});
