import { activationGate, activateGithubMainProtection } from "./activation";
import { evaluateRemoteAdmission, remoteAdmissionGateStatus } from "./admission";
import { discoverGithubGovernance } from "./discover";
import { ingestGithubGovernanceCanonical, notifyGithubGovernance } from "./ingest";
import { lastGithubGovernanceDiscovery, resetGovernanceMemory } from "./persist";
import {
  canonicalMainPolicy,
  githubBypassPolicy,
  ownerEmergencyGithubRecovery,
  proposedRuleset,
  railwayFollowsApprovedMain,
  unauthorizedMainUpdateDenied,
} from "./policy";
import {
  DNA_OS_CANONICAL_MAIN_POLICY,
  DNA_OS_REQUIRED_REMOTE_ADMISSION_GATE,
  GITHUB_BYPASS_POLICY,
  GITHUB_CANONICAL_BRANCH_GOVERNANCE,
  OWNER_EMERGENCY_GITHUB_RECOVERY,
} from "./types";
import type { GithubGovernanceDiscoveryV1 } from "./types";

export async function refreshGithubGovernance(options?: { readonly notify?: boolean }): Promise<GithubGovernanceDiscoveryV1> {
  const discovery = await discoverGithubGovernance();
  ingestGithubGovernanceCanonical(discovery);
  if (options?.notify !== false) notifyGithubGovernance(discovery);
  return discovery;
}

export function getGithubMainGovernance(discovery?: GithubGovernanceDiscoveryV1) {
  const row = discovery ?? lastGithubGovernanceDiscovery();
  const gate = row ? activationGate(row) : null;
  const policy = canonicalMainPolicy();
  return {
    schema: GITHUB_CANONICAL_BRANCH_GOVERNANCE,
    DNA_OS_CANONICAL_MAIN_POLICY: policy.schema,
    GOVERNANCE_MECHANISM: row?.GOVERNANCE_MECHANISM ?? "NOT_AVAILABLE",
    MAIN_PROTECTED: row?.MAIN_PROTECTED ?? false,
    RULESET_ENFORCEMENT_MODE: gate?.RULESET_ENFORCEMENT_MODE ?? "NOT_APPLIED",
    DNA_OS_PUBLICATION_ACTOR_IDENTIFIED: row?.PUBLICATION_ACTOR_IDENTITY.identified ?? false,
    DNA_OS_GITHUB_INTEGRATION_MODEL: row?.DNA_OS_GITHUB_INTEGRATION_MODEL ?? "DIRECT_PROTECTED_PUSH",
    EXISTING_REQUIRED_CHECKS: row?.EXISTING_REQUIRED_CHECKS ?? [],
    AVAILABLE_CHECK_CONTEXTS: row?.AVAILABLE_CHECK_CONTEXTS ?? [],
    NO_INVENTED_REQUIRED_CHECK_NAMES: true,
    DNA_OS_CHECK_EXPECTED_SOURCE_BOUND: "NOT_AVAILABLE" as const,
    MAIN_FORCE_PUSH_ALLOWED: policy.MAIN_FORCE_PUSH_ALLOWED,
    MAIN_DELETE_ALLOWED: policy.MAIN_DELETE_ALLOWED,
    AI_DIRECT_MAIN_PUSH: policy.AI_DIRECT_MAIN_PUSH,
    CODING_CLIENT_DIRECT_MAIN_PUSH: policy.CODING_CLIENT_DIRECT_MAIN_PUSH,
    REQUIRED_CHECK_MODE: policy.REQUIRED_CHECK_MODE,
    GOVERNANCE_DEPLOYMENT_CYCLE: false,
    SAFE_TO_ACTIVATE: gate?.SAFE_TO_ACTIVATE ?? false,
    github_plan_blocker: row?.github_plan_blocker ?? null,
    proposed_ruleset_applied: false,
    secret_exposed: false,
  };
}

export function getGithubRulesetStatus(discovery?: GithubGovernanceDiscoveryV1) {
  const row = discovery ?? lastGithubGovernanceDiscovery();
  const gate = row ? activationGate(row) : null;
  return {
    schema: "GITHUB_RULESET_STATUS_V1",
    GOVERNANCE_MECHANISM: row?.GOVERNANCE_MECHANISM ?? "NOT_AVAILABLE",
    RULESET_ENFORCEMENT_MODE: gate?.RULESET_ENFORCEMENT_MODE ?? "NOT_APPLIED",
    ACTIVE_BRANCH_RULESETS: row?.ACTIVE_BRANCH_RULESETS ?? [],
    ACTIVE_PUSH_RULESETS: row?.ACTIVE_PUSH_RULESETS ?? [],
    ruleset_http_status: row?.ruleset_http_status ?? null,
    protection_http_status: row?.protection_http_status ?? null,
    proposed: row ? proposedRuleset(row) : null,
    LIVE_RULESET_EVALUATION: gate?.LIVE_RULESET_EVALUATION ?? "AUTHORITY_NOT_AVAILABLE",
  };
}

export function getRequiredStatusChecks(discovery?: GithubGovernanceDiscoveryV1) {
  const row = discovery ?? lastGithubGovernanceDiscovery();
  return {
    EXISTING_REQUIRED_CHECKS: row?.EXISTING_REQUIRED_CHECKS ?? [],
    AVAILABLE_CHECK_CONTEXTS: row?.AVAILABLE_CHECK_CONTEXTS ?? [],
    status_contexts: row?.status_contexts ?? [],
    NO_INVENTED_REQUIRED_CHECK_NAMES: true,
    railway_post_deploy: row ? railwayFollowsApprovedMain(row) : null,
    DNA_OS_CHECK_EXPECTED_SOURCE_BOUND: "NOT_AVAILABLE" as const,
  };
}

export function getGithubBypassPolicy() {
  return githubBypassPolicy();
}

export function getRemoteAdmissionGateStatus() {
  return remoteAdmissionGateStatus();
}

export {
  DNA_OS_CANONICAL_MAIN_POLICY,
  DNA_OS_REQUIRED_REMOTE_ADMISSION_GATE,
  GITHUB_BYPASS_POLICY,
  GITHUB_CANONICAL_BRANCH_GOVERNANCE,
  OWNER_EMERGENCY_GITHUB_RECOVERY,
  activateGithubMainProtection,
  activationGate,
  canonicalMainPolicy,
  discoverGithubGovernance,
  evaluateRemoteAdmission,
  githubBypassPolicy,
  ingestGithubGovernanceCanonical,
  lastGithubGovernanceDiscovery,
  notifyGithubGovernance,
  ownerEmergencyGithubRecovery,
  proposedRuleset,
  railwayFollowsApprovedMain,
  remoteAdmissionGateStatus,
  resetGovernanceMemory,
  unauthorizedMainUpdateDenied,
};
