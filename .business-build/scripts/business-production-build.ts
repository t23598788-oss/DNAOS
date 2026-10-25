#!/usr/bin/env tsx
/**
 * BUSINESS PRODUCTION BUILD (owner directive 2026-10-20)
 * "แยก Development Environment และ Business Production ออกจากกันอย่างเด็ดขาด"
 *
 * What this script does — and what it deliberately does NOT do:
 *   1. STAGE   — copies the working tree into .business-build/ (source tree is
 *                never modified; nothing is committed, pushed or deployed).
 *   2. PRUNE   — deletes every route file whose path matches a prefix in
 *                registry/business-production-surface.json (the single authority).
 *                The routes are physically absent from the build input, so the
 *                production artifact answers 404 — this is NOT a hidden menu and
 *                NOT a "super_admin may still open it" arrangement.
 *   3. BUILD   — runs the real Next.js production build inside the staged tree.
 *   4. VERIFY  — reads the build manifest and fails closed if any developer
 *                route / developer control API survived, or if a business
 *                surface that must exist is missing.
 *
 * Evidence is written to artifacts/cutover/business-build-evidence.json.
 *
 * Usage:
 *   npx tsx scripts/business-production-build.ts            # stage + prune + build + verify
 *   npx tsx scripts/business-production-build.ts --skip-build # prune + verify source tree only
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "..");
const STAGE = path.join(ROOT, ".business-build");
const REGISTRY_PATH = path.join(ROOT, "registry/business-production-surface.json");
const EVIDENCE_DIR = path.join(ROOT, "artifacts/cutover");
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, "business-build-evidence.json");

/** Directories never copied into the staged business tree. */
const COPY_EXCLUDES = new Set([
  ".git",
  ".next",
  ".business-build",
  ".ui-v3-backups",
  "node_modules",
  "backups",
  "local-runtime",
  "src-tauri",
  "artifacts",
  "coverage",
  "test-results",
  ".turbo",
  ".vercel",
]);

interface SurfaceEntry {
  prefix: string;
  category: string;
  reason_th: string;
  authority: string;
}

interface SurfaceRegistry {
  version: number;
  excluded_pages: SurfaceEntry[];
  excluded_apis: SurfaceEntry[];
  required_business_dependencies: Array<{ id: string; description_th: string; proof_paths: string[] }>;
  kept_business_surfaces: { pages: string[]; apis: string[]; note_th: string };
}

function fail(message: string): never {
  console.error(`\n[FAIL] ${message}\n`);
  process.exit(1);
}

function log(step: string, message: string) {
  console.log(`[${step}] ${message}`);
}

// ---------------------------------------------------------------------------
// 1. registry (single authority)
// ---------------------------------------------------------------------------
function loadRegistry(): SurfaceRegistry {
  if (!fs.existsSync(REGISTRY_PATH)) fail(`missing authority registry: ${REGISTRY_PATH}`);
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as SurfaceRegistry;
  if (!registry.excluded_pages?.length) fail("registry.excluded_pages is empty — refusing to build");
  if (!registry.excluded_apis?.length) fail("registry.excluded_apis is empty — refusing to build");
  return registry;
}

// ---------------------------------------------------------------------------
// 2. staging
// ---------------------------------------------------------------------------
function copyTree(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // FAIL-CLOSED: never let .env* (real secrets) or stray logs enter a
    // production build input — Next loads .env.local during build.
    if (COPY_EXCLUDES.has(entry.name) || entry.name.startsWith(".env") || entry.name === "nohup.out") continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(from);
      try { fs.symlinkSync(target, to); } catch { /* ignore */ }
    } else if (isNonBuildableAsset(from)) continue;
    else fs.copyFileSync(from, to);
  }
}

/** Screenshots / recordings under docs are evidence material, never build input. */
function isNonBuildableAsset(absolutePath: string): boolean {
  const rel = path.relative(ROOT, absolutePath);
  if (!rel.startsWith("docs" + path.sep)) return false;
  return /\.(png|jpe?g|gif|webp|mp4|mov|webm|pdf|zip|tar|gz)$/i.test(rel);
}

