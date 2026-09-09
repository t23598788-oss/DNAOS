/**
 * หน้าที่: the type contracts for `control/command-router/` — the
 * capability registry shape (what "a registered destination" means in
 * this repo) and the router's own step/decision shapes. Field names for
 * `capability_id` deliberately match `../../contracts/command/capability-result.ts`'s
 * `CapabilityResult.capability_id`, so a registry entry and a result
 * describe the same real capability.
 *
 * Input: none (pure type definitions).
 * Output: `CapabilityHealthStatus`, `PermissionRequirement`,
 * `EndpointReference`, `CapabilityRegistration`, `RouterStep`,
 * `ClassificationOutcome`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a field that lets `EndpointReference` carry an
 * import path into another repo's implementation — `entry` is always
 * either a contract file inside THIS repo (`connections/`, `execution/`,
 * `permissions/`) or the literal string `"not_yet_built"`. Never add a
 * boolean "connected" shortcut — `health_status` stays the same two-value
 * union as `ai/agent-registry`/`software/repository-registry` describe in
 * their own READMEs (CONNECTED / NOT_CONNECTED), so a registry consumer
 * never has to guess what a bare `true` means.
 *
 * NOT_YET_BUILT: nothing outside ./capability-registry.ts and ./router.ts
 * reads these yet.
 */

export type CapabilityHealthStatus = "CONNECTED" | "NOT_CONNECTED";

export type CapabilityRuntimeStatus = "REGISTERED" | "WIRED" | "LIVE" | "EXECUTABLE" | "VERIFIED" | "BLOCKED";

/** Whether a routed capability must pass a permission decision before it may run. "none" still means "the capability enforces its own scope check" (see connections/github/github-adapter.ts's account-scope check) — never a blanket bypass. */
export type PermissionRequirement = "none" | "execution-policy";

/**
 * Where the router actually calls, in-repo only. `"contract"` = a public
 * `contract.ts` file this capability folder exports (execution/run/,
 * permissions/execution-policy/). `"adapter"` = a capability folder that
 * has no single `contract.ts` yet but has one real, documented public
 * entry point (connections/github/'s `handleGithubCommand`, per its own
 * `adapter-contract.ts`) AND takes only a `CommandEnvelope` — no extra
 * dependency-injection argument. `"connector"` = a capability folder whose
 * real entry point needs extra dependencies (its own
 * AccountBindingProvider/CredentialProvider, etc.) beyond a bare
 * `CommandEnvelope` — routed via
 * `../connector-execution-boundary/contract.ts`'s `executeConnectorCommand`,
 * never invoked directly by name here (added 2026-08-22, Owner correction
 * — fixes the exact gap this file's own header used to document for
 * `digitalocean`: "router has no mechanism to supply deps"). `"not_yet_built"`
 * = no real callable surface exists in this repo yet — the router must
 * never invoke it and must always report NOT_CONNECTED.
 */
export type EndpointReference = { kind: "contract"; module: string; entry: string } | { kind: "adapter"; module: string; entry: string } | { kind: "connector"; module: string; entry: string } | { kind: "not_yet_built" };

export interface CapabilityRegistration {
  capability_id: string;
  repo_id: string;
  contract: string; // repo-relative path to the public contract/adapter-contract file this registration is verified against
  endpoint: EndpointReference;
  supported_commands: readonly string[];
  /** Owner-command text is matched against these keyword sets — a set matches only when EVERY keyword in it is present (AND within a set, OR across sets). Keeps "ตรวจ 7 repo" (file-intelligence) from colliding with "ตรวจ permission" (permission-reasoner). */
  match_keyword_sets: readonly (readonly string[])[];
  permission_requirement: PermissionRequirement;
  health_status: CapabilityHealthStatus;
}

/**
 * Narrow, read-only projection of `CapabilityRegistration` for callers that
 * only need to match text against a known capability id — never the
 * `endpoint` (real adapter module/entry) or `permission_requirement` a full
 * registration carries. Added (Owner UNLOCK, 2026-09-06) so
 * `control/owner-command-semantics/` can resolve a mention to a
 * `capability_id` without importing execution-wiring fields.
 */
export interface CapabilitySummary {
  capability_id: string;
  repo_id: string;
  match_keyword_sets: readonly (readonly string[])[];
  /**
   * Added (Owner UNLOCK 2026-09-06, BUILD_SELF_WORK_LEDGER_V1): the list of
   * command strings this capability actually supports — still just data
   * (command NAMES, never the `endpoint`/module reference that would
   * execute one). Needed so a read-only ledger can tell "capability id
   * matched by keyword" apart from "a command exists for what the Owner
   * actually asked to do" without reintroducing the write/endpoint leak
   * `ReadOnlyRegistryView`/`CapabilitySummary` were built to close.
   */
  supported_commands: readonly string[];
}

/** One step of a (possibly multi-worker) Owner command. */
export interface RouterStep {
  capability_id: string;
  intent: string;
  payload: unknown;
}

export type ClassificationOutcome =
  | { status: "MATCHED"; capability: CapabilityRegistration }
  | { status: "OWNER_REVIEW"; reason: string; candidates: readonly string[] }
  | { status: "UNSUPPORTED_COMMAND"; reason: string };
