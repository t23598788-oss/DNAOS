/**
 * Real Workflow -> Command edges from registry/commands/commands.json's own
 * `workflow` field, cross-checked against registry/commands/workflows.json's
 * real keys (a declared workflow name that doesn't exist there is reported
 * UNKNOWN — real registry drift, not silently linked).
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { DependencyEdge, UnknownDependency } from "@/core/shared/types";
import { ROOT, edge, unknown } from "./common";

export function scanWorkflowReferences(): { edges: DependencyEdge[]; unknowns: UnknownDependency[] } {
  const commandsPath = join(ROOT, "registry/commands/commands.json");
  const workflowsPath = join(ROOT, "registry/commands/workflows.json");
  if (!existsSync(commandsPath) || !existsSync(workflowsPath)) return { edges: [], unknowns: [] };

  const commands = JSON.parse(readFileSync(commandsPath, "utf-8")) as { command: string; workflow: string }[];
  const workflows = JSON.parse(readFileSync(workflowsPath, "utf-8")) as Record<string, unknown>;

  const edges: DependencyEdge[] = [];
  const unknowns: UnknownDependency[] = [];
  const seen = new Set<string>();

  for (const c of commands) {
    const key = `${c.workflow}->${c.command}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const workflowExists = c.workflow in workflows;
    if (!workflowExists) {
      unknowns.push(unknown(`workflow:${c.workflow}`, "workflow_references", `commands.json declares workflow "${c.workflow}" for command "${c.command}" but it is not a real key in registry/commands/workflows.json`));
      continue;
    }
    const e = edge(
      `workflow:${c.workflow}`, `command:${c.command}`, "workflow_references_command",
      [{ kind: "json_registry_field", file: "registry/commands/commands.json", detail: `command "${c.command}" declares workflow="${c.workflow}", verified present in registry/commands/workflows.json` }],
      0.9
    );
    if (e) edges.push(e);
  }

  return { edges, unknowns };
}
