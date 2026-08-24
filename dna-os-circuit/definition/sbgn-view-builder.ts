/**
 * หน้าที่: pure, side-effect-free functions that turn the existing honest
 * topology (`./circuit.json`) into an SBGN-flavoured RENDERING graph
 * (`./circuit-sbgn.json`). This file changes nothing about truth: it
 * consumes the same node/edge ids already declared in circuit.json and
 * only ADDS presentation data — `class`, `stateVariables: []`,
 * `unitsOfInformation: []`, `clonemarker: false`, `parent`, plus a small
 * number of purely-visual satellite "port" nodes and compound container
 * nodes that carry NO live status (they are never passed to
 * `CircuitState.updateNode`, so `../runtime/circuit-state.ts`'s strict
 * "unknown id" guard is never touched by them).
 *
 * Run once via `npx tsx dna-os-circuit/definition/build-sbgn-view.ts` to
 * regenerate `./circuit-sbgn.json` (checked in as a static file — the
 * plain Node http server in `../runtime/server.ts` only ever serves
 * static files, so there is no TS-at-runtime dependency for the UI).
 *
 * Dependency ที่อนุญาต: none (pure functions over the parsed
 * circuit.json object passed in by the caller).
 * สิ่งที่ห้ามแตะ: never invent a new top-level topology node here — only
 * the honest port/container/sub-circuit elaborations documented in
 * dna-os-circuit/DNA_OS_VISUAL_LANGUAGE.md are allowed.
 */

export interface SbgnNode {
  data: {
    id: string;
    class: string;
    label: string;
    parent?: string;
    clonemarker: boolean;
    stateVariables: unknown[];
    unitsOfInformation: unknown[];
    /** true for nodes that are pure rendering elements (ports/containers) and are never live-status-updated via CircuitState. */
    sbgnPresentationOnly?: boolean;
    /** Verbatim from circuit.json's own `source_note` field (real file/module/function evidence) — passed through untouched so the side panel can show it; never generated or reworded here. */
    source_note?: string;
  };
}

export interface SbgnEdge {
  data: {
    id: string;
    class?: string;
    source: string;
    target: string;
    cardinality?: number;
  };
}

