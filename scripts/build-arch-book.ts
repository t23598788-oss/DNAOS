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
import * as ts from "typescript";

const ROOT = join(__dirname, "..");
const REGISTRY = join(ROOT, "registry");

// ── Types ──────────────────────────────────────────

// Symbol/line-range traceability (extension of the existing exports:string[]
// field, not a replacement — Rule 101/103: extend, don't duplicate). Computed
// via the real TypeScript AST (ts.createSourceFile), not regex, since line
// ranges need real node positions.
export interface ArchSymbol {
  name: string;
  kind: "function" | "class" | "const" | "interface" | "type" | "enum" | "default";
  line_start: number;
  line_end: number;
}

// Import-site line traceability — which line each import statement is on in
// the source file, resolved to the same target-file id used by ArchEdge so
// a symbol/import can be traced back to the exact edge it produced.
export interface ArchImportSite {
  specifier: string;
  line: number;
  resolved_target: string | null;
}

export interface ArchNode {
  id: string;
  type: "Module" | "Layer" | "API" | "Database" | "Command" | "Workflow";
  layer: string;
  name_en: string;
  purpose_th: string;
  exports: string[];
  status: "OK" | "BROKEN" | "UNUSED" | "UNREGISTERED";
  error_th?: string;
  symbols?: ArchSymbol[];
  import_sites?: ArchImportSite[];
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

// KM-001 (registry/existence.json known_mistakes): this duplicates scripts/sync-registry.ts's
// extractExports. Both independently had the same .tsx-blindness bug class 3 times this session —
// check that file too when fixing a parsing bug here.
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
    /export\s+default\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+default\s+(?:abstract\s+)?class\s+(\w+)/g,
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
  // bare `export default <expr>` (anonymous, or a named one already captured above)
  if (exports.length === 0 && /export\s+default\b/.test(content)) {
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

// ── Symbol / Line-Range Extraction (real TS AST) ────
//
// Additive only — does not feed calcStatus or the existing import/export
// regex logic above, so it cannot change any existing OK/BROKEN/UNUSED
// verdict. Purely new fields (ArchSymbol[]/ArchImportSite[]) per Rule 101/103.

function symbolKindOf(node: ts.Node): ArchSymbol["kind"] | null {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isVariableStatement(node)) return "const";
  return null;
}

function hasExportModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function extractSymbols(absPath: string): ArchSymbol[] {
  if (!existsSync(absPath)) return [];
  const content = readFileSync(absPath, "utf-8");
  const sf = ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true, absPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const symbols: ArchSymbol[] = [];

  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt)) {
      symbols.push({ name: "default", kind: "default", line_start: lineOf(stmt.getStart(sf)), line_end: lineOf(stmt.getEnd()) });
      continue;
    }
    if (!hasExportModifier(stmt)) continue;
    const kind = symbolKindOf(stmt);
    if (!kind) continue;

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          symbols.push({ name: decl.name.text, kind: "const", line_start: lineOf(stmt.getStart(sf)), line_end: lineOf(stmt.getEnd()) });
        }
      }
      continue;
    }

    const name = (stmt as unknown as ts.NamedDeclaration).name;
    const symName = name && ts.isIdentifier(name) ? name.text : "default";
    symbols.push({ name: symName, kind, line_start: lineOf(stmt.getStart(sf)), line_end: lineOf(stmt.getEnd()) });
  }

  return symbols;
}

function extractImportSites(absPath: string, resolver: (specifier: string) => string | null): ArchImportSite[] {
  if (!existsSync(absPath)) return [];
  const content = readFileSync(absPath, "utf-8");
  const sf = ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true, absPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sites: ArchImportSite[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const specifier = stmt.moduleSpecifier.text;
    if (!(specifier.startsWith("@/") || specifier.startsWith("./") || specifier.startsWith("../"))) continue;
    const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
    sites.push({ specifier, line, resolved_target: resolver(specifier) });
  }
  return sites;
}

// ── Status Calculator ──────────────────────────────

