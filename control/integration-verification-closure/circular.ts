import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./host-runtime";

export function mcpQueenCycleAbsent(root = repoRoot()): boolean {
  const queen = readFileSync(join(root, "control/owner-client-runtime/ai-queen.ts"), "utf8");
  const policy = readFileSync(join(root, "connections/dna-os-mcp/export-policy.ts"), "utf8");
  return !queen.includes("tool-registry") && policy.includes("ai-queen-grants");
}
