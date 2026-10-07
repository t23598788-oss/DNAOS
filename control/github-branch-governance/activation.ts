import type { GithubGovernanceDiscoveryV1 } from "./types";
import { railwayFollowsApprovedMain } from "./policy";

export function activationGate(discovery: GithubGovernanceDiscoveryV1): {
  readonly SAFE_TO_ACTIVATE: boolean;
  readonly RULESET_ENFORCEMENT_MODE: "EVALUATE" | "ACTIVE" | "NOT_APPLIED";
  readonly LIVE_RULESET_EVALUATION: "AUTHORITY_NOT_AVAILABLE" | "EVALUATE" | "SKIPPED";
  readonly LIVE_ACTIVATION: "NOT_APPLIED" | "ACTIVE";
  readonly GOVERNANCE_DEPLOYMENT_CYCLE: false;
  readonly blocker: string | null;
  readonly owner_action_required: string | null;
} {
  const cycle = railwayFollowsApprovedMain(discovery);
  const plan = discovery.github_plan_blocker;
  if (plan || discovery.GOVERNANCE_MECHANISM === "NOT_AVAILABLE") {
    return {
      SAFE_TO_ACTIVATE: false,
      RULESET_ENFORCEMENT_MODE: "NOT_APPLIED",
      LIVE_RULESET_EVALUATION: "AUTHORITY_NOT_AVAILABLE",
      LIVE_ACTIVATION: "NOT_APPLIED",
      GOVERNANCE_DEPLOYMENT_CYCLE: false,
      blocker: plan ?? "GitHub rulesets and classic branch protection are not available for this repository",
      owner_action_required: "Enable GitHub Pro (or make the repository public) so repository rulesets/branch protection can be created in Evaluate mode first. Do not blindly click Protect this branch.",
    };
  }
  if (cycle.GOVERNANCE_DEPLOYMENT_CYCLE) {
    return {
      SAFE_TO_ACTIVATE: false,
      RULESET_ENFORCEMENT_MODE: "NOT_APPLIED",
      LIVE_RULESET_EVALUATION: "SKIPPED",
      LIVE_ACTIVATION: "NOT_APPLIED",
      GOVERNANCE_DEPLOYMENT_CYCLE: false,
      blocker: "deployment cycle",
      owner_action_required: null,
    };
  }
  if (!discovery.PUBLICATION_ACTOR_IDENTITY.identified) {
    return {
      SAFE_TO_ACTIVATE: false,
      RULESET_ENFORCEMENT_MODE: "NOT_APPLIED",
      LIVE_RULESET_EVALUATION: "SKIPPED",
      LIVE_ACTIVATION: "NOT_APPLIED",
      GOVERNANCE_DEPLOYMENT_CYCLE: false,
      blocker: "DNA OS publication actor is not identified",
      owner_action_required: "Re-bind GitHub publication credential before activating restrictions",
    };
  }
  return {
    SAFE_TO_ACTIVATE: false,
    RULESET_ENFORCEMENT_MODE: "EVALUATE",
    LIVE_RULESET_EVALUATION: "EVALUATE",
    LIVE_ACTIVATION: "NOT_APPLIED",
    GOVERNANCE_DEPLOYMENT_CYCLE: false,
    blocker: "Evaluate mode has not yet been proven against a non-destructive DNA OS publication on GitHub",
    owner_action_required: "Create the ruleset in Evaluate mode after GitHub plan supports it, then activate only after proofs pass",
  };
}

export async function activateGithubMainProtection(): Promise<{ applied: false; reason: string }> {
  return {
    applied: false,
    reason: "Activation withheld. GitHub enforcement is not available or Evaluate proofs have not passed. DNA OS publication path was not mutated.",
  };
}
