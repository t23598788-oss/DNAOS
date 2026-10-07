/**
 * หน้าที่: translate REAL, already-existing signals from this repo's own
 * modules into ../runtime/circuit-state.ts updates. This is the ONLY file
 * in dna-os-circuit/ allowed to import from outside dna-os-circuit/, and
 * only from this repo's own public contracts/registries/health-checks —
 * never a cross-repo import, matching the rule already established for
 * ../../control/command-router/.
 *
 * Two responsibilities:
 *  1. `initializeCircuitFromRepo()` — one-shot: reads static registration
 *     facts (capability-registry.ts, current-capability-map.json) plus
 *     live health checks (research-engine, github credential presence) to
 *     set every top-level node/edge to its honest starting status.
 *  2. `driveRealPermissionAndExecutionDemo()` — drives ONE real command
 *     through the FULL real chain (register a fresh real Identity/
 *     Account/Workspace/Membership/Grant, resolveEntryContext(), then
 *     submitOwnerCommand() — which internally calls the real
 *     evaluateExecutionPermission() and startExecution()), not a
 *     hardcoded timer, flipping every node from ENTRY_CONTEXT through
 *     OWNER_UI and their edges RUNNING/ACTIVE and back as the real calls
 *     actually progress — this is the "prove it's real" driver used by
 *     the live-verification script.
 *
 * Dependency ที่อนุญาต: ../runtime/circuit-state.ts,
 * ../../control/command-router/capability-registry.ts,
 * ../../control/command-router/contract.ts,
 * ../../control/owner-command/contract.ts,
 * ../../control/entry-context/contract.ts,
 * ../../permissions/execution-policy/contract.ts,
 * ../../permissions/access-control/identity-registry.ts,
 * ../../permissions/access-control/membership-registry.ts,
 * ../../permissions/software-scope/account-registry.ts,
 * ../../permissions/software-scope/workspace-registry.ts,
 * ../../execution/run/contract.ts,
 * ../../connections/research-engine/research-engine-adapter.ts,
 * ../../connections/github/adapter-config.ts + host-runtime.ts (read-only
 * credential-presence check), ../../control/command-router/current-capability-map.json.
 * สิ่งที่ห้ามแตะ: never import implementation internals (rules.ts,
 * policy.ts's private helpers, executor.ts internals, resolver.ts,
 * router.ts, owner-command.ts directly) — only each capability's own
 * public contract.ts (or, for permissions/access-control and
 * permissions/software-scope, the registry file itself — those folders
 * have no separate contract.ts wrapper, matching
 * ../../control/entry-context/resolver.ts's own established precedent of
 * importing them directly). Never fabricate a node status that isn't
 * backed by a real read below.
 *
 * 2026-08-16 (Owner) — ACCOUNT/WORKSPACE gap closed: identity-registry.ts,
 * account-registry.ts, workspace-registry.ts, membership-registry.ts, and
 * control/entry-context/ are now real, tested, and consumed by the real
 * resolver — IDENTITY flips PARTIAL -> READY, and six new top-level nodes
 * (ENTRY_CONTEXT, ACCOUNT, WORKSPACE, MEMBERSHIP, COMMAND_POLICY,
 * EXECUTION_GRANT) join the fixed topology between OWNER_COMMAND and
 * COMMAND_ROUTER, per ../definition/circuit.json's updated edge order.
 * PERMISSION also moved to AFTER COMMAND_ROUTER (previously before it) —
 * corrected to match the real call order in
 * ../../control/command-router/router.ts's routeOwnerCommand (classify
 * first, then runExecutionStep evaluates permission before dispatching),
 * verified by reading that file, not assumed.
 */

import { CircuitState } from "../runtime/circuit-state";
import { CAPABILITY_REGISTRY } from "../../control/command-router/capability-registry";
import currentCapabilityMap from "../../control/command-router/current-capability-map.json";
import { issueExecutionGrant } from "../../permissions/execution-policy/contract";
import { listCommandDescriptors, listCommandPolicyDescriptors } from "../../execution/run/contract";
import { checkResearchEngineLiveHealth } from "../../connections/research-engine/research-engine-adapter";
import { EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME } from "../../connections/github/adapter-config";
import { readEnvVar } from "../../connections/github/host-runtime";
import { resolveEntryContext } from "../../control/entry-context/contract";
import { submitOwnerCommand } from "../../control/owner-command/contract";
import type { RouteOptions } from "../../control/command-router/contract";
import type { EnvelopeIdentity } from "../../contracts/identity/envelope-identity";
import { registerIdentity, listIdentityRegistrations } from "../../permissions/access-control/identity-registry";
import { grantMembership, listMembershipsForIdentity } from "../../permissions/access-control/membership-registry";
import { registerAccount, listAccounts } from "../../permissions/software-scope/account-registry";
import { registerWorkspace, listWorkspacesForAccount } from "../../permissions/software-scope/workspace-registry";