/** SBGN PD glyph class assigned to each real DNA OS semantic node type — see DNA_OS_VISUAL_LANGUAGE.md §DNA_OS_SYMBOL_MAPPING for the justification of each choice. */
export const NODE_CLASS_MAP: Record<string, string> = {
  INPUT: "simple chemical",
  // Same "EVENT" semantic type as INPUT (semantic-model.ts's
  // TOP_NODE_TYPE_MAP — "conceptual entry point, no backing transport
  // yet") — same glyph for the same reason. Missing entry, real bug found
  // live 2026-08-24 (peer review): semantic-model.ts added this node
  // without this map being updated, so building a view for it threw.
  EXTERNAL_AI: "simple chemical",
  OWNER_COMMAND: "macromolecule",
  // ENTRY_CONTEXT resolves/assembles Identity+Account+Workspace+Membership+CommandPolicy+Grant
  // before permission evaluation — an active resolution step, same conceptual role as
  // VALIDATOR's "process" glyph (a real function that does a check/resolution), not a
  // passive data record.
  ENTRY_CONTEXT: "process",
  IDENTITY: "nucleic acid feature",
  // ACCOUNT/WORKSPACE/MEMBERSHIP/EXECUTION_GRANT are all real, in-memory REGISTRY-backed
  // facts (permissions/software-scope/account-registry.ts, workspace-registry.ts,
  // permissions/access-control/membership-registry.ts, permissions/execution-policy/
  // grants.ts) — same conceptual role as IDENTITY/REGISTRY's existing "nucleic acid
  // feature" classification (an informational/store-backed node, not an active process).
  ACCOUNT: "nucleic acid feature",
  WORKSPACE: "nucleic acid feature",
  MEMBERSHIP: "nucleic acid feature",
  // COMMAND_POLICY is a real callable descriptor projection (execution/run/
  // policy-descriptor.ts projectCommandPolicyDescriptor) — same conceptual role as
  // EXEC_COMMAND_DESCRIPTOR's existing "macromolecule" classification below.
  COMMAND_POLICY: "macromolecule",
  EXECUTION_GRANT: "nucleic acid feature",
  // PERMISSION is rendered as `complex` (not `process`) because, like EXECUTION, it is
  // ALSO used as the compound container for its own real sub-circuit (step 5) — `process`
  // (25x25, no compound-sizing rule) is not a safe compound-parent shape in this
  // stylesheet, only `complex`/`compartment` get `compound-sizing-wrt-labels: exclude`
  // (see index.js) and are the classes the reference demo.json itself uses for every
  // node that has children. See DNA_OS_VISUAL_LANGUAGE.md for the full justification.
  PERMISSION: "complex",
  COMMAND_ROUTER: "association",
  EXECUTION: "complex",
  VALIDATOR: "process",
  REGISTRY: "nucleic acid feature",
  RESULT: "tag",
  OWNER_UI: "macromolecule",
  // The next 5 entries were also missing (real bug found live 2026-08-24,
  // same cause as EXTERNAL_AI above — semantic-model.ts's TOP_NODE_TYPE_MAP
  // grew these nodes without this map being updated, and this function
  // throws on the FIRST missing entry, so fixing EXTERNAL_AI alone just
  // surfaced the next one). Each mapped to the same glyph already used for
  // its same semantic type elsewhere in this file.
  AI_WRITE_CONTROL: "macromolecule", // CAPABILITY, same as OWNER_COMMAND
  WRITE_INTENT: "tag", // CONTRACT, same as RESULT
  CAPABILITY_REGISTRY_INDEX: "nucleic acid feature", // STORAGE, same as REGISTRY/IDENTITY
  WRITE_GATE: "complex", // PERMISSION, same as PERMISSION
  FILE_WRITE_EXECUTION: "complex", // EXECUTION, same as EXECUTION
  // Also missing (found running this file's own test to completion after
  // the fixes above, 2026-08-24) — these 4 are real circuit.json top-level
  // nodes with no TOP_NODE_TYPE_MAP entry at all (a separate, independently
  // -maintained classification in semantic-model.ts), so they were never
  // caught by that map either. Mapped from each node's own real
  // source_note/label, matching the closest existing convention below.
  WORLD_EVIDENCE: "nucleic acid feature", // data/registry artifact (reports/phase16-world-evidence/*.json), same reasoning as REGISTRY/IDENTITY
  CONNECTOR_EXECUTION_BOUNDARY: "association", // generic routing/DI seam control/command-router reaches through, same reasoning as COMMAND_ROUTER
  DIGITALOCEAN_CONNECTOR: "macromolecule", // an active connector module, same reasoning as DO_CONNECTOR below
  SOURCE_REGISTRY: "nucleic acid feature", // providers/_shared/source-registry/ — a real store, same reasoning as REGISTRY
  // PERMISSION sub-circuit
  PERM_IDENTITY_CHECK: "process",
  PERM_ACCOUNT_CHECK: "process",
  PERM_WORKSPACE_CHECK: "process",
  PERM_COMMAND_CHECK: "process",
  PERM_CAPABILITY_CHECK: "process",
  PERM_ACTION_CHECK: "process",
  PERM_CWD_SCOPE_CHECK: "process",
  PERM_GRANT_RESOLUTION: "process",
  PERM_TERMINAL: "or",
  // EXECUTION sub-circuit
  EXEC_COMMAND_DESCRIPTOR: "macromolecule",
  EXEC_GRANT_RESOLUTION: "process",
  EXEC_POLICY_EVALUATION: "process",
  EXEC_START_EXECUTION: "process",
  EXEC_PROCESS_RUNTIME: "macromolecule",
  EXEC_OUTPUT_SANITIZATION: "process",
  EXEC_INTEGRITY_CHECK: "process",
  EXEC_EXECUTION_RESULT: "tag",
  // DigitalOcean connector branch, attached under EXECUTION 2026-08-17 (Owner: "attach completed
  // DigitalOcean branch to the live tree") — same real/not-real honesty as every other node here,
  // see circuit.json's own source_note per id for the evidence behind each class choice.
  DO_CREDENTIAL_BINDING: "process", // a resolution/check step, same reasoning as EXEC_GRANT_RESOLUTION
  DO_CONNECTOR: "macromolecule", // an active running module, same reasoning as EXEC_COMMAND_DESCRIPTOR/EXEC_PROCESS_RUNTIME
  DO_API_CALL: "process",
  DO_RESULT_EVIDENCE: "tag", // terminal result, same reasoning as EXEC_EXECUTION_RESULT
};

