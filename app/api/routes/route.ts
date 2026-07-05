import { NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();
const API_ROOT = join(ROOT, "app/api");
const API_REGISTRY_PATH = join(ROOT, "04-api-registry.json");

// โหลด purpose จาก api-registry.json (ถ้ามี)
function loadApiRegistry(): Record<string, { purpose?: string; purpose_th?: string; method?: string; auth_required?: boolean }> {
  try {
    const raw = readFileSync(API_REGISTRY_PATH, "utf-8");
    return JSON.parse(raw).endpoints ?? {};
  } catch {
    return {};
  }
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;

function extractMethods(content: string): string[] {
  return HTTP_METHODS.filter((m) =>
    new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(content) ||
    new RegExp(`export\\s+function\\s+${m}\\b`).test(content)
  );
}

function extractDocComment(content: string, method: string): string | null {
  // ดึง comment ก่อน export function METHOD
  const re = new RegExp(`\\/\\/[^\\n]*\\n[^\\n]*export\\s+async\\s+function\\s+${method}`, "m");
  const m = content.match(re);
  if (m) return m[0].split("\n")[0].replace(/^\/\/\s*/, "").trim();
  return null;
}

function routeFileToPath(absPath: string): string {
  // app/api/foo/bar/route.ts → /api/foo/bar
  const rel = relative(join(ROOT, "app"), absPath);
  return "/" + rel.replace(/\/route\.ts$/, "").replace(/\\/g, "/");
}

function scanRoutes(dir: string, results: any[]) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanRoutes(abs, results);
    } else if (entry.name === "route.ts" && entry.isFile()) {
      const content = readFileSync(abs, "utf-8");
      const methods = extractMethods(content);
      const path = routeFileToPath(abs);
      for (const method of methods) {
        results.push({ method, path, doc: extractDocComment(content, method) });
      }
    }
  }
}

// GET /api/routes — รายการ route จริงจาก Source Code + purpose จาก api-registry.json
export async function GET() {
  const registry = loadApiRegistry();
  const raw: { method: string; path: string; doc: string | null }[] = [];
  scanRoutes(API_ROOT, raw);

  const routes = raw.map((r) => {
    const regKey = r.path;
    const reg = registry[regKey];
    return {
      method: r.method,
      path: r.path,
      purpose_th: reg?.purpose_th ?? reg?.purpose ?? r.doc ?? null,
      auth_required: reg?.auth_required ?? null,
      source: `app${r.path}/route.ts`,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));

  return NextResponse.json({ routes, total: routes.length });
}
