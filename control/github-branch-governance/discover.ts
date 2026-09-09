import { listConnections } from "../../connections/connection-registry/contract";
import { resolveGithubCredential } from "../../connections/github/credential-resolution";
import { getAuthenticatedUser, getBranch, getRepository, listCheckRunsForCommit, listWorkflowRunsForHeadSha } from "../../connections/github/github-read-api";
import { probeGithubPublicationAuth } from "../../connections/github/publication-auth-probe";
import { githubGovernanceGet } from "./github-rest";
import { nowIso } from "./host-runtime";
import { persistGithubGovernanceDiscovery } from "./persist";
import type { GithubGovernanceDiscoveryV1, GithubStatusContextV1, GovernanceMechanism, PublicationActorV1 } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function registeredGithubConnection() {
  const rows = listConnections().filter((row) =>
    row.adapter === "github"
    && row.connection_type === "SOURCE_AUTHORITY"
    && row.status === "connected"
    && row.target?.branch === "main"
  );
  return rows.at(-1) ?? null;
}

function classifyStatus(context: string, creator: string | null): GithubStatusContextV1["source_class"] {
  if (creator === "railway-app[bot]" || /railway/i.test(context)) return "RAILWAY_GITHUB_INTEGRATION";
  if (/github.actions|ci|test|build/i.test(context)) return "GITHUB_ACTIONS";
  return "UNKNOWN";
}

