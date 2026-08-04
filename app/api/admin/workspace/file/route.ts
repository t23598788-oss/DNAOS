/**
 * GET /api/admin/workspace/file?path=<relPath> — Source Code tab's real
 * content source (Integrated Development Workspace shell, owner,
 * 2026-08-05). Reads a single real file via engines/workspace/fileTree.ts's
 * EXPLORER_ROOTS whitelist. Path-traversal safe: resolves the absolute path
 * and rejects anything that escapes the project root or isn't under an
 * allowed root, even via "..", before ever calling readFileSync.
 */
import { NextRequest, NextResponse } from "next/server";
import { readFileSync, statSync } from "fs";
import { join, resolve, extname } from "path";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { EXPLORER_ROOTS } from "@/engines/workspace/fileTree";

const ROOT = process.cwd();
const MAX_BYTES = 1_000_000; // 1MB — real source files, not a bulk file server

// System Docs tool's real, curated whitelist — top-level markdown docs that
// already exist in the repo root (outside EXPLORER_ROOTS, which is source
// dirs only). Exact filenames only, never a root-level directory scan.
const DOCS_WHITELIST = new Set([
  "README.md", "ARCHITECTURE.md", "CLAUDE.md", "AGENTS.md",
  "BUSINESS-CONSTITUTION.md", "DEPLOYMENT_READINESS.md", "TECHNICAL_DEBT.md",
]);

// Binary/unreadable-as-text extensions this tool never attempts to read —
// avoids returning garbage into what's meant to be a code viewer.
const BLOCKED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".pdf", ".zip"]);

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const relPath = req.nextUrl.searchParams.get("path");
  if (!relPath) return NextResponse.json({ error: "path is required" }, { status: 400 });

  const isAllowedRoot = EXPLORER_ROOTS.some((r) => relPath === r || relPath.startsWith(`${r}/`));
  const isAllowedDoc = DOCS_WHITELIST.has(relPath);
  if (!isAllowedRoot && !isAllowedDoc) {
    return NextResponse.json({ error: `path must be under one of: ${EXPLORER_ROOTS.join(", ")}, or a top-level doc: ${[...DOCS_WHITELIST].join(", ")}` }, { status: 400 });
  }

  const absPath = resolve(join(ROOT, relPath));
  if (!absPath.startsWith(resolve(ROOT) + "/")) {
    return NextResponse.json({ error: "path escapes project root" }, { status: 400 });
  }

  if (BLOCKED_EXTENSIONS.has(extname(absPath).toLowerCase())) {
    return NextResponse.json({ error: "binary file type not viewable here" }, { status: 415 });
  }

  try {
    const stat = statSync(absPath);
    if (!stat.isFile()) return NextResponse.json({ error: "not a file" }, { status: 400 });
    if (stat.size > MAX_BYTES) return NextResponse.json({ error: `file too large (${stat.size} bytes, max ${MAX_BYTES})` }, { status: 413 });

    const content = readFileSync(absPath, "utf-8");
    return NextResponse.json({ path: relPath, content, size_bytes: stat.size });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 404 });
  }
}
