/**
 * Real Module -> Config edges: greps supabase/functions and local-runtime
 * for `Deno.env.get("X")` / `process.env.X` and cross-references against
 * registry/infrastructure.json's declared real env vars, when present.
 * A config key used in code but never declared in infrastructure.json is
 * reported as UNKNOWN (real drift), never silently linked.
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, extname } from "path";
import type { DependencyEdge, UnknownDependency } from "@/core/shared/types";
import { ROOT, edge, unknown } from "./common";

function walkSourceFiles(dir: string, exts: string[], out: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walkSourceFiles(full, exts, out);
    else if (exts.includes(extname(e.name))) out.push(full);
  }
  return out;
}

export function scanConfigReferences(): { edges: DependencyEdge[]; unknowns: UnknownDependency[] } {
  const edges: DependencyEdge[] = [];
  const unknowns: UnknownDependency[] = [];

  const infraPath = join(ROOT, "registry/infrastructure.json");
  const knownServices: string[] = existsSync(infraPath)
    ? JSON.stringify(JSON.parse(readFileSync(infraPath, "utf-8"))) // real declared infra, used only for presence-check below
    .match(/"[A-Z_]{4,}"/g)?.map((s) => s.replace(/"/g, "")) ?? []
    : [];

  const files = [
    ...walkSourceFiles(join(ROOT, "supabase/functions"), [".ts"]),
    ...walkSourceFiles(join(ROOT, "local-runtime"), [".mjs", ".ts"]),
  ];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const relFile = file.replace(ROOT + "/", "");
    const matches = [...content.matchAll(/(?:Deno\.env\.get|process\.env)\(?\.?["']?([A-Z_]{4,})["']?\)?/g)];
    const seen = new Set<string>();
    for (const m of matches) {
      const key = m[1];
      if (seen.has(key)) continue;
      seen.add(key);
      const line = content.slice(0, m.index).split("\n").length;
      const declared = knownServices.includes(key);
      const e = edge(
        `module:${relFile}`, `config:${key}`, "config_referenced_by_module",
        [{ kind: "env_reference", file: relFile, line, detail: `real reference to env var ${key}` }],
        declared ? 0.85 : 0.65
      );
      if (e) edges.push(e);
      if (!declared) unknowns.push(unknown(`config:${key}`, "config_references", `referenced in ${relFile}:${line} but not found in registry/infrastructure.json — possible undeclared config drift`));
    }
  }

  return { edges, unknowns };
}
