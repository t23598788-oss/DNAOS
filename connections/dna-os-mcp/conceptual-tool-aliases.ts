/**
 * Conceptual developer/verification names → existing MCP tool_ids.
 * No duplicate tools. DNA OS registry remains the only tool universe.
 */

export const CONCEPTUAL_TOOL_ALIASES: Readonly<Record<string, string>> = {
  "dnaos.lookup_capability": "lookup_capability",
  "dnaos.inspect_capability": "dna_os.get_capability_status",
  "dnaos.resolve_tool_grant": "dna_os.resolve_tool_grant",
  "dnaos.read_resource": "get_resource",
  "dnaos.inspect_connector": "dna_os.get_capability_binding_status",
  "dnaos.verify_connection": "dna_os.get_tool_health",
  "dnaos.inspect_runtime": "dna_os.get_runtime_identity",
  "dnaos.run_test": "dna_os.get_verification_status",
  "dnaos.collect_evidence": "dna_os.get_work_evidence",
  "dnaos.submit_work_result": "submit_work_result",
  "dnaos.request_write": "dna_os.create_action_preview",
  "dnaos.prepare_publication": "dna_os.get_promotion_status",
  "dnaos.request_owner_approval": "dna_os.open_owner_review",
  "dnaos.verify_publication": "dna_os.get_runtime_verification",
  "dnaos.get_task": "get_task",
  "dnaos.get_system_status": "get_system_status",
};

export type ToolSurfaceClass = "OPERATIONAL" | "DEVELOPMENT" | "VERIFICATION" | "GRANT";

const VERIFICATION_TOOLS = new Set([
  "dna_os.get_verification_status",
  "dna_os.get_runtime_verification",
  "dna_os.get_capability_drift",
  "dna_os.get_tool_health",
  "dna_os.get_system_health",
  "get_system_status",
]);

const DEVELOPMENT_TOOLS = new Set([
  "dna_os.get_development_work",
  "dna_os.get_development_status",
  "dna_os.get_production_pipeline",
  "dna_os.create_scoped_workspace",
  "dna_os.create_action_preview",
  "dna_os.open_owner_review",
  "dna_os.apply_owner_review",
  "dna_os.list_development_notifications",
]);

const GRANT_TOOLS = new Set([
  "dna_os.resolve_tool_grant",
  "dna_os.inspect_tool_descriptor",
]);

/** Resolve conceptual alias → canonical tool_id. Unknown aliases stay as given. */
export function resolveCanonicalToolId(toolIdOrAlias: string): string {
  const trimmed = toolIdOrAlias.trim();
  return CONCEPTUAL_TOOL_ALIASES[trimmed] ?? trimmed;
}

export function toolSurfaceClass(toolId: string): ToolSurfaceClass {
  const id = resolveCanonicalToolId(toolId);
  if (GRANT_TOOLS.has(id)) return "GRANT";
  if (VERIFICATION_TOOLS.has(id)) return "VERIFICATION";
  if (DEVELOPMENT_TOOLS.has(id)) return "DEVELOPMENT";
  return "OPERATIONAL";
}
