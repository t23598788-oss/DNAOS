import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

interface ArchNode {
  id: string;
  type: string;
  layer: string;
  name_en: string;
  purpose_th: string;
  exports: string[];
  status: "OK" | "BROKEN" | "UNUSED" | "UNREGISTERED";
  error_th?: string;
}

interface ArchitectureBook {
  generated_at: string;
  version: number;
  nodes: ArchNode[];
  edges: { source: string; target: string; label: string }[];
  summary: { total: number; ok: number; broken: number; unused: number; unregistered: number };
}

const BOOK_PATH = join(process.cwd(), "lib/registry/architecture-book.json");

function readBook(): ArchitectureBook | null {
  if (!existsSync(BOOK_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BOOK_PATH, "utf-8"));
  } catch {
    return null;
  }
}

// GET /api/governance
// GET /api/governance?node=module:lib/... — node เดียว + importers + imports
// GET /api/governance?layer=v3-engines — filter by layer
export async function GET(req: Request) {
  const url = new URL(req.url);
  const nodeId = url.searchParams.get("node");
  const layer  = url.searchParams.get("layer");

  const book = readBook();
  if (!book) {
    return NextResponse.json(
      { error_th: "ยังไม่มีข้อมูลสถาปัตยกรรม — กรุณารัน npm run sync ก่อน", hint: "npm run sync" },
      { status: 503 }
    );
  }

  // ── Single node + dependency query ──
  if (nodeId) {
    const node = book.nodes.find((n) => n.id === nodeId);
    if (!node) {
      return NextResponse.json({ error_th: `ไม่พบ node: ${nodeId}` }, { status: 404 });
    }
    const imports = book.edges
      .filter((e) => e.source === nodeId && e.label === "imports")
      .map((e) => book.nodes.find((n) => n.id === e.target))
      .filter(Boolean) as ArchNode[];
    const importedBy = book.edges
      .filter((e) => e.target === nodeId && e.label === "imports")
      .map((e) => book.nodes.find((n) => n.id === e.source))
      .filter(Boolean) as ArchNode[];

    // impact: ใคร import โมดูลนี้ (ทั้งทางตรงและทางอ้อม) ถ้า status !== OK
    const impact: ArchNode[] = node.status !== "OK" ? importedBy : [];

    return NextResponse.json({ node, imports, importedBy, impact });
  }

  // ── Layer filter ──
  if (layer) {
    const nodes = book.nodes.filter((n) => n.type === "Module" && n.layer === layer);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = book.edges.filter(
      (e) => nodeIds.has(e.source) || nodeIds.has(e.target)
    );
    return NextResponse.json({ layer, nodes, edges });
  }

  // ── Full book ──
  const violations = book.nodes.filter(
    (n) => n.status === "BROKEN" || n.status === "UNUSED" || n.status === "UNREGISTERED"
  );
  return NextResponse.json({
    ...book,
    violations,
    health: book.summary.total > 0
      ? Math.round((book.summary.ok / book.summary.total) * 100)
      : 0,
  });
}