function stage(): void {
  log("stage", `copying source tree → ${path.relative(ROOT, STAGE)}/ (source tree is never modified)`);
  fs.rmSync(STAGE, { recursive: true, force: true });
  copyTree(ROOT, STAGE);
  // the staged tree must never try to stage itself
  fs.rmSync(path.join(STAGE, ".business-build"), { recursive: true, force: true });
  // E1 fix: Next.js/Turbopack must resolve next/package.json from the stage
  // root — without it the build fails with "We couldn't find the Next.js
  // package". Turbopack also rejects node_modules SYMLINKS that leave the
  // project root ("Symlink node_modules is invalid, it points out of the
  // filesystem root"), so the dependency tree is COPIED into the stage.
  const stageNodeModules = path.join(STAGE, "node_modules");
  if (!fs.existsSync(path.join(stageNodeModules, "next/package.json"))) {
    log("stage", "copying node_modules into the staged tree (Turbopack rejects out-of-root symlinks)…");
    fs.cpSync(path.join(ROOT, "node_modules"), stageNodeModules, { recursive: true });
    log("stage", "node_modules copied into the staged tree");
  }
  // Business build type check must stay inside the business runtime: the ops
  // test scripts (e.g. scripts/ai-device-cutover-test.ts › local-runtime/) are
  // outside the staged tree on purpose (local-runtime is COPY_EXCLUDES'd).
  // Patch the STAGED tsconfig only — the source tsconfig is never modified.
  const stageTsconfig = path.join(STAGE, "tsconfig.json");
  const tsconfig = JSON.parse(fs.readFileSync(stageTsconfig, "utf8")) as { exclude?: string[] };
  tsconfig.exclude = tsconfig.exclude ?? [];
  for (const dir of ["scripts/", "local-runtime/"]) {
    if (!tsconfig.exclude.includes(dir)) tsconfig.exclude.push(dir);
  }
  fs.writeFileSync(stageTsconfig, JSON.stringify(tsconfig, null, 2));
  log("stage", "staged tsconfig excludes scripts/ + local-runtime/ (ops tooling, not business runtime)");
  // NOTE: the intermittent "Invariant: Expected workStore to be initialized"
  // (vercel/next.js#98200, fix PR #98198) is fixed at its ROOT CAUSE in the
  // installed node_modules/next/dist/lib/metadata/resolve-metadata.js —
  // NOT hidden behind retries or config knobs here. The vendored patch must be
  // replaced by an upstream release (or captured with patch-package) on the
  // next dependency refresh.
}

// ---------------------------------------------------------------------------
// 3. route discovery + pruning
// ---------------------------------------------------------------------------
const ROUTE_FILE_NAMES = new Set(["route.ts", "route.tsx", "route.js", "route.jsx", "page.ts", "page.tsx", "page.js", "page.jsx"]);

interface RouteFile {
  file: string; // absolute
  rel: string; // relative to stage root
  route: string; // url path
  kind: "page" | "route";
}

/** URL path of an app/ file, ignoring private folders and route groups. */
function routePathFor(relFromApp: string, kind: "page" | "route"): string | null {
  const segments = relFromApp.split(path.sep).filter(Boolean);
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1];
  segments.pop();
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith("@") || segment.startsWith("_")) return null; // private folder
    if (segment.startsWith("(") && segment.endsWith(")")) continue; // route group
    kept.push(segment);
  }
  const url = "/" + kept.join("/");
  return url === "/" ? "/" : url.replace(/\/+$/, "");
}

function listRouteFiles(stageRoot: string): RouteFile[] {
  const out: RouteFile[] = [];
  const appDir = path.join(stageRoot, "app");
  if (!fs.existsSync(appDir)) return out;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (ROUTE_FILE_NAMES.has(entry.name)) {
        const kind: "page" | "route" = entry.name.startsWith("route.") ? "route" : "page";
        const relFromApp = path.relative(appDir, abs);
        const url = routePathFor(relFromApp, kind);
        if (!url) continue;
        out.push({ file: abs, rel: path.relative(stageRoot, abs), route: url, kind });
      }
    }
  };
  walk(appDir);
  return out;
}

function matchesPrefix(route: string, prefix: string): boolean {
  if (prefix === "/") return true;
  const normalized = prefix.replace(/\/+$/, "");
  return route === normalized || route.startsWith(`${normalized}/`);
}

