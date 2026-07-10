/**
 * DNA OS — Architecture Book Builder
 *
 * อ่าน Registry ทุกตัว → cross-reference → คำนวณ status จริง
 * เขียน registry/architecture-book.json
 * ห้าม hardcode คำอธิบาย — ทุกข้อมูลมาจาก Registry และ Source Code
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { glob } from "glob";

const ROOT = join(__dirname, "..");
const REGISTRY = join(ROOT, "registry");

// ── Types ──────────────────────────────────────────

export interface ArchNode {
  id: string;
  type: "Module" | "Layer" | "API" | "Database" | "Command" | "Workflow";
  layer: string;
  name_en: string;
  purpose_th: string;
  exports: string[];
  status: "OK" | "BROKEN" | "UNUSED" | "UNREGISTERED";
  error_th?: string;
}

export interface ArchEdge {
  source: string;
  target: string;
  label: "imports" | "contains" | "calls";
}

export interface ArchitectureBook {
  generated_at: string;
  version: number;
  nodes: ArchNode[];
  edges: ArchEdge[];
  summary: {
    total: number;
    ok: number;
    broken: number;
    unused: number;
    unregistered: number;
  };
}

// ── Loaders ────────────────────────────────────────

function load(filename: string): any {
  const p = join(REGISTRY, filename);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf-8")); }
  catch { return {}; }
}

function extractExportsFromFile(absPath: string): string[] {
  if (!existsSync(absPath)) return [];
  const content = readFileSync(absPath, "utf-8");
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
      if (match[1] && !exports.includes(match[1])) exports.push(match[1]);
    }
  }
  for (const match of content.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const name of match[1].split(",")) {
      const trimmed = name.trim().split(/\s+as\s+/).pop()!.trim();
      if (trimmed && !exports.includes(trimmed)) exports.push(trimmed);
    }
  }
  // export default (any form: function, class, new expression, value)
  if (/export\s+default\b/.test(content) && !exports.includes("default")) {
    exports.push("default");
  }
  // export * from "./module" — barrel re-export: resolve recursively (1 level)
  for (const match of content.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
    const rel = match[1];
    if (rel.startsWith("./") || rel.startsWith("../")) {
      const dir = absPath.substring(0, absPath.lastIndexOf("/"));
      const resolved = rel.endsWith(".ts")
        ? join(dir, rel)
        : join(dir, rel + ".ts");
      for (const name of extractExportsFromFile(resolved)) {
        if (!exports.includes(name)) exports.push(name);
      }
    }
  }
  return exports.sort();
}

function extractImportsFromFile(absPath: string): string[] {
  if (!existsSync(absPath)) return [];
  const content = readFileSync(absPath, "utf-8");
  const imports: string[] = [];
  // named imports: from "..."
  for (const match of content.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const imp = match[1];
    if (imp.startsWith("@/") || imp.startsWith("./") || imp.startsWith("../")) {
      imports.push(imp);
    }
  }
  // side-effect imports: import "..." (no from)
  for (const match of content.matchAll(/^import\s+['"]([^'"]+)['"]/gm)) {
    const imp = match[1];
    if (imp.startsWith("@/") || imp.startsWith("./") || imp.startsWith("../")) {
      if (!imports.includes(imp)) imports.push(imp);
    }
  }
  return imports;
}

// ── Status Calculator ──────────────────────────────

// Entry point patterns that are valid without being imported
const ENTRY_POINT_PATTERNS = [
  /^app\/api\/.+\/route\.(ts|tsx)$/,        // Next.js API routes (HTTP endpoints)
  /^app\/(layout|page|error|loading)\.(tsx|ts)$/, // Next.js root files
  /^app\/.+\/(layout|page|error|loading)\.(tsx|ts)$/, // Next.js page files
  /^scripts\/.+\.ts$/,                       // CLI scripts
  /^next\.config\.(ts|js)$/,                 // Next.js config
  /^supabase\/functions\/.+\/index\.ts$/,    // Supabase edge function entry
  /\.test\.ts$/, /\.spec\.ts$/,              // Test files
];

function isEntryPoint(filePath: string): boolean {
  return ENTRY_POINT_PATTERNS.some((p) => p.test(filePath));
}

function calcStatus(
  filePath: string,
  registeredExports: string[],
  isImported: boolean,
  registryData?: Record<string, any>
): { status: ArchNode["status"]; error_th?: string } {
  const absPath = join(ROOT, filePath);

  if (!existsSync(absPath)) {
    return {
      status: "BROKEN",
      error_th: `ไม่พบไฟล์จริง: ${filePath} — ลงทะเบียนไว้แต่ไฟล์หายไปจาก Source Code`,
    };
  }

  const actualExports = extractExportsFromFile(absPath);

  if (actualExports.length === 0 && registeredExports.length > 0) {
    return {
      status: "BROKEN",
      error_th: `ไม่พบ export ใดๆ ในไฟล์ แต่ registry ระบุ ${registeredExports.length} exports — อาจมีการ refactor โดยไม่อัปเดต registry`,
    };
  }

  if (registeredExports.length > 0) {
    const missingFromFile = registeredExports.filter(
      (e) => !actualExports.includes(e)
    );
    if (missingFromFile.length > registeredExports.length * 0.5) {
      return {
        status: "BROKEN",
        error_th: `Registry ระบุ exports ที่ไม่มีจริงในไฟล์: [${missingFromFile.slice(0, 3).join(", ")}${missingFromFile.length > 3 ? "..." : ""}] — ต้องรัน npm run sync เพื่ออัปเดต`,
      };
    }
  }

  // Deprecated modules are intentionally disconnected — not an error
  if (registryData?.deprecated === true) {
    return { status: "OK" };
  }

  // Entry points (API routes, pages, scripts, tests) are OK without being imported
  if (!isImported && (isEntryPoint(filePath) || registryData?.entry_point === true)) {
    return { status: "OK" };
  }

  if (!isImported) {
    const callers: string[] = registryData?.declared_callers ?? [];
    if (callers.length > 0) {
      // Declared a caller but that caller doesn't actually import this → connection is missing
      return {
        status: "BROKEN",
        error_th: `ประกาศ declared_callers: [${callers.slice(0, 2).join(", ")}${callers.length > 2 ? "…" : ""}] แต่ไม่พบ import จริง — ต้องเพิ่ม import ใน caller file`,
      };
    }
    return {
      status: "UNUSED",
      error_th: `ไม่มีใครเรียกใช้ และไม่มี declared_callers — เพิ่ม declared_callers ใน module-registry.json หรือตั้ง entry_point: true`,
    };
  }

  return { status: "OK" };
}

// ── Main ───────────────────────────────────────────

async function buildArchBook() {
  const moduleReg = load("module-registry.json");
  const archReg = load("architecture.json");

  const nodes: ArchNode[] = [];
  const edges: ArchEdge[] = [];

  // Build import graph from source
  const allFiles = await glob("**/*.ts", {
    cwd: ROOT,
    ignore: ["node_modules/**", ".next/**", "**/*.d.ts"],
  });

  const importedBy: Map<string, Set<string>> = new Map();
  const importEdges: Array<{ from: string; to: string }> = [];

  for (const file of allFiles) {
    const absPath = join(ROOT, file);
    const imports = extractImportsFromFile(absPath);
    for (const imp of imports) {
      let resolvedBase: string | null = null;
      if (imp.startsWith("@/")) {
        resolvedBase = imp.replace("@/", "");
      } else if (imp.startsWith("./") || imp.startsWith("../")) {
        const fileDir = file.substring(0, file.lastIndexOf("/"));
        resolvedBase = join(fileDir, imp);
      }
      if (!resolvedBase) continue;

      // Try direct .ts, then /index.ts fallback (directory import pattern)
      let target = resolvedBase.endsWith(".ts") ? resolvedBase : `${resolvedBase}.ts`;
      if (!existsSync(join(ROOT, target))) {
        const indexTarget = resolvedBase.replace(/\.ts$/, "") + "/index.ts";
        if (existsSync(join(ROOT, indexTarget))) target = indexTarget;
      }
      if (!importedBy.has(target)) importedBy.set(target, new Set());
      importedBy.get(target)!.add(file);
      importEdges.push({ from: file, to: target });
    }
  }

  // Build edges from import graph
  for (const { from, to } of importEdges) {
    edges.push({
      source: `module:${from}`,
      target: `module:${to}`,
      label: "imports",
    });
  }

  // Layer nodes from architecture.json
  const layers = archReg.layers ?? {};
  for (const [layerId, layerData] of Object.entries(layers) as [string, any][]) {
    nodes.push({
      id: `layer:${layerId}`,
      type: "Layer",
      layer: layerId,
      name_en: layerId,
      purpose_th: layerData.purpose ?? layerId,
      exports: [],
      status: "OK",
    });
  }

  // Module nodes from module-registry.json
  const modules = moduleReg.modules ?? {};
  for (const [filePath, data] of Object.entries(modules) as [string, any][]) {
    const isImported = importedBy.has(filePath) && importedBy.get(filePath)!.size > 0;
    const registeredExports: string[] = data.exports ?? [];

    const { status, error_th } = data.status === "stale"
      ? { status: "BROKEN" as const, error_th: `ไม่พบไฟล์จริง: ${filePath} — ลงทะเบียนไว้แต่ไฟล์หายไปจาก Source Code` }
      : data.status === "unregistered"
      ? { status: "UNREGISTERED" as const, error_th: `ตรวจพบไฟล์ใหม่ที่ยังไม่ได้ลงทะเบียนอย่างเป็นทางการ — กรุณาเพิ่ม purpose_th ใน module-registry.json` }
      : calcStatus(filePath, registeredExports, isImported, data);

    const layerId = data.layer ?? filePath.split("/")[1] ?? "unknown";

    const node: ArchNode = {
      id: `module:${filePath}`,
      type: "Module",
      layer: layerId,
      name_en: filePath,
      purpose_th: data.purpose_th ?? data.purpose ?? filePath,
      exports: registeredExports,
      status,
    };
    if (error_th) node.error_th = error_th;
    nodes.push(node);

    // layer → module edge
    edges.push({
      source: `layer:${layerId}`,
      target: `module:${filePath}`,
      label: "contains",
    });
  }

  // Summary
  const moduleNodes = nodes.filter((n) => n.type === "Module");
  const summary = {
    total: moduleNodes.length,
    ok: moduleNodes.filter((n) => n.status === "OK").length,
    broken: moduleNodes.filter((n) => n.status === "BROKEN").length,
    unused: moduleNodes.filter((n) => n.status === "UNUSED").length,
    unregistered: moduleNodes.filter((n) => n.status === "UNREGISTERED").length,
  };

  const book: ArchitectureBook = {
    generated_at: new Date().toISOString(),
    version: 1,
    nodes,
    edges,
    summary,
  };

  const outPath = join(REGISTRY, "architecture-book.json");
  writeFileSync(outPath, JSON.stringify(book, null, 2) + "\n", "utf-8");

  console.log(`\nArchitecture Book สร้างเสร็จ`);
  console.log(`  Total: ${summary.total} modules`);
  console.log(`  OK: ${summary.ok}`);
  console.log(`  Broken: ${summary.broken}`);
  console.log(`  Unused: ${summary.unused}`);
  console.log(`  Unregistered: ${summary.unregistered}`);
  console.log(`  → ${outPath}`);
}

buildArchBook().catch((e) => {
  console.error("[build-arch-book] Error:", e);
  process.exit(1);
});
