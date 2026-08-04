/**
 * Real cross-registry references: registry/permissions.json's api_access
 * prefixes -> the actual route.ts file at that path (existence-checked, not
 * assumed), and registry/module-registry.json entries -> their declared
 * owner folder (existence-checked).
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { DependencyEdge } from "@/core/shared/types";
import { ROOT, edge } from "./common";

export function scanJsonRegistry(): DependencyEdge[] {
  const edges: DependencyEdge[] = [];

  const permissions = JSON.parse(readFileSync(join(ROOT, "registry/permissions.json"), "utf-8")) as {
    api_access: { prefix: string }[];
  };
  for (const a of permissions.api_access) {
    const routeFile = join(ROOT, a.prefix.replace(/^\//, ""), "route.ts");
    const exists = existsSync(routeFile);
    const e = edge(
      `registry:permissions.json`, `module:${a.prefix.replace(/^\//, "")}/route.ts`, "registry_references_file",
      [{ kind: "json_registry_field", file: "registry/permissions.json", detail: `api_access[].prefix = "${a.prefix}"` }],
      exists ? 0.9 : 0.3
    );
    if (e) edges.push(e);
  }

  const moduleRegistry = JSON.parse(readFileSync(join(ROOT, "registry/module-registry.json"), "utf-8")) as {
    modules: Record<string, { owner: string }>;
  };
  for (const [filePath, entry] of Object.entries(moduleRegistry.modules)) {
    const ownerDirExists = existsSync(join(ROOT, entry.owner));
    const e = edge(
      `module:${filePath}`, `folder:${entry.owner}`, "registry_references_file",
      [{ kind: "json_registry_field", file: "registry/module-registry.json", detail: `modules["${filePath}"].owner = "${entry.owner}"` }],
      ownerDirExists ? 0.85 : 0.35
    );
    if (e) edges.push(e);
  }

  return edges;
}