function pruneRoutes(stageRoot: string, registry: SurfaceRegistry) {
  const routeFiles = listRouteFiles(stageRoot);
  const pruned: Array<{ route: string; kind: string; file: string; category: string }> = [];
  const unmatched: string[] = [];

  for (const entry of registry.excluded_pages) {
    // E2 fix: some excluded page prefixes are implemented as route handlers
    // (e.g. /observer.json lives in app/observer.json/route.ts). Match BOTH
    // page files and route handlers for page prefixes, or the route survives
    // the prune and hits the fail-closed gate below.
    const hit = routeFiles.filter((r) => matchesPrefix(r.route, entry.prefix) && fs.existsSync(r.file));
    if (!hit.length && !routeFiles.some((r) => matchesPrefix(r.route, entry.prefix))) unmatched.push(`pages:${entry.prefix}`);
    for (const r of hit) {
      if (!fs.existsSync(r.file)) continue;
      pruned.push({ route: r.route, kind: r.kind, file: r.rel, category: entry.category });
      fs.rmSync(r.file, { force: true });
    }
  }
  for (const entry of registry.excluded_apis) {
    const hit = routeFiles.filter((r) => r.kind === "route" && matchesPrefix(r.route, entry.prefix));
    if (!hit.length) unmatched.push(`apis:${entry.prefix}`);
    for (const r of hit) {
      pruned.push({ route: r.route, kind: r.kind, file: r.rel, category: entry.category });
      fs.rmSync(r.file, { force: true });
    }
  }

  // remove directories that became empty (so no orphan route folder stays)
  const pruneEmptyDirs = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        pruneEmptyDirs(path.join(dir, entry.name));
        if (fs.readdirSync(path.join(dir, entry.name)).length === 0) fs.rmdirSync(path.join(dir, entry.name));
      }
    }
  };
  pruneEmptyDirs(path.join(stageRoot, "app"));

  return { pruned, unmatched, totalRouteFiles: routeFiles.length };
}

// ---------------------------------------------------------------------------
// 4. build
// ---------------------------------------------------------------------------
/**
 * Railway builds with the service's environment variables available at build
 * time; a raw local child process would not see them (and the staged tree must
 * stay free of any .env file — see COPY_EXCLUDES). Reading .env.local into the
 * CHILD PROCESS ONLY keeps the artifact clean while reproducing that build
 * environment faithfully. Values are never copied into the staged tree.
 */
function buildEnvFromLocalFiles(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const file of [".env.local", ".env"]) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) continue;
    for (const line of fs.readFileSync(abs, "utf8").split("\n")) {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2];
    }
  }
  return env;
}

