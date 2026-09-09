export const GITHUB_CANONICAL_BRANCH_GOVERNANCE = "GITHUB_CANONICAL_BRANCH_GOVERNANCE_V1" as const;
export const DNA_OS_REQUIRED_REMOTE_ADMISSION_GATE = "DNA_OS_REQUIRED_REMOTE_ADMISSION_GATE_V1" as const;
export const DNA_OS_CANONICAL_MAIN_POLICY = "DNA_OS_CANONICAL_MAIN_POLICY_V1" as const;
export const GITHUB_BYPASS_POLICY = "GITHUB_BYPASS_POLICY_V1" as const;
export const OWNER_EMERGENCY_GITHUB_RECOVERY = "OWNER_EMERGENCY_GITHUB_RECOVERY_V1" as const;
export const DNA_OS_REMOTE_ADMISSION = "DNA_OS_REMOTE_ADMISSION_V1" as const;

export type GovernanceMechanism = "RULESET" | "CLASSIC_BRANCH_PROTECTION" | "NOT_AVAILABLE";
export type RulesetEnforcementMode = "EVALUATE" | "ACTIVE" | "NOT_APPLIED";
export type IntegrationModel = "DIRECT_PROTECTED_PUSH" | "PULL_REQUEST_MERGE" | "GITHUB_APP_MERGE" | "OTHER";
export type RequiredCheckMode = "STRICT" | "LOOSE";
export type AdmissionState = "SUCCESS" | "FAILURE" | "PENDING" | "NOT_APPLICABLE";

export interface GithubStatusContextV1 {
  readonly context: string;
  readonly state: string;
  readonly creator: string | null;
  readonly source_class: "RAILWAY_GITHUB_INTEGRATION" | "GITHUB_ACTIONS" | "UNKNOWN";
}

export interface PublicationActorV1 {
  readonly identified: boolean;
  readonly actor_class: "OWNER_USER_DEVICE_FLOW_TOKEN" | "GITHUB_APP" | "ACTIONS_BOT" | "PAT" | "UNKNOWN";
  readonly github_login: string | null;
  readonly registry_account: string | null;
  readonly live_user_probe_ok: boolean;
  readonly credential_ref: string | null;
  readonly credential_source: string | null;
  readonly resolver_kind: string | null;
  readonly resolver_service: string | null;
  readonly connection_id: string | null;
  readonly committer_name_observed: "DNA OS Commit Authority" | string | null;
  readonly secret_exposed: false;
}

export interface GithubGovernanceDiscoveryV1 {
  readonly schema: "GITHUB_GOVERNANCE_DISCOVERY_V1";
  readonly owner: string;
  readonly repository: string;
  readonly default_branch: string;
  readonly private: boolean | null;
  readonly MAIN_PROTECTED: boolean;
  readonly branch_protected_field: boolean | null;
  readonly ACTIVE_BRANCH_RULESETS: readonly number[];
  readonly ACTIVE_PUSH_RULESETS: readonly number[];
  readonly EXISTING_REQUIRED_CHECKS: readonly string[];
  readonly AVAILABLE_CHECK_CONTEXTS: readonly string[];
  readonly status_contexts: readonly GithubStatusContextV1[];
  readonly workflow_names: readonly string[];
  readonly PUBLICATION_ACTOR_IDENTITY: PublicationActorV1;
  readonly REPOSITORY_RULE_ADMIN_READY: boolean;
  readonly admin_permission: boolean | null;
  readonly GOVERNANCE_MECHANISM: GovernanceMechanism;
  readonly github_plan_blocker: string | null;
  readonly protection_http_status: number | null;
  readonly ruleset_http_status: number | null;
  readonly remote_head_sha: string | null;
  readonly DNA_OS_GITHUB_INTEGRATION_MODEL: IntegrationModel;
  readonly discovered_at: string;
}