export async function discoverGithubGovernance(): Promise<GithubGovernanceDiscoveryV1> {
  const connection = registeredGithubConnection();
  const owner = connection?.target?.owner ?? "t23598788-oss";
  const repository = connection?.target?.repository ?? "-DNA-OS-INFRASTRUCTURE-";
  const emptyActor: PublicationActorV1 = {
    identified: false,
    actor_class: "UNKNOWN",
    github_login: null,
    registry_account: null,
    live_user_probe_ok: false,
    credential_ref: connection?.credential_ref.kind === "keychain_ref" ? connection.credential_ref.ref : null,
    credential_source: null,
    resolver_kind: null,
    resolver_service: null,
    connection_id: connection?.connection_id ?? null,
    committer_name_observed: "DNA OS Commit Authority",
    secret_exposed: false,
  };

  const base = (): GithubGovernanceDiscoveryV1 => ({
    schema: "GITHUB_GOVERNANCE_DISCOVERY_V1",
    owner,
    repository,
    default_branch: "main",
    private: null,
    MAIN_PROTECTED: false,
    branch_protected_field: null,
    ACTIVE_BRANCH_RULESETS: [],
    ACTIVE_PUSH_RULESETS: [],
    EXISTING_REQUIRED_CHECKS: [],
    AVAILABLE_CHECK_CONTEXTS: [],
    status_contexts: [],
    workflow_names: [],
    PUBLICATION_ACTOR_IDENTITY: emptyActor,
    REPOSITORY_RULE_ADMIN_READY: false,
    admin_permission: null,
    GOVERNANCE_MECHANISM: "NOT_AVAILABLE",
    github_plan_blocker: null,
    protection_http_status: null,
    ruleset_http_status: null,
    remote_head_sha: null,
    DNA_OS_GITHUB_INTEGRATION_MODEL: "DIRECT_PROTECTED_PUSH",
    discovered_at: nowIso(),
  });

  if (!connection) {
    return persistGithubGovernanceDiscovery({ ...base(), github_plan_blocker: "GitHub SOURCE_AUTHORITY connection is not registered" });
  }

  const credential = await resolveGithubCredential(connection);
  const probe = await probeGithubPublicationAuth(connection);
  if (!credential.ok) {
    return persistGithubGovernanceDiscovery({
      ...base(),
      PUBLICATION_ACTOR_IDENTITY: {
        ...emptyActor,
        credential_source: probe.credential_source,
        resolver_kind: probe.resolver_kind,
        resolver_service: probe.resolver_service,
        registry_account: probe.resolver_account,
      },
      github_plan_blocker: credential.reason,
    });
  }

  const user = await getAuthenticatedUser(credential.token);
  const deviceFlow = typeof probe.resolver_service === "string" && probe.resolver_service.includes("dna-os-github-device-flow");
  const actor: PublicationActorV1 = {
    identified: credential.ok && (deviceFlow || probe.resolver_kind === "macos_keychain"),
    actor_class: deviceFlow ? "OWNER_USER_DEVICE_FLOW_TOKEN" : (probe.resolver_kind === "macos_keychain" ? "OWNER_USER_DEVICE_FLOW_TOKEN" : "UNKNOWN"),
    github_login: user.kind === "found" ? user.login : probe.authenticated_login,
    registry_account: probe.resolver_account,
    live_user_probe_ok: probe.publication_auth_ok && user.kind === "found",
    credential_ref: emptyActor.credential_ref,
    credential_source: credential.credential_source,
    resolver_kind: probe.resolver_kind,
    resolver_service: probe.resolver_service,
    connection_id: connection.connection_id,
    committer_name_observed: "DNA OS Commit Authority",
    secret_exposed: false,
  };

  const repo = await getRepository(credential.token, { owner, repo: repository });
  const branch = await getBranch(credential.token, { owner, repo: repository, branch: "main" });
  const privateRepo = repo.kind === "found" ? repo.visibility === "private" : null;
  const remoteSha = branch.kind === "found" ? branch.head_commit_sha : null;
  const branchProtected = branch.kind === "found" ? branch.branch_protected : null;

  const protection = await githubGovernanceGet(credential.token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches/main/protection`);
  const rulesets = await githubGovernanceGet(credential.token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/rulesets`);
  const workflows = await githubGovernanceGet(credential.token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/actions/workflows`);
  const combined = remoteSha
    ? await githubGovernanceGet(credential.token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(remoteSha)}/status`)
    : null;
  const checks = remoteSha
    ? await listCheckRunsForCommit(credential.token, { owner, repo: repository, sha: remoteSha })
    : null;
  const runs = remoteSha
    ? await listWorkflowRunsForHeadSha(credential.token, { owner, repo: repository, sha: remoteSha })
    : null;

  const status_contexts: GithubStatusContextV1[] = [];
  if (combined?.kind === "ok" && isRecord(combined.body) && Array.isArray(combined.body.statuses)) {
    for (const row of combined.body.statuses) {
      if (!isRecord(row)) continue;
      const context = typeof row.context === "string" ? row.context : "";
      if (!context) continue;
      const creator = isRecord(row.creator) && typeof row.creator.login === "string" ? row.creator.login : null;
      status_contexts.push({
        context,
        state: typeof row.state === "string" ? row.state : "unknown",
        creator,
        source_class: classifyStatus(context, creator),
      });
    }
  }
  const checkNames = checks?.kind === "found" ? checks.runs.map((row) => row.name).filter(Boolean) : [];
  const workflowNames: string[] = [];
  if (workflows.kind === "ok" && isRecord(workflows.body) && Array.isArray(workflows.body.workflows)) {
    for (const row of workflows.body.workflows) {
      if (isRecord(row) && typeof row.name === "string") workflowNames.push(row.name);
    }
  }
  if (runs?.kind === "found") {
    for (const row of runs.runs) if (row.name) workflowNames.push(row.name);
  }

  const planBlocker = (protection.kind === "failed" && protection.plan_feature_unavailable) || (rulesets.kind === "failed" && rulesets.plan_feature_unavailable)
    ? "GitHub Free private repository cannot enable classic branch protection or repository rulesets (upgrade to GitHub Pro or make the repository public)"
    : (protection.kind === "failed" || rulesets.kind === "failed")
      ? `GitHub protection/ruleset read failed: ${protection.kind === "failed" ? protection.reason : rulesets.kind === "failed" ? rulesets.reason : "unknown"}`
      : null;
  let mechanism: GovernanceMechanism = "NOT_AVAILABLE";
  if (!planBlocker) {
    if (rulesets.kind === "ok") mechanism = "RULESET";
    else if (protection.kind === "ok" || protection.http_status === 404) mechanism = "CLASSIC_BRANCH_PROTECTION";
  }

  const admin = repo.kind === "found";
  const available = [...new Set([...status_contexts.map((row) => row.context), ...checkNames])];

  return persistGithubGovernanceDiscovery({
    schema: "GITHUB_GOVERNANCE_DISCOVERY_V1",
    owner,
    repository,
    default_branch: repo.kind === "found" ? repo.default_branch ?? "main" : "main",
    private: privateRepo,
    MAIN_PROTECTED: branchProtected === true,
    branch_protected_field: branchProtected,
    ACTIVE_BRANCH_RULESETS: [],
    ACTIVE_PUSH_RULESETS: [],
    EXISTING_REQUIRED_CHECKS: [],
    AVAILABLE_CHECK_CONTEXTS: available,
    status_contexts,
    workflow_names: [...new Set(workflowNames)],
    PUBLICATION_ACTOR_IDENTITY: actor,
    REPOSITORY_RULE_ADMIN_READY: admin && !planBlocker && mechanism !== "NOT_AVAILABLE",
    admin_permission: admin,
    GOVERNANCE_MECHANISM: mechanism,
    github_plan_blocker: planBlocker,
    protection_http_status: protection.http_status,
    ruleset_http_status: rulesets.http_status,
    remote_head_sha: remoteSha,
    DNA_OS_GITHUB_INTEGRATION_MODEL: "DIRECT_PROTECTED_PUSH",
    discovered_at: nowIso(),
  });
}