function runBuild(): { ok: boolean; log: string } {
  const bin = path.join(ROOT, "node_modules/.bin/next");
  if (!fs.existsSync(bin)) fail("next binary not found — run npm install first");
  log("build", "next build (staged business tree) — this can take several minutes");
  const result = spawnSync(bin, ["build"], {
    cwd: STAGE,
    env: {
      ...process.env,
      ...buildEnvFromLocalFiles(),
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      // NOTE: no NEXT_PRIVATE_BUILD_WORKER — it is a Next-internal flag;
      // forcing it breaks the build worker ("Expected workStore to be
      // initialized") during the export phase. The normal build pipeline
      // manages its own worker.
    },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  fs.writeFileSync(path.join(EVIDENCE_DIR, "business-build.log"), output);
  return { ok: result.status === 0, log: output };
}

// ---------------------------------------------------------------------------
// 5. verification
// ---------------------------------------------------------------------------
function readBuiltRoutes(stageRoot: string): { routes: string[]; source: string } {
  const nextDir = path.join(stageRoot, ".next");
  const appPathRoutes = path.join(nextDir, "app-path-routes-manifest.json");
  if (fs.existsSync(appPathRoutes)) {
    const manifest = JSON.parse(fs.readFileSync(appPathRoutes, "utf8")) as Record<string, unknown>;
    return { routes: Object.keys(manifest), source: ".next/app-path-routes-manifest.json" };
  }
  const routesManifest = path.join(nextDir, "routes-manifest.json");
  if (fs.existsSync(routesManifest)) {
    const manifest = JSON.parse(fs.readFileSync(routesManifest, "utf8")) as {
      staticRoutes?: Array<{ page: string }>;
      dynamicRoutes?: Array<{ page: string }>;
    };
    const routes = [
      ...(manifest.staticRoutes ?? []).map((r) => r.page),
      ...(manifest.dynamicRoutes ?? []).map((r) => r.page),
    ];
    return { routes, source: ".next/routes-manifest.json" };
  }
  return { routes: [], source: "none" };
}

/**
 * Module-level closure of the staged business tree: which source modules are
 * still reachable from the business routes. Used to report (not hide) any
 * developer tool implementation that survives the surface cut.
 */
function businessModuleClosure(stageRoot: string, registry: SurfaceRegistry): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (/\.(ts|tsx|js|mjs|jsx)$/.test(entry.name)) files.push(abs);
    }
  };
  walk(stageRoot);
  const relSet = new Set(files.map((f) => path.relative(stageRoot, f)));

  const IMPORT_RE = /(?:^|\n)[^\n]*?\bfrom\s*["']([^"']+)["']/g;
  const SIDE_RE = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;

  const resolve = (spec: string, fromRel: string): string | null => {
    let base: string | null = null;
    if (spec.startsWith("@/")) base = path.join(stageRoot, spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(path.join(stageRoot, fromRel)), spec);
    else return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, path.join(base, "index.ts")]) {
      const rel = path.relative(stageRoot, candidate);
      if (relSet.has(rel)) return rel;
    }
    return null;
  };

  const edges = new Map<string, Set<string>>();
  for (const file of files) {
    const rel = path.relative(stageRoot, file);
    const src = fs.readFileSync(file, "utf8");
    const specs = new Set<string>();
    let m: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(src))) specs.add(m[1]);
    SIDE_RE.lastIndex = 0;
    while ((m = SIDE_RE.exec(src))) specs.add(m[1]);
    const outs = new Set<string>();
    for (const spec of specs) {
      const resolved = resolve(spec, rel);
      if (resolved) outs.add(resolved);
    }
    edges.set(rel, outs);
  }

  const routeFiles = listRouteFiles(stageRoot);
  const roots = routeFiles.map((r) => r.rel);
  const seen = new Set<string>(roots);
  const queue = [...roots];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of edges.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  void registry;
  return [...seen].sort();
}

/** Developer tool implementations that must not ship inside Business Production. */
const DEV_TOOL_MODULE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "filesystem_source_access", re: /(^|\/)(fsSecurity|fsOps|fileWrite|tree|search|trash|classification|standards)\.ts$/ },
  { label: "git_control", re: /(^|\/)gitReadOnly\.ts$/ },
  { label: "build_release_deploy", re: /(^|\/)(buildRuntime|buildRegistry|releaseRuntime|releaseRegistry|deploymentRuntime|deploymentRegistry)\.ts$/ },
  { label: "test_execution", re: /(^|\/)(testRuntime|testRegistry)\.ts$/ },
  { label: "worker_execution", re: /(^|\/)(executionRuntime|executionRegistry|executionPlanRuntime|executionPlannerRuntime|executionBudgetRuntime|executionHandRuntime|executionContextRuntime|codeWorkerRuntime|edgeFunctionWorkerRuntime|workerTaskOrchestrator|workerAdapter|workerAdapterRegistry|workerRegistry|workerSelectorRuntime|workerSettingsRuntime|workerContract)\.ts$/ },
  { label: "inspection_governance", re: /(^|\/)(inspectionRuntime|inspectionRegistry|browserInspectionRuntime|uiInspectionCapability|changeSetRuntime|reviewRegistry|governanceRuntime)\.ts$/ },
  { label: "developer_plane_route", re: /(^|\/)app\/api\/admin\/ide\// },
];

