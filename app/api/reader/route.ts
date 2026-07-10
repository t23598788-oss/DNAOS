import { NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

const ROOT = process.cwd();
const BOOK_PATH = join(ROOT, "registry/architecture-book.json");

// เฉพาะ path ที่อนุญาตให้อ่าน
const ALLOWED_ROOTS = [
  "registry",
  "core",
  "gateway",
  "engines",
  "cognitive",
  "presenter",
  "services",
  "plugins",
  "app/api",
  "scripts",
];

function getNodeDeps(filePath: string): { imports: any[]; importedBy: any[] } {
  if (!existsSync(BOOK_PATH)) return { imports: [], importedBy: [] };
  try {
    const book = JSON.parse(readFileSync(BOOK_PATH, "utf-8"));
    const nodeId = `module:${filePath}`;
    const imports = book.edges
      .filter((e: any) => e.source === nodeId && e.label === "imports")
      .map((e: any) => book.nodes.find((n: any) => n.id === e.target))
      .filter(Boolean);
    const importedBy = book.edges
      .filter((e: any) => e.target === nodeId && e.label === "imports")
      .map((e: any) => book.nodes.find((n: any) => n.id === e.source))
      .filter(Boolean);
    return { imports, importedBy };
  } catch {
    return { imports: [], importedBy: [] };
  }
}

function isAllowed(path: string): boolean {
  const clean = path.replace(/\.\./g, "").replace(/^\//, "");
  return ALLOWED_ROOTS.some((r) => clean.startsWith(r));
}

// GET /api/reader?path=registry/existence.json
export async function GET(req: Request) {
  const url = new URL(req.url);
  const filePath = url.searchParams.get("path");

  // ── รายการไฟล์ทั้งหมดที่อ่านได้ ──
  if (!filePath || filePath === "list") {
    const files: { path: string; type: string; size: number }[] = [];
    for (const root of ALLOWED_ROOTS) {
      const absRoot = join(ROOT, root);
      if (!existsSync(absRoot)) continue;
      collectFiles(absRoot, root, files);
    }
    return NextResponse.json({ files });
  }

  // ── อ่านไฟล์ตาม path ──
  if (!isAllowed(filePath)) {
    return NextResponse.json(
      { error_th: `ไม่อนุญาตให้อ่าน path นี้: ${filePath}` },
      { status: 403 }
    );
  }

  const absPath = join(ROOT, filePath);
  if (!existsSync(absPath)) {
    return NextResponse.json(
      { error_th: `ไม่พบไฟล์: ${filePath}` },
      { status: 404 }
    );
  }

  const stat = statSync(absPath);
  if (stat.isDirectory()) {
    return NextResponse.json(
      { error_th: `${filePath} เป็นโฟลเดอร์ ไม่ใช่ไฟล์` },
      { status: 400 }
    );
  }

  const ext = extname(filePath).toLowerCase();
  const content = readFileSync(absPath, "utf-8");

  let parsed: any = null;
  if (ext === ".json") {
    try { parsed = JSON.parse(content); } catch {}
  }

  const deps = getNodeDeps(filePath);

  return NextResponse.json({
    path: filePath,
    ext,
    size: stat.size,
    modified_at: stat.mtime.toISOString(),
    content,
    parsed,
    imports: deps.imports,
    importedBy: deps.importedBy,
  });
}

function collectFiles(
  dir: string,
  relDir: string,
  out: { path: string; type: string; size: number }[]
) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = join(dir, entry.name);
    const relPath = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      collectFiles(absPath, relPath, out);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if ([".json", ".ts", ".sh"].includes(ext)) {
        const stat = statSync(absPath);
        out.push({ path: relPath, type: ext.slice(1), size: stat.size });
      }
    }
  }
}
