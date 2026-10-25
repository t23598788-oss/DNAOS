/**
 * Real Supabase Function -> Database Table edges — greps every
 * supabase/functions/<name>/index.ts (and its real local imports) for
 * `.from("table_name")` calls. A real regex match on real source, not a
 * declared/assumed relationship.
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import type { DependencyEdge } from "@/core/shared/types";
import { ROOT, edge } from "./common";

function walkTs(dir: string, out: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walkTs(full, out);
    else if (e.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

export function scanSupabaseFunctions(): DependencyEdge[] {
  const functionsDir = join(ROOT, "supabase/functions");
  if (!existsSync(functionsDir)) return [];

  const edges: DependencyEdge[] = [];
  let functionDirs: string[] = [];
  try { functionDirs = readdirSync(functionsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "_shared").map((d) => d.name); } catch { return []; }

  for (const fnName of functionDirs) {
    const files = walkTs(join(functionsDir, fnName));
    const seenTables = new Set<string>();
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const relFile = file.replace(ROOT + "/", "");
      for (const m of content.matchAll(/\.from\(["']([a-z_]+)["']\)/g)) {
        const table = m[1];
        if (seenTables.has(table)) continue; // one edge per function->table pair, not per call site
        seenTables.add(table);
        const line = content.slice(0, m.index).split("\n").length;
        const e = edge(
          `function:supabase/functions/${fnName}`, `database:${table}`, "function_queries_table",
          [{ kind: "grep_literal", file: relFile, line, detail: `real .from("${table}") call` }],
          0.9
        );
        if (e) edges.push(e);
      }
    }
  }
  return edges;
}