/** SBGN PD arc class assigned to each DNA OS semantic edge type — see DNA_OS_VISUAL_LANGUAGE.md §EDGE_TYPES. Only classes cytoscape-sbgn-stylesheet actually renders (verified from source): necessary stimulation, production, consumption, stimulation, catalysis, inhibition. */
export const EDGE_CLASS_MAP: Record<string, string> = {
  e_input_owner_command: "necessary stimulation", // COMMAND
  // 2026-08-16: the Owner->Identity->Permission->Router chain was replaced by the real
  // Account/Workspace gap-closure chain below (control/entry-context/resolver.ts). Old
  // edge ids (e_owner_command_identity, e_identity_permission, e_permission_router in its
  // old PERMISSION->ROUTER direction, e_router_execution) no longer exist in circuit.json
  // and are intentionally left out of this map — decorateEdge only looks up ids that are
  // actually present in circuit.json's current edge list.
  e_owner_command_entry_context: "necessary stimulation", // COMMAND — owner command forwarded into entry-context resolution
  e_entry_context_identity: "consumption", // DATA — entry-context resolves the real Identity
  e_identity_account: "consumption", // DATA — chain continues to Account resolution
  e_account_workspace: "consumption", // DATA — chain continues to Workspace resolution (cross-account checked)
  e_workspace_membership: "consumption", // DATA — chain continues to Membership resolution (filtered against real Account/Workspace)
  e_membership_command_policy: "consumption", // DATA — chain continues to CommandPolicy resolution
  e_command_policy_execution_grant: "consumption", // DATA — chain continues to ExecutionGrant resolution
  e_execution_grant_router: "necessary stimulation", // COMMAND — fully resolved context handed to the router to actually dispatch
  e_router_permission: "necessary stimulation", // COMMAND — router dispatches to the real permission evaluation (routeOwnerCommand classifies first, then runExecutionStep evaluates permission — verified in router.ts)
  e_permission_execution: "stimulation", // PERMISSION (gate passed) — same "gate passed" semantics the old e_permission_router edge carried, now on the correct Permission->Execution leg
  e_router_validator: "inhibition", // BLOCK — VALIDATOR is NOT_YET_REAL, honestly drawn as a blocked route
  e_router_registry: "catalysis", // DEPENDENCY
  e_execution_result: "production", // RESPONSE
  e_validator_result: "catalysis", // DEPENDENCY (validator's contribution is auxiliary/supportive, not a hard block, matching catalysis's "supports the reaction" semantics)
  e_registry_result: "catalysis", // DEPENDENCY
  e_result_owner_ui: "production", // RESPONSE
  // PERMISSION sub-circuit — DATA checks feeding one another
  sp_wellformed_identity: "consumption",
  sp_account_workspace: "consumption",
  sp_workspace_command: "consumption",
  sp_command_capability: "consumption",
  sp_capability_action: "consumption",
  sp_action_cwd: "consumption",
  sp_cwd_grant: "consumption",
  sp_grant_terminal: "necessary stimulation",
  // EXECUTION sub-circuit
  se_descriptor_grant: "consumption",
  se_grant_policy: "necessary stimulation",
  se_policy_start: "necessary stimulation",
  se_start_process: "necessary stimulation",
  se_process_sanitize: "production",
  se_sanitize_integrity: "production",
  se_integrity_result: "production",
  // DigitalOcean connector branch (see NODE_CLASS_MAP's matching comment above).
  se_do_descriptor_binding: "consumption", // DATA — command classification data feeds the binding lookup, same reasoning as se_descriptor_grant
  se_do_binding_connector: "necessary stimulation", // COMMAND — a resolved+authorized binding is required before the connector proceeds, same reasoning as se_grant_policy
  se_do_connector_api: "necessary stimulation", // COMMAND — the connector directs the real API call
  se_do_api_result: "production", // RESPONSE — the API call produces the result, same reasoning as se_process_sanitize
  // The following 10 were also missing (found running this file's own test
  // to completion, 2026-08-24, same root cause as NODE_CLASS_MAP above —
  // circuit.json grew these edges without this map being updated).
  e_external_ai_ai_write_control: "necessary stimulation", // COMMAND — external AI request forwarded into the write-control capability, same reasoning as e_input_owner_command
  e_ai_write_control_write_intent: "production", // RESPONSE — write control produces the real WriteIntent contract
  e_write_intent_capability_registry: "consumption", // DATA — the intent is checked against the real capability registry index, same reasoning as e_entry_context_identity
  e_capability_registry_write_gate: "consumption", // DATA — registry lookup result feeds the gate's decision, chain continuation
  e_write_gate_file_write_execution: "stimulation", // PERMISSION (gate passed) — same semantics as e_permission_execution
  e_input_world_evidence: "necessary stimulation", // COMMAND — same reasoning as e_input_owner_command
  e_world_evidence_result: "production", // RESPONSE — same reasoning as e_execution_result/e_result_owner_ui
  e_router_connector_boundary: "necessary stimulation", // COMMAND — router dispatches to the boundary, same reasoning as e_router_permission
  e_connector_boundary_digitalocean: "necessary stimulation", // COMMAND — boundary forwards to the specific connector, same reasoning
  e_source_registry_registry: "production", // RESPONSE — real SourcePointers registered INTO the Persistent Software Registry (circuit.json's own source_note)
};

