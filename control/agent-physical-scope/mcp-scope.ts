/**
 * MCP mutation class split. Read/discovery may see historical references;
 * mutation requires a resolved assigned scope.
 */

import { CANONICAL_PROMOTION_TOOLS, SOURCE_MUTATION_TOOLS } from "../mcp-code-knowledge/contract";
import type { AgentActionClass, CanonicalAgentScope } from "./types";

export type McpToolClass = AgentActionClass | "UNKNOWN";

export function classifyMcpTool(tool_name: string): McpToolClass {
  if ((SOURCE_MUTATION_TOOLS as readonly string[]).includes(tool_name)) return "SOURCE_MUTATION";
  if ((CANONICAL_PROMOTION_TOOLS as readonly string[]).includes(tool_name)) return "GIT_WRITE";
  if (tool_name.includes("modify_source") || tool_name.includes("write_file")) return "SOURCE_MUTATION";
  if (tool_name.includes("runtime") && (tool_name.includes("stop") || tool_name.includes("start") || tool_name.includes("kill"))) {
    return "RUNTIME_MUTATION";
  }
  if (tool_name.startsWith("dna_os.get_") || tool_name.startsWith("lookup_") || tool_name === "get_task") return "SOURCE_READ";
  return "SOURCE_DISCOVERY";
}

export function mcpMutationAllowed(scope: CanonicalAgentScope | null, tool_name: string): boolean {
  const klass = classifyMcpTool(tool_name);
  if (klass === "SOURCE_DISCOVERY" || klass === "SOURCE_READ") return true;
  if (!scope || !scope.write_allowed) return false;
  return scope.allowed_actions.includes(klass);
}

export function mcpMutationRequiresTaskScope(tool_name: string): boolean {
  const klass = classifyMcpTool(tool_name);
  return klass === "SOURCE_MUTATION" || klass === "RUNTIME_MUTATION" || klass === "GIT_WRITE";
}
