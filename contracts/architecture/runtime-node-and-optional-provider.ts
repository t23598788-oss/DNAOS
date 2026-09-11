/**
 * Frozen meaning for portable DNA OS runtime (Owner sequence 2026-09-11):
 * 1. Railway / Vercel are OPTIONAL_PROVIDER — never architectural authority.
 * 2. Two node kinds: CORE_NODE and MAC_LOCAL_AGENT.
 *
 * This file is vocabulary + closed classification only. It does not start
 * processes, rebind registry roots, resolve secrets, or cut Railway.
 * Remaining sequence (fail-closed macOS routes, secret resolver, supervisor,
 * repository_root rebind, railway.app URLs, Railway off critical path)
 * is declared here as later work, not implemented.
 *
 * Input: provider_id or capability-folder path prefix.
 * Output: role / node kind, or UNKNOWN / UNCLASSIFIED (fail closed).
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามให้ Railway/Vercel เป็น EXECUTION_AUTHORITY หรือ
 * SOURCE_AUTHORITY; ห้ามให้ unknown provider กลายเป็น Core โดยปริยาย.
 */

export const RUNTIME_NODE_AND_OPTIONAL_PROVIDER_CONTRACT_ID =
  "dna-os/runtime-node-and-optional-provider" as const;
export const RUNTIME_NODE_AND_OPTIONAL_PROVIDER_CONTRACT_VERSION = "1.0.0" as const;

/** Architectural role of an external provider. Closed union. */
export type ArchitecturalProviderRole =
  | "OPTIONAL_PROVIDER"
  | "SOURCE_AUTHORITY"
  | "DATA_SERVICE"
  | "EXTERNAL_ADAPTER";

/** Where a capability is allowed to run. Closed union. */
export type RuntimeNodeKind = "CORE_NODE" | "MAC_LOCAL_AGENT";

export type ProviderRoleLookup =
  | { readonly known: true; readonly role: ArchitecturalProviderRole }
  | { readonly known: false; readonly role: "UNKNOWN_PROVIDER" };

export type RuntimeNodeLookup =
  | { readonly known: true; readonly node: RuntimeNodeKind }
  | { readonly known: false; readonly node: "UNCLASSIFIED" };

/**
 * Remaining Owner sequence after this contract. Status is declaration only —
 * presence here does not mean the step is implemented.
 */
export const PORTABILITY_SEQUENCE_AFTER_VOCABULARY = [
  "LINUX_CORE_FAIL_CLOSED_MACOS_ROUTES",
  "NON_KEYCHAIN_SECRET_RESOLVER",
  "PROCESS_SUPERVISOR_NOT_LAUNCHD_ONLY",
  "REBIND_REPOSITORY_ROOT_PER_MACHINE",
  "REMOVE_RAILWAY_APP_RUNTIME_ASSUMPTIONS",
  "RAILWAY_OFF_CRITICAL_PATH",
] as const;

export type PortabilitySequenceStep = (typeof PORTABILITY_SEQUENCE_AFTER_VOCABULARY)[number];

const OPTIONAL_COMPUTE_PROVIDERS = new Set(["railway", "vercel"]);

const PROVIDER_ROLES: Readonly<Record<string, ArchitecturalProviderRole>> = {
  railway: "OPTIONAL_PROVIDER",
  vercel: "OPTIONAL_PROVIDER",
  github: "SOURCE_AUTHORITY",
  supabase: "DATA_SERVICE",
  google: "EXTERNAL_ADAPTER",
};

/** Capability-folder prefixes that must not be assumed portable Core. */
const MAC_LOCAL_AGENT_FOLDERS: readonly string[] = [
  "connections/os-ui",
  "control/computer-use-executor",
  "credentials/macos-keychain",
  "control/runtime-control",
  "control/machine-observation",
  "connections/voice-command",
  "local-runtime",
  "control/macos-native-bridge",
];

/** Capability-folder prefixes that are portable Core (Linux-capable logic). */
const CORE_NODE_FOLDERS: readonly string[] = [
  "control/owner-command",
  "control/command-router",
  "control/agent-gateway",
  "software/repository-registry",
  "permissions/write-gate",
  "permissions/execution-policy",
  "control/computer-use-authority",
  "transport/owner-command-http",
  "dna-os-circuit",
  "observability/joint-monitor",
  "connections/dna-os-mcp",
  "credentials/process-environment",
  "credentials/secret-resolver",
];

function normalizeProviderId(providerId: string): string {
  return providerId.trim().toLowerCase();
}

export function lookupProviderArchitecturalRole(providerId: string): ProviderRoleLookup {
  const id = normalizeProviderId(providerId);
  const role = PROVIDER_ROLES[id];
  if (role === undefined) return { known: false, role: "UNKNOWN_PROVIDER" };
  return { known: true, role };
}

export function isOptionalComputeProvider(providerId: string): boolean {
  return OPTIONAL_COMPUTE_PROVIDERS.has(normalizeProviderId(providerId));
}

/**
 * Execution / command-minting authority is DNA OS Core, never a cloud host.
 * Railway, Vercel, GitHub, and Supabase all return false.
 */
export function providerIsExecutionAuthority(_providerId: string): boolean {
  return false;
}

function folderMatches(path: string, prefixes: readonly string[]): boolean {
  const p = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return prefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

export function lookupRuntimeNodeKind(capabilityFolderPath: string): RuntimeNodeLookup {
  const p = capabilityFolderPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (folderMatches(p, MAC_LOCAL_AGENT_FOLDERS)) return { known: true, node: "MAC_LOCAL_AGENT" };
  if (folderMatches(p, CORE_NODE_FOLDERS)) return { known: true, node: "CORE_NODE" };
  return { known: false, node: "UNCLASSIFIED" };
}

export const MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE = "MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE" as const;

export type MacLocalAgentExecutionDecision =
  | { readonly execute: true }
  | {
      readonly execute: false;
      readonly reason_code: typeof MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE;
      readonly required_node: "MAC_LOCAL_AGENT";
      readonly current_node: RuntimeNodeKind;
      readonly execution_attempted: false;
    };

let platformOverrideForTests: string | undefined;

/** Test-only. Production never calls this. Restores to the real host when `undefined`. */
export function setRuntimeNodePlatformForTests(platform: string | undefined): void {
  platformOverrideForTests = platform;
}

export function runtimeNodePlatform(): string {
  if (platformOverrideForTests !== undefined) return platformOverrideForTests;
  if (typeof process !== "undefined" && typeof process.platform === "string") return process.platform;
  return "unknown";
}

/**
 * May this process execute a MAC_LOCAL_AGENT capability (os-ui, Keychain, AX, CGEvent)?
 * Darwin host: yes (Core colocated with the Mac agent). Any other OS: no.
 * Does not mint commands and does not skip caller authorization.
 */
export function macLocalAgentExecutionDecision(input: {
  readonly current_node: RuntimeNodeKind;
  readonly platform?: string;
}): MacLocalAgentExecutionDecision {
  const platform = input.platform ?? runtimeNodePlatform();
  if (platform === "darwin") return { execute: true };
  return {
    execute: false,
    reason_code: MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE,
    required_node: "MAC_LOCAL_AGENT",
    current_node: input.current_node,
    execution_attempted: false,
  };
}

export function canExecuteMacLocalAgentCapability(input: {
  readonly current_node: RuntimeNodeKind;
  readonly platform?: string;
} = { current_node: "CORE_NODE" }): boolean {
  return macLocalAgentExecutionDecision(input).execute === true;
}
