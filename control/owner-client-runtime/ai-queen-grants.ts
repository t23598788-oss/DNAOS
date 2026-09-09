export const AI_QUEEN_CLIENT_ID = "ai://queen-local";
export const EXTERNAL_PARITY_CLIENT_ID = "ai://external-parity";

export const RAW_RAILWAY_MCP_TOOLS = [
  "railway_deploy",
  "railway-mcp.deploy",
  "serviceInstanceDeployV2",
  "serviceCreate",
  "environmentCreate",
  "variableUpsert",
] as const;

export const AI_QUEEN_DEFAULT_TOOLS = [
  "dna_os.get_system_health",
  "dna_os.get_runtime_identity",
  "dna_os.get_machine_inventory",
  "dna_os.get_capability_status",
  "dna_os.list_local_resources",
  "dna_os.get_local_resource",
  "dna_os.get_local_capabilities",
  "dna_os.list_clients",
  "dna_os.get_client_status",
  "dna_os.list_notifications",
  "dna_os.get_notification_summary",
  "dna_os.get_active_work",
  "dna_os.get_owner_attention_required",
  "dna_os.list_active_work",
  "dna_os.get_submitted_work",
  "dna_os.get_work_output_summary",
  "dna_os.get_owner_work_notification_summary",
  "dna_os.get_production_readiness_summary",
  "dna_os.get_real_production_lineage",
  "dna_os.get_production_checkpoint",
  "dna_os.get_work_completion_report",
  "dna_os.get_deployment_target_status",
  "dna_os.list_remote_production_resources",
  "dna_os.get_remote_production_binding",
  "dna_os.get_remote_authentication_status",
  "dna_os.get_ai_queen_status",
  "dna_os.get_ai_queen_capability_profile",
  "dna_os.get_railway_provider_interface_status",
  "dna_os.get_railway_mcp_status",
  "dna_os.get_github_main_governance",
  "dna_os.get_github_ruleset_status",
  "dna_os.get_required_status_checks",
  "dna_os.get_github_bypass_policy",
  "dna_os.get_remote_admission_gate_status",
] as const;

const DEVELOPMENT_SCOPED_MUTATION = [
  "dna_os.modify_source",
  "dna_os.apply_scoped_source_write",
  "dna_os.create_scoped_source_file",
  "dna_os.delete_scoped_source_file",
  "dna_os.create_scoped_development_workspace",
  "dna_os.read_scoped_source",
  "dna_os.invoke_coding_worker",
] as const;

export function grantedToolsForAiClient(input: {
  readonly client_id?: string;
  readonly authority_domain?: "OPERATIONAL" | "DEVELOPMENT";
  readonly lease_active?: boolean;
  readonly granted_tools?: readonly string[];
}): readonly string[] | null {
  if (input.granted_tools) return input.granted_tools;
  const profiled = input.client_id === AI_QUEEN_CLIENT_ID || input.client_id === EXTERNAL_PARITY_CLIENT_ID;
  if (!profiled) return null;
  if (input.authority_domain === "DEVELOPMENT" && input.lease_active === true) {
    return [...AI_QUEEN_DEFAULT_TOOLS, ...DEVELOPMENT_SCOPED_MUTATION];
  }
  return AI_QUEEN_DEFAULT_TOOLS;
}

export function isRawRailwayMcpTool(toolName: string): boolean {
  return (RAW_RAILWAY_MCP_TOOLS as readonly string[]).includes(toolName);
}