/** DNA OS domain container groupings — honest, minimal, drawn only from the real fixed top-level topology (never invented). */
export const CONTAINER_ASSIGNMENTS: Record<string, string> = {
  // 2026-08-16: real, in-memory registry-backed resolution chain owned end-to-end by
  // control/entry-context/resolver.ts (see reports/ACCOUNT_WORKSPACE_RESOLUTION_REPORT.md)
  // — grouped together because they are resolved as one unit before routing/permission,
  // not because they are visually convenient. ENTRY_CONTEXT is deliberately excluded from
  // its own domain box (it is the resolver, not one of the resolved facts).
  IDENTITY: "ENTRY_CONTEXT_DOMAIN",
  ACCOUNT: "ENTRY_CONTEXT_DOMAIN",
  WORKSPACE: "ENTRY_CONTEXT_DOMAIN",
  MEMBERSHIP: "ENTRY_CONTEXT_DOMAIN",
  COMMAND_POLICY: "ENTRY_CONTEXT_DOMAIN",
  EXECUTION_GRANT: "ENTRY_CONTEXT_DOMAIN",
  PERMISSION: "PERMISSION_DOMAIN",
  EXECUTION: "EXECUTION_DOMAIN",
  VALIDATOR: "EXECUTION_DOMAIN",
  REGISTRY: "EXECUTION_DOMAIN",
};

export interface PortSpec {
  ownerId: string;
  portName: string;
  direction: "input" | "output";
}