// Entry point patterns that are valid without being imported
const ENTRY_POINT_PATTERNS = [
  /^app\/.+\/route\.(ts|tsx)$/,              // Next.js route handlers — any path under app/, not just app/api/ (e.g. app/observer.json/route.ts)
  /^app\/(layout|page|error|loading)\.(tsx|ts)$/, // Next.js root files
  /^app\/.+\/(layout|page|error|loading)\.(tsx|ts)$/, // Next.js page files
  /^scripts\/.+\.ts$/,                       // CLI scripts
  /^next\.config\.(ts|js)$/,                 // Next.js config
  /^supabase\/functions\/.+\/index\.ts$/,    // Supabase edge function entry
  /^middleware\.ts$/,                        // Next.js middleware — framework-auto-loaded, never explicitly imported
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

  // Deprecated modules are intentionally disconnected — not an error, UNLESS they've
  // regained a real importer, which contradicts their own deprecated status (Rule 100 /
  // KM-002, registry/existence.json known_mistakes.confirmed_duplicate_pairs). That's
  // either a mistake (someone built on the deprecated side without checking) or a real
  // un-deprecation that should update module-registry.json's deprecated field on purpose,
  // not drift silently — same enforcement source scripts/check-imports.sh reads.
  if (registryData?.deprecated === true) {
    if (isImported) {
      return {
        status: "BROKEN",
        error_th: `Module ถูก mark deprecated:true แต่กลับมีคนเรียกใช้จริง (Rule 100 / KM-002) — ถ้าตั้งใจ un-deprecate ต้องอัปเดต module-registry.json deprecated field และ registry/existence.json confirmed_duplicate_pairs พร้อมกัน ห้าม drift เงียบ ๆ`,
      };
    }
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

    // Rule 104 (Nothing Is Wasted, CONST-104, DNA-000037/038): an unused module
    // is only excused from UNUSED if its knowledge has actually been extracted
    // first — archival_status:"ARCHIVED" alone is not enough; the referenced
    // entry in registry/existence.json#archived_knowledge must really exist,
    // so this can't be satisfied by setting a flag without doing the work.
    if (registryData?.archival_status === "ARCHIVED") {
      const ref: string = registryData?.archived_knowledge_ref ?? "";
      const idMatch = ref.match(/\[([A-Z]+-\d+)\]/);
      const archiveId = idMatch?.[1];
      const existence = load("existence.json");
      const entries: any[] = existence.archived_knowledge?.entries ?? [];
      const found = archiveId ? entries.find((e) => e.id === archiveId) : undefined;
      if (found) {
        return { status: "OK" };
      }
      return {
        status: "BROKEN",
        error_th: `archival_status: "ARCHIVED" แต่ archived_knowledge_ref ("${ref}") ไม่พบ entry จริงใน registry/existence.json#archived_knowledge (Rule 104) — ห้าม mark ARCHIVED โดยไม่มีความรู้ที่สกัดออกมาจริง`,
      };
    }

    return {
      status: "UNUSED",
      error_th: `ไม่มีใครเรียกใช้ และไม่มี declared_callers — เพิ่ม declared_callers ใน module-registry.json หรือตั้ง entry_point: true (หรือถ้าจะ archive ตาม Rule 104 ต้องสกัดความรู้ก่อน แล้วตั้ง archival_status: "ARCHIVED" พร้อม archived_knowledge_ref ที่ชี้ไป entry จริง)`,
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
  const allFiles = await glob("**/*.{ts,tsx}", {
    cwd: ROOT,
    ignore: ["node_modules/**", ".next/**", "**/*.d.ts"],
  });

  const importedBy: Map<string, Set<string>> = new Map();
  const importEdges: Array<{ from: string; to: string }> = [];
  const importSitesByFile: Map<string, ArchImportSite[]> = new Map();
  const symbolsByFile: Map<string, ArchSymbol[]> = new Map();

  // Same specifier→file resolution rule used for the import graph, extracted
  // so extractImportSites() (real line numbers) can resolve to the identical
  // target id as importEdges below — one resolution rule, not two.
  function resolveSpecifier(file: string, imp: string): string | null {
    let resolvedBase: string | null = null;
    if (imp.startsWith("@/")) {
      resolvedBase = imp.replace("@/", "");
    } else if (imp.startsWith("./") || imp.startsWith("../")) {
      const fileDir = file.substring(0, file.lastIndexOf("/"));
      resolvedBase = join(fileDir, imp);
    }
    if (!resolvedBase) return null;

    // Try direct .ts, then .tsx, then /index.ts fallback (directory import
    // pattern). Previously always appended .ts even when the real target
    // was .tsx (e.g. @/components/documents/DocumentBuilder) — every such
    // import silently resolved to a nonexistent path and never counted,
    // which is why real, actively-imported .tsx components were showing
    // up as UNUSED.
    let target = resolvedBase.endsWith(".ts") || resolvedBase.endsWith(".tsx") ? resolvedBase : `${resolvedBase}.ts`;
    if (!existsSync(join(ROOT, target))) {
      const tsxTarget = resolvedBase.replace(/\.tsx?$/, "") + ".tsx";
      if (existsSync(join(ROOT, tsxTarget))) {
        target = tsxTarget;
      } else {
        const indexTsTarget = resolvedBase.replace(/\.tsx?$/, "") + "/index.ts";
        const indexTsxTarget = resolvedBase.replace(/\.tsx?$/, "") + "/index.tsx";
        if (existsSync(join(ROOT, indexTsTarget))) target = indexTsTarget;
        else if (existsSync(join(ROOT, indexTsxTarget))) target = indexTsxTarget;
      }
    }
    return target;
  }

  for (const file of allFiles) {
    const absPath = join(ROOT, file);
    const imports = extractImportsFromFile(absPath);
    for (const imp of imports) {
      const target = resolveSpecifier(file, imp);
      if (!target) continue;
      if (!importedBy.has(target)) importedBy.set(target, new Set());
      importedBy.get(target)!.add(file);
      importEdges.push({ from: file, to: target });
    }
    symbolsByFile.set(file, extractSymbols(absPath));
    importSitesByFile.set(file, extractImportSites(absPath, (spec) => resolveSpecifier(file, spec)));
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
    const symbols = symbolsByFile.get(filePath);
    if (symbols && symbols.length > 0) node.symbols = symbols;
    const importSites = importSitesByFile.get(filePath);
    if (importSites && importSites.length > 0) node.import_sites = importSites;
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
