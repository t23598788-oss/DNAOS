/**
 * Real command->owner-file edges from registry/command-registry.json's own
 * `owner` field — every command entry already declares which file
 * implements it (checked at registration time by whoever added the
 * command), so this is a real cross-reference, not a guess.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { DependencyEdge } from "@/core/shared/types";
import { ROOT, edge } from "./common";

export function scanRuntimeCommands(): DependencyEdge[] {
  const registry = JSON.parse(readFileSync(join(ROOT, "registry/command-registry.json"), "utf-8")) as {
    commands: Record<string, { owner: string }>;
  };
  const edges: DependencyEdge[] = [];
  for (const [commandName, entry] of Object.entries(registry.commands)) {
    const ownerExists = existsSync(join(ROOT, entry.owner));
    const e = edge(
      `command:${commandName}`, `module:${entry.owner}`, "command_owned_by_module",
      [{ kind: "json_registry_field", file: "registry/command-registry.json", detail: `commands["${commandName}"].owner = "${entry.owner}"` }],
      ownerExists ? 0.95 : 0.4 // real file existence check — a declared owner that doesn't exist on disk is a real registry drift, not confidently assertable
    );
    if (e) edges.push(e);
  }
  return edges;
}
