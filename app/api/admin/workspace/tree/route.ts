/**
 * GET /api/admin/workspace/tree?root=<path>&depth=<n>
 * Explorer tool's real data source (Integrated Development Workspace shell,
 * owner, 2026-08-05) — returns a real directory listing via
 * engines/workspace/fileTree.ts. `root` must be one of EXPLORER_ROOTS (or a
 * sub-path under one) — rejects anything else rather than walking the whole
 * disk. No `root` given lists all top-level roots at depth 1.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { buildFileTree, EXPLORER_ROOTS } from "@/engines/workspace/fileTree";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const root = req.nextUrl.searchParams.get("root");
  const depth = Number(req.nextUrl.searchParams.get("depth") ?? "2");

  if (!root) {
    return NextResponse.json({
      roots: EXPLORER_ROOTS.map((r) => ({ name: r, path: r, type: "directory" as const, children: buildFileTree(r, 1) })),
    });
  }

  const isAllowed = EXPLORER_ROOTS.some((r) => root === r || root.startsWith(`${r}/`));
  if (!isAllowed) {
    return NextResponse.json({ error: `root must be one of: ${EXPLORER_ROOTS.join(", ")}` }, { status: 400 });
  }

  try {
    return NextResponse.json({ root, children: buildFileTree(root, Number.isFinite(depth) ? depth : 2) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 404 });
  }
}