/** The VALIDATOR node's logical ports, read off VALIDATOR's real place in the fixed topology (fan-in from COMMAND_ROUTER, fan-out to RESULT) plus the honest checks a real validator would need — documented as an approximation in DNA_OS_VISUAL_LANGUAGE.md §PORT_MODEL, not native cytoscape-sbgn-stylesheet port support. */
export const VALIDATOR_PORTS: PortSpec[] = [
  { ownerId: "VALIDATOR", portName: "input:data", direction: "input" },
  { ownerId: "VALIDATOR", portName: "input:evidence", direction: "input" },
  { ownerId: "VALIDATOR", portName: "input:policy", direction: "input" },
  { ownerId: "VALIDATOR", portName: "output:pass", direction: "output" },
  { ownerId: "VALIDATOR", portName: "output:fail", direction: "output" },
  { ownerId: "VALIDATOR", portName: "output:owner_review", direction: "output" },
];

function blankAux(): Pick<SbgnNode["data"], "clonemarker" | "stateVariables" | "unitsOfInformation"> {
  return { clonemarker: false, stateVariables: [], unitsOfInformation: [] };
}

/** Builds one satellite port node + one short fixed connecting edge per PortSpec. Pure function, no ids collide with real topology ids (prefixed `PORT_`). */
export function buildPortElements(specs: PortSpec[]): { nodes: SbgnNode[]; edges: SbgnEdge[] } {
  const nodes: SbgnNode[] = [];
  const edges: SbgnEdge[] = [];
  specs.forEach((spec, index) => {
    const portId = `PORT_${spec.ownerId}_${index}`;
    nodes.push({
      data: {
        id: portId,
        class: "unspecified entity",
        label: spec.portName,
        // A port belongs to the SAME domain container as its owner (if any) — real
        // structural containment (cytoscape's own compound bounding-box fit includes it),
        // not just a visually-close position that happens not to stray outside the box.
        // Without this, a domain's real children (e.g. VALIDATOR) keep the container honest,
        // but VALIDATOR's own ports had no compound relationship at all and could render
        // anywhere, including outside the box that visually "owns" them.
        parent: CONTAINER_ASSIGNMENTS[spec.ownerId],
        ...blankAux(),
        sbgnPresentationOnly: true,
      },
    });
    const edgeId = `PORT_EDGE_${portId}`;
    if (spec.direction === "input") {
      edges.push({ data: { id: edgeId, source: portId, target: spec.ownerId } });
    } else {
      edges.push({ data: { id: edgeId, source: spec.ownerId, target: portId } });
    }
  });
  return { nodes, edges };
}

/** Builds the compound container nodes implied by CONTAINER_ASSIGNMENTS. */
export function buildContainerNodes(assignments: Record<string, string>): SbgnNode[] {
  const seen = new Set<string>();
  const nodes: SbgnNode[] = [];
  for (const containerId of Object.values(assignments)) {
    if (seen.has(containerId)) continue;
    seen.add(containerId);
    nodes.push({
      data: {
        id: containerId,
        class: "compartment",
        label: containerId.replace(/_/g, " "),
        ...blankAux(),
        sbgnPresentationOnly: true,
      },
    });
  }
  return nodes;
}

/** Assigns `class`, aux-item fields, and `parent` (container or sub-circuit parent) to one real topology node. */
export function decorateNode(id: string, label: string, opts: { parent?: string; sourceNote?: string } = {}): SbgnNode {
  const cls = NODE_CLASS_MAP[id];
  if (!cls) throw new Error(`sbgn-view-builder: no NODE_CLASS_MAP entry for real node id "${id}"`);
  return {
    data: {
      id,
      class: cls,
      label,
      parent: opts.parent ?? CONTAINER_ASSIGNMENTS[id],
      ...(opts.sourceNote ? { source_note: opts.sourceNote } : {}),
      ...blankAux(),
    },
  };
}

/** Assigns SBGN `class` to one real topology edge. Throws (never silently guesses) if a real edge id has no mapping — keeps the mapping table honest and complete. */
export function decorateEdge(id: string, source: string, target: string): SbgnEdge {
  const cls = EDGE_CLASS_MAP[id];
  if (!cls) throw new Error(`sbgn-view-builder: no EDGE_CLASS_MAP entry for real edge id "${id}"`);
  return { data: { id, class: cls, source, target } };
}
