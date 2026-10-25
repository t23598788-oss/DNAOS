/**
 * Workspace File Tree (Integrated Development Workspace shell, owner,
 * 2026-08-05) — real hierarchical directory listing for the Explorer tool.
 * Different job than engines/workspace/fileExistenceRegistry.ts's
 * scanForNewFiles (flat, extension-filtered, used for registry
 * registration): this returns the actual folder/file hierarchy for display,
 * scoped to the same real source directories scripts/watch-registry.ts
 * already watches — never the whole disk.
 */
import { readdirSync, statSync } from "fs";
import { join, relative } from "path";

// process.cwd(), not __dirname — this module's only caller today is
// app/api/admin/workspace/tree/route.ts, and Next.js/Vercel's serverless
// bundling does not preserve __dirname pointing at the real source tree
// (confirmed against this repo's own API route convention, e.g.
// app/api/build/route.ts, app/api/governance/route.ts — all use process.cwd()).
const ROOT = process.cwd();

// Same real source roots scripts/watch-registry.ts already watches — the
// Explorer shows exactly what the dev-loop pipeline already treats as "the
// project", not an arbitrary filesystem walk.
export const EXPLORER_ROOTS = [
  "core", "gateway", "engines", "cognitive", "presenter", "services",
  "plugins", "registry", "app", "scripts", "components", "config",
];

const IGNORE = new Set(["node_modules", ".next", ".git", ".dna-os"]);

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

function walk(absDir: string, maxDepth: number, depth: number): FileTreeNode[] {
  if (depth > maxDepth) return [];
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((e) => !IGNORE.has(e.name) && !e.name.startsWith("."))
    .map((e) => {
      const absPath = join(absDir, e.name);
      const relPath = relative(ROOT, absPath);
      if (e.isDirectory()) {
        return { name: e.name, path: relPath, type: "directory" as const, children: walk(absPath, maxDepth, depth + 1) };
      }
      return { name: e.name, path: relPath, type: "file" as const };
    })
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
}

/** maxDepth bounds runtime on a real repo this size (700+ registered modules) —
 * deeper levels load on demand by calling this again with that node's path. */
export function buildFileTree(rootRelPath: string, maxDepth = 2): FileTreeNode[] {
  const absDir = join(ROOT, rootRelPath);
  const stat = statSync(absDir);
  if (!stat.isDirectory()) return [];
  return walk(absDir, maxDepth, 0);
}
