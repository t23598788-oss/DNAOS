import { DNA_OS_REMOTE_ADMISSION, DNA_OS_REQUIRED_REMOTE_ADMISSION_GATE } from "./types";
import type { AdmissionState } from "./types";

export interface AdmissionInput {
  readonly actor: "DNA_OS_PUBLISH_AUTHORITY" | "AI_CLIENT" | "CODING_CLIENT" | "HUMAN_UNAPPROVED" | "FORCE_PUSH" | "DELETE_BRANCH";
  readonly scope_verified?: boolean;
  readonly machine_verification_passed?: boolean;
  readonly admission_allow?: boolean;
  readonly integration_approved?: boolean;
  readonly candidate_revision_matches?: boolean;
  readonly force_push?: boolean;
  readonly delete_branch?: boolean;
}

export function evaluateRemoteAdmission(input: AdmissionInput): {
  readonly schema: typeof DNA_OS_REQUIRED_REMOTE_ADMISSION_GATE;
  readonly check: typeof DNA_OS_REMOTE_ADMISSION;
  readonly state: AdmissionState;
  readonly decision: "ALLOW" | "DENY";
  readonly rerun_ai_judgment: false;
  readonly github_status_posted: false;
  readonly github_required_check: false;
  readonly reason_code: string;
} {
  if (input.actor === "FORCE_PUSH" || input.force_push === true) {
    return result("FAILURE", "DENY", "FORCE_PUSH_DENIED");
  }
  if (input.actor === "DELETE_BRANCH" || input.delete_branch === true) {
    return result("FAILURE", "DENY", "MAIN_DELETE_DENIED");
  }
  if (input.actor === "AI_CLIENT") {
    return result("FAILURE", "DENY", "AI_DIRECT_MAIN_PUSH");
  }
  if (input.actor === "CODING_CLIENT") {
    return result("FAILURE", "DENY", "CODING_CLIENT_DIRECT_MAIN_PUSH");
  }
  if (input.actor === "HUMAN_UNAPPROVED") {
    return result("FAILURE", "DENY", "DIRECT_UNGOVERNED_MAIN_UPDATE");
  }
  const ready = input.scope_verified === true
    && input.machine_verification_passed === true
    && input.admission_allow === true
    && input.integration_approved === true
    && input.candidate_revision_matches === true;
  if (!ready) {
    return result("PENDING", "DENY", "ADMISSION_INCOMPLETE");
  }
  return result("SUCCESS", "ALLOW", "DNA_OS_APPROVED_PUBLICATION");
}

function result(state: AdmissionState, decision: "ALLOW" | "DENY", reason_code: string) {
  return {
    schema: DNA_OS_REQUIRED_REMOTE_ADMISSION_GATE,
    check: DNA_OS_REMOTE_ADMISSION,
    state,
    decision,
    rerun_ai_judgment: false as const,
    github_status_posted: false as const,
    github_required_check: false as const,
    reason_code,
  };
}

export function remoteAdmissionGateStatus(): {
  readonly schema: typeof DNA_OS_REQUIRED_REMOTE_ADMISSION_GATE;
  readonly check: typeof DNA_OS_REMOTE_ADMISSION;
  readonly state: AdmissionState;
  readonly github_required_check: false;
  readonly bound_as_github_required_check: false;
  readonly DNA_OS_CHECK_EXPECTED_SOURCE_BOUND: "NOT_AVAILABLE";
  readonly NO_INVENTED_REQUIRED_CHECK_NAMES: true;
  readonly rerun_ai_judgment: false;
} {
  return {
    schema: DNA_OS_REQUIRED_REMOTE_ADMISSION_GATE,
    check: DNA_OS_REMOTE_ADMISSION,
    state: "NOT_APPLICABLE",
    github_required_check: false,
    bound_as_github_required_check: false,
    DNA_OS_CHECK_EXPECTED_SOURCE_BOUND: "NOT_AVAILABLE",
    NO_INVENTED_REQUIRED_CHECK_NAMES: true,
    rerun_ai_judgment: false,
  };
}
