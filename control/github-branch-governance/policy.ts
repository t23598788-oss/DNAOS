import { codingClientBarriers } from "../mcp-code-knowledge/contract";
import {
  DNA_OS_CANONICAL_MAIN_POLICY,
  GITHUB_BYPASS_POLICY,
  GITHUB_CANONICAL_BRANCH_GOVERNANCE,
  OWNER_EMERGENCY_GITHUB_RECOVERY,
} from "./types";
import type { GithubGovernanceDiscoveryV1, RequiredCheckMode } from "./types";

export function canonicalMainPolicy(): {
  readonly schema: typeof DNA_OS_CANONICAL_MAIN_POLICY;
  readonly target_ref: "refs/heads/main";
  readonly MAIN_FORCE_PUSH_ALLOWED: false;
  readonly MAIN_DELETE_ALLOWED: false;
  readonly AI_DIRECT_MAIN_PUSH: false;
  readonly CODING_CLIENT_DIRECT_MAIN_PUSH: false;
  readonly DIRECT_UNGOVERNED_MAIN_UPDATE: false;
  readonly ONLY_DNA_OS_APPROVED_CHANGES_REACH_MAIN: true;
  readonly PULL_REQUEST_REQUIRED: false;
  readonly AI_REVIEW_REQUIRED_FOR_SECURITY: false;
  readonly REQUIRED_CHECK_MODE: RequiredCheckMode;
  readonly reason: string;
} {
  return {
    schema: DNA_OS_CANONICAL_MAIN_POLICY,
    target_ref: "refs/heads/main",
    MAIN_FORCE_PUSH_ALLOWED: false,
    MAIN_DELETE_ALLOWED: false,
    AI_DIRECT_MAIN_PUSH: false,
    CODING_CLIENT_DIRECT_MAIN_PUSH: false,
    DIRECT_UNGOVERNED_MAIN_UPDATE: false,
    ONLY_DNA_OS_APPROVED_CHANGES_REACH_MAIN: true,
    PULL_REQUEST_REQUIRED: false,
    AI_REVIEW_REQUIRED_FOR_SECURITY: false,
    REQUIRED_CHECK_MODE: "LOOSE",
    reason: "Verified DNA OS conveyor is DIRECT_PROTECTED_PUSH with expected remote SHA. Strict GitHub up-to-date checks are PR-merge semantics and would not match this route.",
  };
}

export function githubBypassPolicy(): {
  readonly schema: typeof GITHUB_BYPASS_POLICY;
  readonly HUMAN_BYPASS: false;
  readonly AI_BYPASS: false;
  readonly CODING_CLIENT_BYPASS: false;
  readonly ALL_ADMINS_BYPASS: false;
  readonly ALL_MAINTAINERS_BYPASS: false;
  readonly OWNER_ACCOUNT_GLOBAL_BYPASS: false;
  readonly bypass_actors: readonly string[];
  readonly BYPASS_SCOPE_MINIMIZED: true;
} {
  return {
    schema: GITHUB_BYPASS_POLICY,
    HUMAN_BYPASS: false,
    AI_BYPASS: false,
    CODING_CLIENT_BYPASS: false,
    ALL_ADMINS_BYPASS: false,
    ALL_MAINTAINERS_BYPASS: false,
    OWNER_ACCOUNT_GLOBAL_BYPASS: false,
    bypass_actors: [],
    BYPASS_SCOPE_MINIMIZED: true,
  };
}

export function ownerEmergencyGithubRecovery(): {
  readonly schema: typeof OWNER_EMERGENCY_GITHUB_RECOVERY;
  readonly permanently_enabled: false;
  readonly available_to_ai: false;
  readonly available_during_normal_operation: false;
  readonly requires_explicit_owner_action: true;
  readonly requires_security_sensitive_reauth: true;
  readonly high_risk_preview: true;
  readonly temporary_scoped: true;
  readonly evidence_recorded: true;
  readonly current_state: "DOCUMENTED_NOT_ARMED";
  readonly owner_action_required: string;
} {
  return {
    schema: OWNER_EMERGENCY_GITHUB_RECOVERY,
    permanently_enabled: false,
    available_to_ai: false,
    available_during_normal_operation: false,
    requires_explicit_owner_action: true,
    requires_security_sensitive_reauth: true,
    high_risk_preview: true,
    temporary_scoped: true,
    evidence_recorded: true,
    current_state: "DOCUMENTED_NOT_ARMED",
    owner_action_required: "Upgrade GitHub plan (Pro) or make the repository public so rulesets/branch protection exist, then Owner-enable a temporary scoped recovery ruleset after SECURITY_SENSITIVE_REAUTH. Do not use this path in normal publication.",
  };
}

export function proposedRuleset(discovery: GithubGovernanceDiscoveryV1): Record<string, unknown> {
  return {
    name: "DNA_OS_CANONICAL_MAIN_V1",
    target: "branch",
    enforcement: "evaluate",
    conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
    rules: [
      { type: "deletion", parameters: { enabled: false } },
      { type: "non_fast_forward" },
      { type: "required_status_checks", omitted: true, reason: "no invented checks; Railway contexts are post-deploy and would deadlock" },
      { type: "pull_request", omitted: true, reason: "DNA OS integration model is DIRECT_PROTECTED_PUSH" },
    ],
    bypass_actors: [],
    GOVERNANCE_MECHANISM_PREFERRED: "RULESET",
    publication_actor_login: discovery.PUBLICATION_ACTOR_IDENTITY.github_login,
    APPLIED: false,
  };
}

export function railwayFollowsApprovedMain(discovery: GithubGovernanceDiscoveryV1): {
  readonly expected_route: "DNA_OS_APPROVED_MAIN -> RAILWAY_INTEGRATION -> DEPLOY -> RUNTIME_VERIFY";
  readonly railway_statuses_are_post_deploy: true;
  readonly require_railway_status_to_update_main: false;
  readonly GOVERNANCE_DEPLOYMENT_CYCLE: false;
  readonly contexts: readonly string[];
} {
  const railway = discovery.status_contexts.filter((row) => row.source_class === "RAILWAY_GITHUB_INTEGRATION").map((row) => row.context);
  return {
    expected_route: "DNA_OS_APPROVED_MAIN -> RAILWAY_INTEGRATION -> DEPLOY -> RUNTIME_VERIFY",
    railway_statuses_are_post_deploy: true,
    require_railway_status_to_update_main: false,
    GOVERNANCE_DEPLOYMENT_CYCLE: false,
    contexts: railway,
  };
}

export function unauthorizedMainUpdateDenied(): Record<string, boolean | string> {
  const barriers = codingClientBarriers();
  return {
    AI_DIRECT_MAIN_PUSH: false,
    CODING_CLIENT_DIRECT_MAIN_PUSH: false,
    AI_DIRECT_GITHUB_WRITE: barriers.AI_DIRECT_GITHUB_WRITE === false,
    CODING_CLIENT_DIRECT_GITHUB_WRITE: barriers.CODING_CLIENT_DIRECT_GITHUB_WRITE === false,
    schema: GITHUB_CANONICAL_BRANCH_GOVERNANCE,
  };
}