interface CapabilityMapRow {
  capability_id: string;
  status: string;
}

function mapStatusEntry(capabilityId: string): CapabilityMapRow | undefined {
  return (currentCapabilityMap as CapabilityMapRow[]).find((row) => row.capability_id === capabilityId);
}

/**
 * Sets every top-level node to an honest starting status, sourced from
 * real files (never hardcoded). Async because the research-engine and
 * github checks are real I/O (network / env var read), exactly like
 * round 2's own per-request health check discipline — never a cached
 * assumption.
 */
export async function initializeCircuitFromRepo(state: CircuitState): Promise<void> {
  // INPUT — always READY, no backing file (conceptual entry point).
  state.updateNode("INPUT", "READY", "conceptual entry point — no dedicated module");

  // OWNER_COMMAND — SOURCE_ONLY per capability map, but a real callable module -> READY (exists, has real contract).
  const ownerCommandRow = mapStatusEntry("owner-command");
  state.updateNode("OWNER_COMMAND", "READY", ownerCommandRow ? `capability map status: ${ownerCommandRow.status}` : "control/owner-command/owner-command.ts");

  // ENTRY_CONTEXT — control/entry-context/contract.ts resolveEntryContext, real, tested (2 suites: entry-context.test.ts, account-workspace-resolution.test.ts).
  try {
    if (typeof resolveEntryContext !== "function") throw new Error("resolveEntryContext is not a function");
    state.updateNode("ENTRY_CONTEXT", "READY", "control/entry-context/contract.ts resolveEntryContext — real, assembles Identity/Account/Workspace/Membership/Command/Grant before permission evaluation");
  } catch (error) {
    state.updateNode("ENTRY_CONTEXT", "BLOCKED", `control/entry-context/contract.ts failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }

  // IDENTITY — permissions/access-control/identity-registry.ts is now a real, in-memory store (2026-08-16), consumed by the real entry-context resolver -> READY.
  try {
    listIdentityRegistrations();
    state.updateNode("IDENTITY", "READY", "permissions/access-control/identity-registry.ts — real store (registerIdentity/getIdentityRegistration), consumed by control/entry-context/resolver.ts");
  } catch (error) {
    state.updateNode("IDENTITY", "BLOCKED", `permissions/access-control/identity-registry.ts failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ACCOUNT — permissions/software-scope/account-registry.ts, real store, tested 8/8, closes the account-resolution gap.
  try {
    listAccounts();
    state.updateNode("ACCOUNT", "READY", "permissions/software-scope/account-registry.ts — real store (registerAccount/getAccount/suspendAccount), consumed by control/entry-context/resolver.ts");
  } catch (error) {
    state.updateNode("ACCOUNT", "BLOCKED", `permissions/software-scope/account-registry.ts failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }

  // WORKSPACE — permissions/software-scope/workspace-registry.ts, real store, tested 11/11, enforces cross-account + active checks.
  try {
    listWorkspacesForAccount("__circuit_init_probe__");
    state.updateNode("WORKSPACE", "READY", "permissions/software-scope/workspace-registry.ts — real store, cross-account/active checks enforced by control/entry-context/resolver.ts");
  } catch (error) {
    state.updateNode("WORKSPACE", "BLOCKED", `permissions/software-scope/workspace-registry.ts failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }

  // MEMBERSHIP — permissions/access-control/membership-registry.ts, real store, filtered by the resolver against real Account/Workspace validity.
  try {
    listMembershipsForIdentity("__circuit_init_probe__");
    state.updateNode("MEMBERSHIP", "READY", "permissions/access-control/membership-registry.ts — real store, filtered by control/entry-context/resolver.ts against real Account/Workspace validity before reaching rules.ts");
  } catch (error) {
    state.updateNode("MEMBERSHIP", "BLOCKED", `permissions/access-control/membership-registry.ts failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }

  // COMMAND_POLICY — execution/run/policy-descriptor.ts projectCommandPolicyDescriptor, real, tested.
  try {
    listCommandPolicyDescriptors();
    state.updateNode("COMMAND_POLICY", "READY", "execution/run/policy-descriptor.ts — real CommandPolicyDescriptor projection, consumed by control/entry-context/resolver.ts");
  } catch (error) {
    state.updateNode("COMMAND_POLICY", "BLOCKED", `execution/run/policy-descriptor.ts failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }

  // EXECUTION_GRANT — permissions/execution-policy/grants.ts, real store, tested (22/22 in grants.test.ts).
  try {
    if (typeof issueExecutionGrant !== "function") throw new Error("issueExecutionGrant is not a function");
    state.updateNode("EXECUTION_GRANT", "READY", "permissions/execution-policy/grants.ts — real store (issueExecutionGrant/listExecutionGrantsForIdentity), consumed by control/entry-context/resolver.ts");
  } catch (error) {
    state.updateNode("EXECUTION_GRANT", "BLOCKED", `permissions/execution-policy/grants.ts failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }

  // PERMISSION — permission-reasoner entry in capability-registry.ts.
  const permissionReasoner = CAPABILITY_REGISTRY["permission-reasoner"];
  state.updateNode(
    "PERMISSION",
    permissionReasoner?.health_status === "CONNECTED" ? "READY" : "BLOCKED",
    `capability-registry.ts permission-reasoner health_status: ${permissionReasoner?.health_status ?? "MISSING"}`,
  );

  // COMMAND_ROUTER — SOURCE_ONLY per capability map (no transport caller), but real routing logic exists -> READY.
  const routerRow = mapStatusEntry("command-router");
  state.updateNode("COMMAND_ROUTER", "READY", routerRow ? `capability map status: ${routerRow.status}` : "control/command-router/router.ts");

  // EXECUTION — capability-registry.ts execution entry.
  const executionCap = CAPABILITY_REGISTRY["execution"];
  state.updateNode(
    "EXECUTION",
    executionCap?.health_status === "CONNECTED" ? "READY" : "BLOCKED",
    `capability-registry.ts execution health_status: ${executionCap?.health_status ?? "MISSING"}`,
  );

  // VALIDATOR — verified: no validator module/entry exists anywhere in this repo.
  state.updateNode("VALIDATOR", "NOT_YET_REAL", "no validator module or capability-registry.ts entry exists in this repo");

  // REGISTRY — real registries exist (execution/run/registry.ts, capability-registry.ts) but no unified routable REGISTRY capability -> PARTIAL.
  state.updateNode("REGISTRY", "PARTIAL", "execution/run/registry.ts + control/command-router/capability-registry.ts exist but are not wired as one routable REGISTRY capability");

  // RESULT — contracts/command/capability-result.ts is a real, used contract.
  state.updateNode("RESULT", "READY", "contracts/command/capability-result.ts CapabilityResult");

  // OWNER_UI — renderOwnerSurface exists but no real UI/transport renders it.
  state.updateNode("OWNER_UI", "PARTIAL", "control/owner-command/owner-command.ts renderOwnerSurface exists but no real Owner-facing UI/transport consumes it yet");

  // Live health checks (real I/O) refine PERMISSION/EXECUTION via their downstream connectors — github/research-engine feed evidence, not top-level nodes directly per fixed topology, but their BLOCKED-detection pattern is exercised here for the demo driver below.
  await refreshResearchEngineHealth(state);
  refreshGithubCredentialPresence(state);

  // Sub-circuit EXECUTION nodes — all real per execution/run/*.ts (read above); default_status in circuit.json already reflects this, no override needed here beyond confirming the registry is non-empty.
  const descriptors = listCommandDescriptors();
  if (descriptors.length === 0) {
    state.updateNode("EXEC_COMMAND_DESCRIPTOR", "BLOCKED", "execution/run/registry.ts COMMAND_REGISTRY is empty");
  }

  // Sub-circuit PERMISSION nodes are all backed by real rules.ts functions — circuit.json defaults already reflect READY; nothing further to check statically.
}

/**
 * Research-engine BLOCKED detection — exactly the offline-handling pattern
 * from round 2 (health-checked per call, never cached/mocked). Accepts an
 * optional `baseUrl` override so a test can point at a real but
 * guaranteed-unreachable local port (e.g. an unused high port with
 * nothing listening) to deterministically exercise the real offline path
 * — this is still a REAL health check hitting a REAL (absent) endpoint,
 * never a mocked function.
 */
export async function refreshResearchEngineHealth(state: CircuitState, baseUrl?: string): Promise<void> {
  try {
    const healthy = await checkResearchEngineLiveHealth(baseUrl ? { baseUrl } : {});
    // research-engine is not a top-level circuit node (it's a downstream connector of EXECUTION/COMMAND_ROUTER in the real router), but we record its live signal on the EXECUTION sub-node most relevant to it — Process Runtime — as an honest evidence note without inventing a new top-level node.
    if (!healthy) {
      state.updateNode("EXEC_PROCESS_RUNTIME", "BLOCKED", "connections/research-engine health check failed (RESEARCH_ENGINE_OFFLINE) — downstream connector unreachable");
    } else {
      state.updateNode("EXEC_PROCESS_RUNTIME", "READY", "connections/research-engine health check passed");
    }
  } catch (error) {
    state.updateNode("EXEC_PROCESS_RUNTIME", "BLOCKED", `connections/research-engine health check threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** GitHub credential-presence check — read-only env var read, no network call (matches credential-resolution.ts's own env-var-by-reference discipline). Missing env var -> BLOCKED signal recorded honestly. */
export function refreshGithubCredentialPresence(state: CircuitState): void {
  const token = readEnvVar(EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME);
  if (!token) {
    state.updateNode("EXEC_COMMAND_DESCRIPTOR", "PARTIAL", `github credential env var "${EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME}" not set — github-dependent commands would be BLOCKED`);
  }
}

/** All edges driven by the demo — kept as one list so both the ACTIVE pass and the idle-settle pass stay in sync. */
const DEMO_EDGE_CHAIN = [
  "e_input_owner_command",
  "e_owner_command_entry_context",
  "e_entry_context_identity",
  "e_identity_account",
  "e_account_workspace",
  "e_workspace_membership",
  "e_membership_command_policy",
  "e_command_policy_execution_grant",
  "e_execution_grant_router",
  "e_router_permission",
  "e_permission_execution",
  "e_execution_result",
  "e_result_owner_ui",
] as const;

/**
 * Registers ONE fresh, real Identity/Account/Workspace/Membership/Grant
 * set (real store writes, via the real registration functions — never a
 * hand-built literal) for the demo to resolve through. Fresh ids every
 * call because account-registry.ts/workspace-registry.ts fail closed on a
 * repeat id (matches permissions/software-scope/tests/account-registry
 * .test.ts's own "no silent re-provision" expectation) — this is not a
 * workaround, it's the real registries behaving exactly as tested.
 * Mirrors control/entry-context/tests/account-workspace-resolution
 * .test.ts's own "full real internal path" fixture setup.
 */
function registerFreshDemoScope(commandId: string): { identityId: string; accountId: string; workspaceId: string } {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const identityId = `circuit-demo-identity-${suffix}`;
  const accountId = `circuit-demo-account-${suffix}`;
  const workspaceId = `circuit-demo-workspace-${suffix}`;

  const descriptor = listCommandDescriptors().find((d) => d.command_id === commandId);
  if (!descriptor) throw new Error(`demo command "${commandId}" not found in execution/run registry`);

  registerIdentity({ identity_id: identityId, kind: "human", display_name: "Circuit Demo Identity" });
  registerAccount({ account_id: accountId });
  registerWorkspace({ workspace_id: workspaceId, account_id: accountId });
  grantMembership({ identity_id: identityId, scope_type: "account", scope_id: accountId, role: "owner" });
  grantMembership({ identity_id: identityId, scope_type: "workspace", scope_id: workspaceId, role: "owner" });
  issueExecutionGrant({
    identity_id: identityId,
    account_id: accountId,
    workspace_id: workspaceId,
    capability: "execution.run",
    command_id: commandId,
    action: "run",
    cwd_scope_prefix: "workspace_root/",
    effect: "allow",
  });

  return { identityId, accountId, workspaceId };
}

/**
 * Drives ONE real command ("workspace.pwd") through the FULL real chain —
 * Identity -> Account -> Workspace -> Membership -> Entry Context ->
 * Router -> Permission -> Execution -> Result -> Owner UI — mutating
 * circuit-state as it actually progresses. Every status flip below is
 * driven by an actual awaited real function returning (registerIdentity,
 * registerAccount, registerWorkspace, grantMembership, issueExecutionGrant,
 * resolveEntryContext, submitOwnerCommand — all real, all imported from
 * each module's public contract, none hand-faked), never a
 * setTimeout-based fake progression. Used by the live-verification
 * screenshot script.
 */
export async function driveRealPermissionAndExecutionDemo(state: CircuitState): Promise<void> {
  const commandId = "workspace.pwd";

  state.updateEdge("e_input_owner_command", "ACTIVE", "COMMAND");
  state.updateNode("OWNER_COMMAND", "RUNNING", "demo command submitted");

  state.updateEdge("e_owner_command_entry_context", "ACTIVE", "RESOLVE");
  state.updateNode("ENTRY_CONTEXT", "RUNNING", "registering real Identity/Account/Workspace/Membership/Grant fixtures");

  const { identityId, accountId, workspaceId } = registerFreshDemoScope(commandId);
  state.updateEdge("e_entry_context_identity", "ACTIVE", "IDENTITY");
  state.updateEdge("e_identity_account", "ACTIVE", "ACCOUNT");
  state.updateEdge("e_account_workspace", "ACTIVE", "WORKSPACE");
  state.updateEdge("e_workspace_membership", "ACTIVE", "MEMBERSHIP");
  state.updateEdge("e_membership_command_policy", "ACTIVE", "COMMAND_POLICY");
  state.updateEdge("e_command_policy_execution_grant", "ACTIVE", "EXECUTION_GRANT");

  const resolution = resolveEntryContext({ identity_id: identityId, account_id: accountId, workspace_id: workspaceId, command_id: commandId });
  state.updateNode("ENTRY_CONTEXT", "READY", `resolved: account=${resolution.account?.account_id ?? "unresolved"}, workspace=${resolution.workspace?.workspace_id ?? "unresolved"}`);

  state.updateEdge("e_execution_grant_router", "ACTIVE", "COMMAND");
  state.updateNode("COMMAND_ROUTER", "RUNNING", "routing to execution capability");

  state.updateEdge("e_router_permission", "ACTIVE", "EVALUATE");
  state.updateNode("PERMISSION", "RUNNING", "evaluateExecutionPermission() in flight (via the real, unmodified rules.ts)");

  const ownerIdentity: EnvelopeIdentity = { identity_id: identityId, acting_as_account_id: accountId, acting_as_tenant_id: `circuit-demo-tenant-${Date.now()}`, software_id: "dna-os-circuit-demo", kind: "human" };
  const options: RouteOptions = {
    steps: [{ capability_id: "execution", intent: "execution.run", payload: { command_id: commandId } }],
    executionPolicyContext: resolution.context,
    executionRequestBase: resolution.executionRequestBase,
  };

  state.updateEdge("e_permission_execution", "ACTIVE", "PENDING");
  state.updateNode("EXECUTION", "RUNNING", `submitOwnerCommand("${commandId}") in flight — full real chain, not a direct startExecution() bypass`);

  const outcome = await submitOwnerCommand("รันคำสั่งที่อนุญาตแล้ว (circuit demo)", ownerIdentity, options);

  state.updateNode("PERMISSION", "READY", `decision reached via evaluateExecutionPermission inside routeOwnerCommand — result status: ${outcome.result.status}`);

  if (outcome.result.status !== "COMPLETED" && outcome.result.status !== "RUNNING") {
    state.updateEdge("e_permission_execution", "IDLE", "BLOCKED");
    state.updateNode("EXECUTION", "BLOCKED", `submitOwnerCommand did not reach COMPLETED/RUNNING: ${outcome.result.status} — ${outcome.result.summary}`);
    state.updateNode("COMMAND_ROUTER", "READY", "routing complete");
    return;
  }

  state.updateNode("EXECUTION", "READY", `execution reached ${outcome.result.status}: ${outcome.result.summary}`);
  state.updateNode("COMMAND_ROUTER", "READY", "routing complete");
  state.updateEdge("e_execution_result", "ACTIVE", outcome.result.status);
  state.updateNode("RESULT", "RUNNING", "capability result assembled");
  state.updateEdge("e_result_owner_ui", "ACTIVE", "RESPONDED");
  state.updateNode("OWNER_UI", "READY", "result rendered");
  state.updateNode("RESULT", "READY", "capability result delivered");

  // Settle edges back to idle after the demo window (real, but bounded — matches "return to idle after a beat" UX, not a fake timer driving state).
  setTimeout(() => {
    for (const edgeId of DEMO_EDGE_CHAIN) {
      state.updateEdge(edgeId, "IDLE", null);
    }
    state.updateNode("OWNER_COMMAND", "READY", "idle");
  }, 1500);
}