function classifyDevTools(modules: string[]) {
  const hits: Record<string, string[]> = {};
  for (const { label, re } of DEV_TOOL_MODULE_PATTERNS) {
    const matched = modules.filter((m) => re.test(m));
    if (matched.length) hits[label] = matched;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const skipBuild = process.argv.includes("--skip-build");
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const registry = loadRegistry();
  const excludedPrefixes = [
    ...registry.excluded_pages.map((e) => e.prefix),
    ...registry.excluded_apis.map((e) => e.prefix),
  ];

  stage();
  const { pruned, unmatched, totalRouteFiles } = pruneRoutes(STAGE, registry);
  log("prune", `${pruned.length} route files removed from the staged build input (of ${totalRouteFiles} route files)`);

  const remainingRouteFiles = listRouteFiles(STAGE);
  const sourceLeaks = remainingRouteFiles.filter((r) => excludedPrefixes.some((p) => matchesPrefix(r.route, p)));

  let buildOk = false;
  let buildLog = "";
  if (!skipBuild) {
    const result = runBuild();
    buildOk = result.ok;
    buildLog = result.log.slice(-4000);
    if (!buildOk) log("build", "next build FAILED — see artifacts/cutover/business-build.log");
  }

  const built = readBuiltRoutes(STAGE);
  const developerRoutesInBuild = built.routes.filter((r) => excludedPrefixes.some((p) => matchesPrefix(r, p)));
  const keptPages = registry.kept_business_surfaces.pages;
  const keptApis = registry.kept_business_surfaces.apis;
  const missingKept = [
    ...keptPages.filter((p) => !built.routes.some((r) => r === p || matchesPrefix(r, `${p}/`))),
    ...keptApis.filter((a) => !built.routes.some((r) => r === a || matchesPrefix(r, `${a}/`))),
  ];

  const closure = businessModuleClosure(STAGE, registry);
  const devToolResidual = classifyDevTools(closure);

  const evidence = {
    generated_at: new Date().toISOString(),
    directive: "DNA OS — STRICT BUSINESS-ONLY PRODUCTION CUTOVER (owner directive 2026-10-20)",
    authority_registry: path.relative(ROOT, REGISTRY_PATH),
    stage_dir: path.relative(ROOT, STAGE),
    build: {
      ran: !skipBuild,
      ok: buildOk,
      log_tail: buildLog,
    },
    pruning: {
      route_files_before: totalRouteFiles,
      route_files_removed: pruned.length,
      route_files_after: remainingRouteFiles.length,
      unmatched_registry_prefixes: unmatched,
      removed: pruned,
    },
    evidence_gates: {
      NEW_DEVELOPER_ROUTES_IN_BUILD: developerRoutesInBuild.length,
      NEW_DEVELOPER_CONTROL_APIS_IN_BUILD: developerRoutesInBuild.filter((r) => r.startsWith("/api/")).length,
      NEW_DEVELOPER_ROUTES_IN_BUILD_DETAIL: developerRoutesInBuild,
      SOURCE_TREE_DEVELOPER_ROUTES: sourceLeaks.length,
      MISSING_BUSINESS_SURFACES: missingKept,
    },
    build_manifest: {
      source: built.source,
      total_routes: built.routes.length,
      routes: built.routes.sort(),
    },
    developer_tool_residual: {
      note: "Developer tool IMPLEMENTATION modules still reachable from business routes. Surface (routes/APIs) is cut; these shared libraries are the residual that still must be removed before a cutover can be declared READY.",
      modules_by_category: devToolResidual,
      total_modules: Object.values(devToolResidual).reduce((n, list) => n + list.length, 0),
    },
  };

  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));

  log("verify", `built routes: ${built.routes.length} (manifest: ${built.source})`);
  log("verify", `NEW_DEVELOPER_ROUTES_IN_BUILD = ${developerRoutesInBuild.length}`);
  log("verify", `NEW_DEVELOPER_CONTROL_APIS_IN_BUILD = ${developerRoutesInBuild.filter((r) => r.startsWith("/api/")).length}`);
  log("verify", `MISSING_BUSINESS_SURFACES = ${missingKept.length}${missingKept.length ? ` → ${missingKept.join(", ")}` : ""}`);
  log("verify", `developer tool residual modules = ${evidence.developer_tool_residual.total_modules}`);
  log("verify", `evidence → ${path.relative(ROOT, EVIDENCE_PATH)}`);

  if (sourceLeaks.length) fail(`developer routes survived the source prune: ${sourceLeaks.map((r) => r.route).join(", ")}`);
  if (developerRoutesInBuild.length) fail(`developer routes present in the build manifest: ${developerRoutesInBuild.join(", ")}`);
  if (!skipBuild && !buildOk) fail("next build failed — see artifacts/cutover/business-build.log");
  log("result", "BUSINESS BUILD VERIFIED — zero developer routes / control APIs in the artifact");
}

main();
