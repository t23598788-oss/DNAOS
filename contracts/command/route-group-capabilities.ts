/**
 * หน้าที่: the ONE canonical definition of the ten routing groups, and the
 * SEARCH ORDER each group uses to find its owning capability. A leaf
 * contract: no imports, no behaviour, no I/O.
 *
 * WHY THIS FILE EXISTS AT ALL. Two places need to answer "which capability
 * owns this route group": `connections/n8n/event-router.ts`, which resolves
 * an owner before dispatching, and `control/agent-gateway/`'s capability
 * resolver, which must reach the same answer when a task arrives carrying a
 * route group. Keeping a copy in each would be two mappings that drift, and a
 * drifted mapping means the router and the gateway silently disagree about
 * who owns a failure. It cannot live in either folder either: the gateway
 * already imports nothing from `connections/`, and `connections/n8n/` imports
 * `submitTask` from the gateway — putting the map in one would create a real
 * import cycle. A leaf contract both may depend on is the only shape with no
 * cycle and no duplicate.
 *
 * A SEARCH ORDER IS NOT AN ANSWER. Every identifier below is a candidate to
 * LOOK UP, never a capability to use. Both consumers resolve each candidate
 * against real registries — `control/command-router/`'s CAPABILITY_REGISTRY,
 * the persistent software registry, and the gateway's own capability index —
 * and take only one that actually exists. A group whose candidates all fail
 * to resolve yields UNRESOLVED_OWNER / NO_EXISTING_CAPABILITY, which is a
 * real answer naming a real gap. Nothing here grants anything.
 *
 * ORDER IS MOST-SPECIFIC-FIRST so a group with a dedicated owner never falls
 * through to a general one.
 *
 * Input: none (pure data + types).
 * Output: `RouteGroup`, `ROUTE_GROUPS`, `GROUP_CAPABILITY_SEARCH_ORDER`.
 * Dependency ที่อนุญาต: none — a leaf contract, same discipline as
 * `./routing-result.ts` and `../identity/envelope-identity.ts`.
 * สิ่งที่ห้ามแตะ: never add a candidate that no registry contains — an
 * unresolvable entry is dead weight that hides a real gap behind a plausible
 * name. Never add a fallback that matches every group; a group with no owner
 * must stay unowned until one is registered.
 */

/** The ten canonical routing groups. Closed set. */
export type RouteGroup =
  | "OWNER_COMMAND"
  | "RUNTIME_ERROR"
  | "SECURITY_POLICY"
  | "SOFTWARE_CODE"
  | "INFRASTRUCTURE"
  | "DATABASE_DATA"
  | "RESOURCE_COMPUTE"
  | "COST_BILLING"
  | "EXTERNAL_INTEGRATION"
  | "EVIDENCE_VERIFICATION";

export const ROUTE_GROUPS: readonly RouteGroup[] = [
  "OWNER_COMMAND", "RUNTIME_ERROR", "SECURITY_POLICY", "SOFTWARE_CODE", "INFRASTRUCTURE",
  "DATABASE_DATA", "RESOURCE_COMPUTE", "COST_BILLING", "EXTERNAL_INTEGRATION", "EVIDENCE_VERIFICATION",
];

/**
 * Candidates to look up, per group, most-specific first.
 *
 * The identifiers span more than one registry on purpose, because the
 * registries genuinely hold different things: `control/command-router/`'s
 * registry keys capabilities by routable id (`permission-reasoner`,
 * `github`), the gateway's own index keys them by `problem_type`
 * (`permission_or_execution_authorization_decision`), and the persistent
 * software registry keys them by canonical name
 * (`real-work-resource-cost-measurement`). A resolver tries each candidate
 * against every registry it can read and reports WHICH one answered, so a
 * match is always traceable to the row that produced it.
 */
export const GROUP_CAPABILITY_SEARCH_ORDER: Readonly<Record<RouteGroup, readonly string[]>> = {
  OWNER_COMMAND: ["dispatcher", "execution", "external_system_lifecycle_registration"],
  RUNTIME_ERROR: ["agent-host", "sandboxed_agent_process_execution", "server_hang_or_timeout", "execution"],
  SECURITY_POLICY: ["permission-reasoner", "permission_or_execution_authorization_decision", "capability_ownership_write_authorization"],
  SOFTWARE_CODE: ["file-intelligence", "file_duplicate_or_orphan_detection", "codebase_dependency_graph_analysis", "github"],
  INFRASTRUCTURE: ["digitalocean", "execution", "server_hang_or_timeout"],
  DATABASE_DATA: ["research-engine", "engineering_bottleneck_measurement_via_monitor-ui_dashboard"],
  RESOURCE_COMPUTE: ["real-work-resource-cost-measurement", "research-engine", "engineering_bottleneck_measurement_via_monitor-ui_dashboard"],
  COST_BILLING: ["infrastructure-billing", "real-work-resource-cost-measurement", "research-engine"],
  EXTERNAL_INTEGRATION: ["owner-event-agent-router", "github", "digitalocean", "external_system_lifecycle_registration"],
  EVIDENCE_VERIFICATION: ["error-driven-repair-loop", "research-engine", "dna-os-circuit"],
};
