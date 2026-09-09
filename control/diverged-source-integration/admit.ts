import { evaluateRemoteAdmission } from "../github-branch-governance/contract";
import type { IntegrationAdmission } from "./types";

export function evaluateIntegrationAdmission(input: {
  readonly actor: "DNA_OS_PUBLISH_AUTHORITY" | "AI_CLIENT" | "CODING_CLIENT";
  readonly machine_verification_passed: boolean;
  readonly remote_features_preserved: boolean;
  readonly integration_workspace_isolated: boolean;
  readonly integration_base_is_live_remote: boolean;
  readonly git_add_all_used: boolean;
  readonly force_push: boolean;
}): IntegrationAdmission {
  if (input.git_add_all_used) {
    return deny("GIT_ADD_ALL_DENIED");
  }
  const remote = evaluateRemoteAdmission({
    actor: input.actor,
    scope_verified: input.integration_workspace_isolated && input.integration_base_is_live_remote,
    machine_verification_passed: input.machine_verification_passed && input.remote_features_preserved,
    admission_allow: input.machine_verification_passed,
    integration_approved: input.integration_workspace_isolated,
    candidate_revision_matches: input.integration_base_is_live_remote,
    force_push: input.force_push,
  });
  if (remote.decision !== "ALLOW") {
    return deny(remote.reason_code);
  }
  return {
    schema: "DNA_OS_INTEGRATION_ADMISSION_V1",
    decision: "ALLOW",
    reason_code: "DNA_OS_APPROVED_PUBLICATION",
    actor: "DNA_OS_INTEGRATION_AUTHORITY",
    coding_client_self_approved: false,
    GIT_ADD_ALL_USED: false,
    FORCE_PUSH_USED: false,
  };
}

function deny(reason_code: string): IntegrationAdmission {
  return {
    schema: "DNA_OS_INTEGRATION_ADMISSION_V1",
    decision: "DENY",
    reason_code,
    actor: "DNA_OS_INTEGRATION_AUTHORITY",
    coding_client_self_approved: false,
    GIT_ADD_ALL_USED: false,
    FORCE_PUSH_USED: false,
  };
}
