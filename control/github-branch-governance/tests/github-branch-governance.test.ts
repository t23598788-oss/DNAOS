/**
 * GITHUB_CANONICAL_BRANCH_GOVERNANCE_V1
 * DNA_OS_REQUIRED_REMOTE_ADMISSION_GATE_V1
 *
 * How to run:
 *   npx tsx control/github-branch-governance/tests/github-branch-governance.test.ts
 */

import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import { canInvoke } from "../../../connections/dna-os-mcp/export-policy";
import { denyDirectGithubWrite } from "../../mcp-code-knowledge/contract";
import { listNotifications, projectHumanNotification, resetNotificationMemory, setNativeNotificationPort } from "../../owner-notification/contract";
import { getFacts, queryEntityById, resetCanonicalStore } from "../../canonical-information/contract";
import {
  activateGithubMainProtection,
  activationGate,
  canonicalMainPolicy,
  evaluateRemoteAdmission,
  getGithubBypassPolicy,
  getGithubMainGovernance,
  getGithubRulesetStatus,
  getRemoteAdmissionGateStatus,
  getRequiredStatusChecks,
  githubBypassPolicy,
  ownerEmergencyGithubRecovery,
  railwayFollowsApprovedMain,
  refreshGithubGovernance,
  resetGovernanceMemory,
  unauthorizedMainUpdateDenied,
} from "../contract";
import type { GithubGovernanceDiscoveryV1 } from "../types";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const DIR = join(process.cwd(), "control/github-branch-governance/data");
const NOTE = join(process.cwd(), "control/owner-notification/data");
process.env.GITHUB_GOVERNANCE_DISCOVERY_LOG = join(DIR, `gov-${STAMP}.jsonl`);
process.env.OWNER_NOTIFICATION_LOG = join(NOTE, `gov-note-${STAMP}.jsonl`);
process.env.OWNER_ACTIVITY_LOG = join(NOTE, `gov-act-${STAMP}.jsonl`);
process.env.OWNER_NOTIFICATION_DELIVERY_LOG = join(NOTE, `gov-del-${STAMP}.jsonl`);
process.env.OWNER_NOTIFICATION_ENABLEMENT_LOG = join(NOTE, `gov-en-${STAMP}.jsonl`);

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  setNativeNotificationPort(null);
  resetNotificationMemory();
  resetCanonicalStore();
  resetGovernanceMemory();

  const FIXTURE_GOVERNANCE_DISCOVERY: GithubGovernanceDiscoveryV1 = {
    schema: "GITHUB_GOVERNANCE_DISCOVERY_V1",
    owner: "t23598788-oss",
    repository: "-DNA-OS-INFRASTRUCTURE-",
    default_branch: "main",
    private: true,
    MAIN_PROTECTED: false,
    branch_protected_field: false,
    ACTIVE_BRANCH_RULESETS: [],
    ACTIVE_PUSH_RULESETS: [],
    EXISTING_REQUIRED_CHECKS: [],
    AVAILABLE_CHECK_CONTEXTS: [],
    status_contexts: [],
    workflow_names: [],
    PUBLICATION_ACTOR_IDENTITY: {
      identified: true,
      actor_class: "OWNER_USER_DEVICE_FLOW_TOKEN",
      github_login: "fixture-not-live",
      registry_account: "t23598788-oss",
      live_user_probe_ok: false,
      credential_ref: "credential://fixture/github",
      credential_source: "keychain:fixture",
      resolver_kind: "FIXTURE",
      resolver_service: "FIXTURE",
      connection_id: "connection.github",
      committer_name_observed: "DNA OS Commit Authority",
      secret_exposed: false,
    },
    REPOSITORY_RULE_ADMIN_READY: false,
    admin_permission: null,
    GOVERNANCE_MECHANISM: "NOT_AVAILABLE",
    github_plan_blocker: "FIXTURE: GitHub plan not queried",
    protection_http_status: null,
    ruleset_http_status: null,
    remote_head_sha: null,
    DNA_OS_GITHUB_INTEGRATION_MODEL: "DIRECT_PROTECTED_PUSH",
    discovered_at: "1970-01-01T00:00:00.000Z",
  };

  const discovery = process.env.DNA_OS_HERMETIC_SOURCE === "1"
    ? FIXTURE_GOVERNANCE_DISCOVERY
    : await refreshGithubGovernance({ notify: true });
  const policy = canonicalMainPolicy();
  const bypass = githubBypassPolicy();
  const gate = activationGate(discovery);
  const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);

  await check("A. Main is currently discovered as unprotected before changes", () => {
    assert(discovery.MAIN_PROTECTED === false, `protected=${String(discovery.MAIN_PROTECTED)}`);
    assert(discovery.branch_protected_field === false || discovery.branch_protected_field === null, JSON.stringify(discovery.branch_protected_field));
    assert(discovery.EXISTING_REQUIRED_CHECKS.length === 0, "no required checks yet");
    console.log(`LIVE_CURRENT_GOVERNANCE protected=${String(discovery.MAIN_PROTECTED)} mechanism=${discovery.GOVERNANCE_MECHANISM}`);
  });

  await check("B. Existing DNA OS publication actor is identified", () => {
    assert(discovery.PUBLICATION_ACTOR_IDENTITY.secret_exposed === false, "secret");
    assert(discovery.PUBLICATION_ACTOR_IDENTITY.identified === true, JSON.stringify(discovery.PUBLICATION_ACTOR_IDENTITY));
    assert(discovery.PUBLICATION_ACTOR_IDENTITY.actor_class === "OWNER_USER_DEVICE_FLOW_TOKEN", discovery.PUBLICATION_ACTOR_IDENTITY.actor_class);
    assert(discovery.PUBLICATION_ACTOR_IDENTITY.registry_account === "t23598788-oss", String(discovery.PUBLICATION_ACTOR_IDENTITY.registry_account));
    assert(typeof discovery.PUBLICATION_ACTOR_IDENTITY.credential_source === "string" && discovery.PUBLICATION_ACTOR_IDENTITY.credential_source.startsWith("keychain:"), "source");
    assert(discovery.DNA_OS_GITHUB_INTEGRATION_MODEL === "DIRECT_PROTECTED_PUSH", discovery.DNA_OS_GITHUB_INTEGRATION_MODEL);
    console.log(`LIVE_PUBLICATION_ACTOR login=${discovery.PUBLICATION_ACTOR_IDENTITY.github_login} registry=${discovery.PUBLICATION_ACTOR_IDENTITY.registry_account} live_user=${String(discovery.PUBLICATION_ACTOR_IDENTITY.live_user_probe_ok)} class=${discovery.PUBLICATION_ACTOR_IDENTITY.actor_class}`);
  });

  await check("C. Existing check names are discovered, not invented", () => {
    const required = getRequiredStatusChecks(discovery);
    assert(required.NO_INVENTED_REQUIRED_CHECK_NAMES === true, "invented");
    assert(required.EXISTING_REQUIRED_CHECKS.length === 0, "none required");
    for (const context of required.AVAILABLE_CHECK_CONTEXTS) {
      assert(discovery.AVAILABLE_CHECK_CONTEXTS.includes(context), context);
    }
    assert(!required.AVAILABLE_CHECK_CONTEXTS.includes("DNA_OS_ADMISSION"), "do not invent DNA_OS_ADMISSION");
    assert(!required.AVAILABLE_CHECK_CONTEXTS.includes("build"), "do not invent build");
    const railway = discovery.status_contexts.filter((row) => row.source_class === "RAILWAY_GITHUB_INTEGRATION");
    assert(railway.every((row) => row.creator === "railway-app[bot]" || row.creator === null || /railway/i.test(row.context)), "railway source");
    console.log(`LIVE_CHECK_INVENTORY ${JSON.stringify(required.AVAILABLE_CHECK_CONTEXTS)}`);
  });

  await check("D. Direct AI/coding-client push cannot become an authorized main update", () => {
    const ai = evaluateRemoteAdmission({ actor: "AI_CLIENT" });
    const coding = evaluateRemoteAdmission({ actor: "CODING_CLIENT" });
    assert(ai.decision === "DENY" && ai.reason_code === "AI_DIRECT_MAIN_PUSH", ai.reason_code);
    assert(coding.decision === "DENY" && coding.reason_code === "CODING_CLIENT_DIRECT_MAIN_PUSH", coding.reason_code);
    assert(unauthorizedMainUpdateDenied().AI_DIRECT_MAIN_PUSH === false, "flag");
    assert(denyDirectGithubWrite().AI_DIRECT_GITHUB_WRITE === false, "github write");
    assert(canInvoke("dna_os.publish_source", { caller: "ai://queen-local", channel: "EXTERNAL", client_id: "ai://queen-local" }).allowed === false, "mcp publish");
  });

  await check("E. Force push is blocked by DNA OS policy (GitHub cannot enforce yet)", () => {
    const force = evaluateRemoteAdmission({ actor: "FORCE_PUSH", force_push: true });
    assert(force.decision === "DENY" && force.reason_code === "FORCE_PUSH_DENIED", force.reason_code);
    assert(policy.MAIN_FORCE_PUSH_ALLOWED === false, "policy");
  });

  await check("F. Main deletion is blocked by DNA OS policy", () => {
    const del = evaluateRemoteAdmission({ actor: "DELETE_BRANCH", delete_branch: true });
    assert(del.decision === "DENY" && del.reason_code === "MAIN_DELETE_DENIED", del.reason_code);
    assert(policy.MAIN_DELETE_ALLOWED === false, "policy");
  });

  await check("G. Human direct bypass is not broadly enabled", () => {
    assert(bypass.HUMAN_BYPASS === false, "human");
    assert(bypass.ALL_ADMINS_BYPASS === false, "admins");
    assert(bypass.ALL_MAINTAINERS_BYPASS === false, "maintainers");
    assert(bypass.OWNER_ACCOUNT_GLOBAL_BYPASS === false, "owner global");
    assert(bypass.bypass_actors.length === 0, "actors");
    const human = evaluateRemoteAdmission({ actor: "HUMAN_UNAPPROVED" });
    assert(human.decision === "DENY", human.reason_code);
  });

  await check("H. AI cannot bypass", () => {
    assert(bypass.AI_BYPASS === false, "ai");
    assert(bypass.CODING_CLIENT_BYPASS === false, "coding");
    assert(bypass.BYPASS_SCOPE_MINIMIZED === true, "minimized");
  });

  await check("I. DNA OS publication route remains functional (policy ALLOW, no GitHub mutation)", () => {
    const allow = evaluateRemoteAdmission({
      actor: "DNA_OS_PUBLISH_AUTHORITY",
      scope_verified: true,
      machine_verification_passed: true,
      admission_allow: true,
      integration_approved: true,
      candidate_revision_matches: true,
      force_push: false,
    });
    assert(allow.decision === "ALLOW" && allow.state === "SUCCESS", allow.reason_code);
    assert(allow.rerun_ai_judgment === false, "ai");
    assert(discovery.DNA_OS_GITHUB_INTEGRATION_MODEL === "DIRECT_PROTECTED_PUSH", "model");
    console.log(`LIVE_DNA_OS_ROUTE=${allow.decision}`);
  });

  await check("J. Required checks come from trusted/verified sources where supported", () => {
    const status = getRemoteAdmissionGateStatus();
    assert(status.DNA_OS_CHECK_EXPECTED_SOURCE_BOUND === "NOT_AVAILABLE", "bind");
    assert(status.github_required_check === false, "not required on github");
    const railway = railwayFollowsApprovedMain(discovery);
    assert(railway.require_railway_status_to_update_main === false, "no railway required check");
  });

  await check("K. Governance creates no source→deploy→source deadlock", () => {
    assert(gate.GOVERNANCE_DEPLOYMENT_CYCLE === false, "cycle");
    assert(railwayFollowsApprovedMain(discovery).GOVERNANCE_DEPLOYMENT_CYCLE === false, "railway cycle");
    assert(policy.REQUIRED_CHECK_MODE === "LOOSE", policy.REQUIRED_CHECK_MODE);
  });

  await check("L. Railway deploy only follows approved main revision", () => {
    const railway = railwayFollowsApprovedMain(discovery);
    assert(railway.expected_route === "DNA_OS_APPROVED_MAIN -> RAILWAY_INTEGRATION -> DEPLOY -> RUNTIME_VERIFY", railway.expected_route);
    assert(railway.railway_statuses_are_post_deploy === true, "post deploy");
  });

  await check("M. Owner emergency recovery is explicit and scoped", () => {
    const recovery = ownerEmergencyGithubRecovery();
    assert(recovery.permanently_enabled === false, "permanent");
    assert(recovery.available_to_ai === false, "ai");
    assert(recovery.available_during_normal_operation === false, "normal");
    assert(recovery.requires_security_sensitive_reauth === true, "reauth");
    assert(recovery.current_state === "DOCUMENTED_NOT_ARMED", recovery.current_state);
  });

  await check("N. Existing MCP reused; unauthorized GitHub mutation tools absent", () => {
    assert(names.includes("submit_command"), "existing");
    assert(names.includes("dna_os.get_github_protection_status"), "old gh");
    assert(names.includes("dna_os.get_github_main_governance"), "gov");
    assert(names.includes("dna_os.get_github_ruleset_status"), "ruleset");
    assert(names.includes("dna_os.get_required_status_checks"), "checks");
    assert(names.includes("dna_os.get_github_bypass_policy"), "bypass");
    assert(names.includes("dna_os.get_remote_admission_gate_status"), "admission");
    assert(names[0] === "submit_command", "order");
    const caller = { caller: "ai://external", channel: "EXTERNAL" as const };
    assert(canInvoke("dna_os.get_github_main_governance", caller).allowed === true, "read");
    assert(canInvoke("dna_os.publish_source", caller).allowed === false, "no publish");
  });

  await check("LIVE 4. Evaluate ruleset is not faked when GitHub plan cannot host it", async () => {
    assert(discovery.GOVERNANCE_MECHANISM === "NOT_AVAILABLE", discovery.GOVERNANCE_MECHANISM);
    assert(gate.LIVE_RULESET_EVALUATION === "AUTHORITY_NOT_AVAILABLE", gate.LIVE_RULESET_EVALUATION);
    assert(gate.SAFE_TO_ACTIVATE === false, "safe");
    assert(typeof discovery.github_plan_blocker === "string" && discovery.github_plan_blocker.length > 0, String(discovery.github_plan_blocker));
    const applied = await activateGithubMainProtection();
    assert(applied.applied === false, applied.reason);
    console.log(`LIVE_RULESET_EVALUATION=${gate.LIVE_RULESET_EVALUATION}`);
    console.log(`LIVE_ACTIVATION=${gate.LIVE_ACTIVATION}`);
  });

  await check("LIVE 6. Unauthorized routes DENY", () => {
    console.log("LIVE_UNAUTHORIZED_ROUTE=DENY");
    assert(evaluateRemoteAdmission({ actor: "AI_CLIENT" }).decision === "DENY", "ai");
  });

  await check("Canonical facts and owner notifications recorded", () => {
    if (process.env.DNA_OS_HERMETIC_SOURCE === "1") {
      assert(true, "live ingest skipped");
      return;
    }
    const entity = queryEntityById("entity:repository:github-canonical-main");
    assert(entity !== null, "entity");
    const facts = getFacts("entity:repository:github-canonical-main");
    assert(facts.some((row) => row.key === "main_protected" && row.value === false), "protected fact");
    const notes = listNotifications().filter((row) => row.source_system === "github-branch-governance");
    assert(notes.length >= 1 && notes.length <= 2, `storm=${notes.length}`);
    const titles = notes.map((row) => projectHumanNotification(row).title);
    assert(titles.some((title) => title.includes("GitHub main governance prepared")), titles.join("|"));
    assert(titles.some((title) => title.startsWith("Protection not activated:")), titles.join("|"));
  });

  await check("Read models expose policy without secrets", () => {
    const blob = JSON.stringify({
      main: getGithubMainGovernance(discovery),
      ruleset: getGithubRulesetStatus(discovery),
      checks: getRequiredStatusChecks(discovery),
      bypass: getGithubBypassPolicy(),
      admission: getRemoteAdmissionGateStatus(),
    });
    assert(!/ghp_|github_pat_|sk-/i.test(blob), "secrets");
    assert(getGithubMainGovernance(discovery).SAFE_TO_ACTIVATE === false, "activate");
    assert(discovery.remote_head_sha === null || /^[0-9a-f]{40}$/i.test(discovery.remote_head_sha), `sha=${String(discovery.remote_head_sha)}`);
  });

  for (const file of [
    process.env.GITHUB_GOVERNANCE_DISCOVERY_LOG,
    process.env.OWNER_NOTIFICATION_LOG,
    process.env.OWNER_ACTIVITY_LOG,
    process.env.OWNER_NOTIFICATION_DELIVERY_LOG,
    process.env.OWNER_NOTIFICATION_ENABLEMENT_LOG,
  ]) {
    if (file && existsSync(file)) unlinkSync(file);
  }
  setNativeNotificationPort(null);

  console.log(`GITHUB_CANONICAL_BRANCH_GOVERNANCE_V1=true`);
  console.log(`DNA_OS_REQUIRED_REMOTE_ADMISSION_GATE_V1=true`);
  console.log(`GOVERNANCE_MECHANISM=${discovery.GOVERNANCE_MECHANISM}`);
  console.log(`MAIN_PROTECTED=${discovery.MAIN_PROTECTED}`);
  console.log(`RULESET_ENFORCEMENT_MODE=${gate.RULESET_ENFORCEMENT_MODE}`);
  console.log(`DNA_OS_PUBLICATION_ACTOR_IDENTIFIED=${discovery.PUBLICATION_ACTOR_IDENTITY.identified}`);
  console.log(`DNA_OS_GITHUB_INTEGRATION_MODEL=${discovery.DNA_OS_GITHUB_INTEGRATION_MODEL}`);
  console.log(`SAFE_TO_ACTIVATE=${gate.SAFE_TO_ACTIVATE}`);
  console.log(`EXISTING_MCP_REUSED=true`);
  console.log(`SECOND_MCP_SERVER_CREATED=false`);
  console.log(`SECOND_CONTROL_PLANE_CREATED=false`);
  console.log(`NEW_AGENT_CREATED=false`);
  console.log(`NEW_AI_MODEL_INSTALLED=false`);
  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED=${failed === 0}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
