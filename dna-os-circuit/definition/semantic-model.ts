/**
 * หน้าที่: Phase 1, Owner 2026-08-19 — "รวม semantic definitions ที่ปัจจุบัน
 * กระจายอยู่ใน circuit.json, NODE_CATEGORY_MAP และ CapabilityMetadata โดย
 * REUSE schema/type เดิมให้มากที่สุด ห้ามสร้าง registry ซ้ำ". This file
 * creates NO new source of truth — it is a pure, side-effect-free
 * PROJECTION over three already-real, already-evidenced sources:
 *   1. `./circuit.json` (the real, live-tracked topology — nodes/edges/sub_circuits)
 *   2. `./sbgn-view-builder.ts`'s `EDGE_CLASS_MAP`/`CONTAINER_ASSIGNMENTS`/
 *      `VALIDATOR_PORTS` (already-real, already-evidenced classifications —
 *      re-used verbatim, never re-derived)
 *   3. `../../software/capability-registrar/contract.ts`'s `CAPABILITY_INDEX`
 *      (the real, tested registrar index built 2026-08-19)
 *
 * Same discipline as `../../software/capability-registrar/index.ts`: every
 * field is either read straight off one of these three real sources, a
 * mechanical derivation from real edges (inputs/outputs/dependencies), or
 * the literal string `"UNKNOWN"` when no real source proves it — never
 * inferred from a node's name, never AI-authored prose.
 *
 * Input: none (reads circuit.json via resolveJsonModule + the two public
 * modules above at import time).
 * Output: `SemanticComponentType`, `SemanticStatus`, `SemanticComponent`,
 * `SemanticConnection`, `buildSemanticComponents()`, `buildSemanticConnections()`.
 * Dependency ที่อนุญาต: ./circuit.json, ./sbgn-view-builder.ts,
 * ../../software/capability-registrar/contract.ts (public contract only).
 * สิ่งที่ห้ามแตะ: never add a component/connection whose only justification
 * is "node name looks similar" — every non-UNKNOWN field must cite a real
 * file in its own comment or trace to one of the three sources above.
 * Never invent a new top-level topology node/edge here (same rule
 * `./sbgn-view-builder.ts`'s own header already states) — this file only
 * re-describes what already exists, in a richer shape.
 *
 * NOT_YET_BUILT (honest, still true after this file): AGENT and MODEL have
 * zero real components (ai/agent-registry, ai/model-registry are both
 * NOT_YET_BUILT — see this repo's own governance audits); no component has
 * real `business_capability`, `executions`, or `history` evidence yet
 * (Owner, 2026-08-19: keep as GAP, do not block on it); no CONTRACT-type
 * component exists beyond RESULT (the one real node whose backing file is
 * itself a contract, `contracts/command/capability-result.ts`).
 */

import circuitJson from "./circuit.json";
import { CONTAINER_ASSIGNMENTS, EDGE_CLASS_MAP, VALIDATOR_PORTS } from "./sbgn-view-builder";
import { getCapabilityIndex } from "../../software/capability-registrar/contract";
import type { CapabilityMetadata } from "../../software/capability-registrar/contract";

/** Owner's 18 required entity kinds, split from CONNECTION (its own type, see SemanticConnection) and EVIDENCE/STATE (represented as a field + one real STATE component respectively — see buildSemanticComponents' own comments). */
export type SemanticComponentType =
  | "DOMAIN"
  | "SYSTEM"
  | "CAPABILITY"
  | "COMPONENT"
  | "PROCESS"
  | "FUNCTION"
  | "PORT"
  | "CONTRACT"
  | "API"
  | "EVENT"
  | "STORAGE"
  | "RUNTIME"
  | "AGENT"
  | "MODEL"
  | "EXECUTION"
  | "PERMISSION"
  | "EXTERNAL_SERVICE"
  | "STATE";

/** Owner's 11 required values, backward-compatible: circuit.json's own 5-value node status is NEVER modified by this file — this is a SEPARATE, derived field, computed fresh each call from the same real source. */
export type SemanticStatus = "BUILT" | "PARTIAL" | "NOT_BUILT" | "RUNNING" | "STOPPED" | "BROKEN" | "BLOCKED" | "UNKNOWN" | "UNVERIFIED" | "DUPLICATE" | "ORPHAN";

const UNKNOWN = "UNKNOWN" as const;
type Unknown = typeof UNKNOWN;

export interface SemanticComponent {
  component_id: string;
  component_type: SemanticComponentType;
  canonical_name: string;
  parent_id: string | null;
  source_reference: string | Unknown;
  runtime_reference: string | Unknown;
  status: SemanticStatus;
  evidence_reference: string;
  inputs: readonly string[] | Unknown;
  outputs: readonly string[] | Unknown;
  ports: readonly string[] | Unknown;
  contracts: readonly string[] | Unknown;
  dependencies: readonly string[] | Unknown;
  storage: string | Unknown;
  permissions: string | Unknown;
  executions: string | Unknown;
  business_capability: string | Unknown;
  history: string | Unknown;
}

export interface SemanticConnection {
  connection_id: string;
  source_component_id: string;
  source_port: string | Unknown;
  target_component_id: string;
  target_port: string | Unknown;
  connection_type: string | Unknown;
  transport: string | Unknown;
  contract_or_event_or_data: string | Unknown;
  permission_gate: string | Unknown;
  runtime_state: string | Unknown;
  evidence_reference: string;
}

interface CircuitJsonNode {
  id: string;
  label: string;
  default_status: string;
  source_note: string;
}
interface CircuitJsonEdge {
  id: string;
  from: string;
  to: string;
}
interface CircuitJsonSubCircuit {
  nodes: CircuitJsonNode[];
  edges: CircuitJsonEdge[];
}
interface CircuitJsonShape {
  nodes: CircuitJsonNode[];
  edges: CircuitJsonEdge[];
  sub_circuits: Record<string, CircuitJsonSubCircuit>;
}
const circuit = circuitJson as unknown as CircuitJsonShape;

/** circuit.json's real 5-value status -> Owner's 11-value semantic status. 1:1, honest — no new information invented, only re-labeled per Owner's required vocabulary. */
function mapTopologyStatus(circuitStatus: string): SemanticStatus {
  switch (circuitStatus) {
    case "READY":
      return "BUILT";
    case "RUNNING":
      return "RUNNING";
    case "PARTIAL":
      return "PARTIAL";
    case "BLOCKED":
      return "BLOCKED";
    case "NOT_YET_REAL":
      return "NOT_BUILT";
    default:
      return "UNKNOWN"; // an unrecognized circuit.json status value is reported honestly, never guessed
  }
}

/** capability-registrar's real 9-value CapabilityStatus -> Owner's 11-value semantic status, honest 1:1 per each value's own real definition (see software/capability-registrar/types.ts). */
function mapCapabilityStatus(capStatus: CapabilityMetadata["STATUS"]): SemanticStatus {
  switch (capStatus) {
    case "CONNECTED":
    case "RUNNING":
    case "VERIFIED":
      return capStatus === "RUNNING" ? "RUNNING" : "BUILT";
    case "REGISTERED":
    case "BUILT":
      return "PARTIAL";
    case "NOT_BUILT":
      return "NOT_BUILT";
    case "FAILED":
      return "BROKEN";
    case "BLOCKED":
      return "BLOCKED";
    case "UNASSIGNED":
      return "ORPHAN"; // capability-registrar's own definition: "no proven parent — sits outside the Circuit tree", the real meaning of ORPHAN here
    default:
      return "UNKNOWN";
  }
}

/**
 * component_type per real top-level circuit.json node, transcribed from the
 * SAME evidence already cited in ../ui/circuit-board/circuit-board.js's
 * `NODE_CATEGORY_MAP` comments (re-read here, never re-guessed), refined
 * where Owner's new 18-type taxonomy supports a more precise real fit than
 * the old 8-bucket category did (e.g. RESULT's real backing file,
 * `contracts/command/capability-result.ts`, IS a contract file — CONTRACT
 * is a strictly more accurate real fit than the old "OUTPUT" bucket).
 */
const TOP_NODE_TYPE_MAP: Record<string, SemanticComponentType> = {
  INPUT: "EVENT", // conceptual entry signal, no backing module (circuit.json's own source_note)
  OWNER_COMMAND: "CAPABILITY", // control/owner-command/ — real capability folder + public contract.ts
  ENTRY_CONTEXT: "FUNCTION", // control/entry-context/contract.ts resolveEntryContext — resolves/assembles, does not store or route
  IDENTITY: "STORAGE", // permissions/access-control/identity-registry.ts — real store
  ACCOUNT: "STORAGE", // permissions/software-scope/account-registry.ts — real store
  WORKSPACE: "STORAGE", // permissions/software-scope/workspace-registry.ts — real store
  MEMBERSHIP: "STORAGE", // permissions/access-control/membership-registry.ts — real store
  COMMAND_POLICY: "FUNCTION", // execution/run/policy-descriptor.ts — projection function
  EXECUTION_GRANT: "STORAGE", // permissions/execution-policy/grants.ts — real store
  COMMAND_ROUTER: "COMPONENT", // control/command-router/router.ts — real fan-out routing module, no narrower type fits
  PERMISSION: "PERMISSION", // permissions/execution-policy/ — literal type match, real rule evaluation/decision
  EXECUTION: "RUNTIME", // execution/run/executor.ts — spawns a real child_process
  VALIDATOR: "FUNCTION", // NOT_YET_REAL; its intended real role per the fixed topology is a check/computation
  REGISTRY: "STORAGE", // execution/run/registry.ts + capability-registry.ts
  RESULT: "CONTRACT", // contracts/command/capability-result.ts CapabilityResult — literally a contract-defined shape
  OWNER_UI: "COMPONENT", // control/owner-command/owner-command.ts renderOwnerSurface — rendered surface, no narrower type fits
  EXTERNAL_AI: "EVENT", // conceptual entry point, no backing transport yet (circuit.json's own source_note, added 2026-08-19)
  AI_WRITE_CONTROL: "CAPABILITY", // control/ai-write-control/ — real capability folder + public contract.ts
  WRITE_INTENT: "CONTRACT", // contracts/write-intent/write-intent.ts — real contract type, data-artifact node
  CAPABILITY_REGISTRY_INDEX: "STORAGE", // software/capability-registrar/index.ts — real queryable index
  WRITE_GATE: "PERMISSION", // permissions/write-gate/ — real deterministic ALLOW/DENY decision module
  FILE_WRITE_EXECUTION: "EXECUTION", // execution/file-write/ — real gated execution capability
};

function dirnameOf(pathOrLiteral: string): string {
  if (!pathOrLiteral.includes("/")) return UNKNOWN;
  const parts = pathOrLiteral.split("/");
  parts.pop();
  return `${parts.join("/")}/`;
}

/** Real, mechanical derivation from circuit.json's own edges — never invented, never inferred from a name. */
function incomingComponentIds(nodeId: string): string[] {
  return circuit.edges.filter((e) => e.to === nodeId).map((e) => e.from);
}
function outgoingComponentIds(nodeId: string): string[] {
  return circuit.edges.filter((e) => e.from === nodeId).map((e) => e.to);
}

function buildTopLevelComponents(): SemanticComponent[] {
  return circuit.nodes.map((n) => {
    const componentType = TOP_NODE_TYPE_MAP[n.id] ?? "COMPONENT";
    const contracts = n.source_note.includes("contract.ts") || componentType === "CONTRACT" ? [n.source_note] : UNKNOWN;
    return {
      component_id: n.id,
      component_type: componentType,
      canonical_name: n.label,
      parent_id: CONTAINER_ASSIGNMENTS[n.id] ?? "DNA_OS_INFRASTRUCTURE",
      source_reference: n.source_note,
      runtime_reference: UNKNOWN, // circuit.json's live status comes via SSE from ../runtime/circuit-state.ts, not a static file — this static projection cannot know a live runtime handle
      status: mapTopologyStatus(n.default_status),
      evidence_reference: `dna-os-circuit/definition/circuit.json node "${n.id}"`,
      inputs: incomingComponentIds(n.id),
      outputs: outgoingComponentIds(n.id),
      ports: n.id === "VALIDATOR" ? VALIDATOR_PORTS.map((p, index) => `PORT_${p.ownerId}_${index}`) : UNKNOWN,
      contracts,
      dependencies: incomingComponentIds(n.id),
      storage: UNKNOWN,
      permissions: UNKNOWN, // circuit.json's own schema carries no per-node permission field — real gap, not invented
      executions: UNKNOWN,
      business_capability: UNKNOWN, // Owner, 2026-08-19: explicit GAP, no real source in this repo (G-ARCH-001 forbids business data here)
      history: UNKNOWN, // Owner, 2026-08-19: explicit GAP — no git/commit evidence wired into this projection yet
    } satisfies SemanticComponent;
  });
}

function buildSubCircuitComponents(): SemanticComponent[] {
  const out: SemanticComponent[] = [];
  for (const [parentId, sub] of Object.entries(circuit.sub_circuits)) {
    for (const n of sub.nodes) {
      out.push({
        component_id: n.id,
        component_type: "PROCESS", // literal SBGN "process" glyph already assigned to every sub-circuit step — see DNA_OS_VISUAL_LANGUAGE.md
        canonical_name: n.label,
        parent_id: parentId,
        source_reference: n.source_note,
        runtime_reference: UNKNOWN,
        status: mapTopologyStatus(n.default_status),
        evidence_reference: `dna-os-circuit/definition/circuit.json sub_circuits.${parentId} node "${n.id}"`,
        inputs: sub.edges.filter((e) => e.to === n.id).map((e) => e.from),
        outputs: sub.edges.filter((e) => e.from === n.id).map((e) => e.to),
        ports: UNKNOWN,
        contracts: n.source_note.includes("contract.ts") ? [n.source_note] : UNKNOWN,
        dependencies: sub.edges.filter((e) => e.to === n.id).map((e) => e.from),
        storage: UNKNOWN,
        permissions: UNKNOWN,
        executions: UNKNOWN,
        business_capability: UNKNOWN,
        history: UNKNOWN,
      });
    }
  }
  return out;
}

/** Real domain groupings, transcribed verbatim from sbgn-view-builder.ts's own already-evidenced CONTAINER_ASSIGNMENTS — never re-derived, never invented. */
function buildDomainComponents(): SemanticComponent[] {
  const domainIds = [...new Set(Object.values(CONTAINER_ASSIGNMENTS))];
  return domainIds.map((domainId) => ({
    component_id: domainId,
    component_type: "DOMAIN",
    canonical_name: domainId.replace(/_/g, " "),
    parent_id: "DNA_OS_INFRASTRUCTURE",
    source_reference: UNKNOWN, // a domain grouping has no single backing file of its own — it groups real files, doesn't contain one
    runtime_reference: UNKNOWN,
    status: "BUILT", // the grouping itself is a real, checked-in fact (sbgn-view-builder.ts's CONTAINER_ASSIGNMENTS), not a "not built" placeholder
    evidence_reference: "dna-os-circuit/definition/sbgn-view-builder.ts CONTAINER_ASSIGNMENTS",
    inputs: UNKNOWN,
    outputs: UNKNOWN,
    ports: UNKNOWN,
    contracts: UNKNOWN,
    dependencies: Object.entries(CONTAINER_ASSIGNMENTS)
      .filter(([, d]) => d === domainId)
      .map(([memberId]) => memberId),
    storage: UNKNOWN,
    permissions: UNKNOWN,
    executions: UNKNOWN,
    business_capability: UNKNOWN,
    history: UNKNOWN,
  }));
}

/** The one real SYSTEM-level root and the one real STATE component (dna-os-circuit's own live in-memory state store) — both genuinely real, evidenced, singular facts, not invented placeholders. */
function buildSystemAndStateComponents(): SemanticComponent[] {
  return [
    {
      component_id: "DNA_OS_INFRASTRUCTURE",
      component_type: "SYSTEM",
      canonical_name: "DNA-OS-INFRASTRUCTURE",
      parent_id: null,
      source_reference: "README.md",
      runtime_reference: UNKNOWN,
      status: "BUILT",
      evidence_reference: "README.md (repo root)",
      inputs: UNKNOWN,
      outputs: UNKNOWN,
      ports: UNKNOWN,
      contracts: UNKNOWN,
      dependencies: UNKNOWN,
      storage: UNKNOWN,
      permissions: UNKNOWN,
      executions: UNKNOWN,
      business_capability: UNKNOWN,
      history: UNKNOWN,
    },
    {
      component_id: "CIRCUIT_STATE",
      component_type: "STATE",
      canonical_name: "Circuit Live State",
      parent_id: "DNA_OS_INFRASTRUCTURE",
      source_reference: "dna-os-circuit/runtime/circuit-state.ts",
      runtime_reference: "dna-os-circuit/runtime/server.ts GET /events (SSE)",
      status: "BUILT", // real, tested — dna-os-circuit/runtime/tests/circuit-state.test.ts
      evidence_reference: "dna-os-circuit/runtime/circuit-state.ts + dna-os-circuit/runtime/tests/circuit-state.test.ts",
      inputs: UNKNOWN,
      outputs: UNKNOWN,
      ports: UNKNOWN,
      contracts: UNKNOWN,
      dependencies: UNKNOWN,
      storage: UNKNOWN,
      permissions: UNKNOWN,
      executions: UNKNOWN,
      business_capability: UNKNOWN,
      history: UNKNOWN,
    },
  ];
}

/**
 * capability-registrar entries NOT already represented by a real
 * circuit.json top-level node — dedupe is by real cross-reference
 * (capability-registry.ts's own `contract` field), never by name
 * similarity. "execution" and "permission-reasoner" ARE already the real
 * EXECUTION/PERMISSION circuit.json nodes (same contract.ts path — see
 * ../../control/command-router/capability-registry.ts) and are
 * deliberately skipped here to avoid a duplicate node (Owner, 2026-08-19:
 * "ห้าม duplicate node").
 */
const ALREADY_REPRESENTED_CAPABILITY_IDS = new Set(["execution", "permission-reasoner"]);
const CAPABILITY_TYPE_MAP: Record<string, SemanticComponentType> = {
  github: "API", // connections/github/github-adapter.ts — real, tested, read-only external API adapter
  "research-engine": "API", // connections/research-engine/research-engine-adapter.ts — real adapter to an external HTTP service
  digitalocean: "EXTERNAL_SERVICE", // NOT_CONNECTED — real definition/credential scaffolding exists, but not routable (see capability-registry.ts's own comment)
  "file-intelligence": "EXTERNAL_SERVICE", // NOT_CONNECTED — external repo (DNA-LAB-FILE-INTELLIGENCE), not present in this checkout
};

function buildCapabilityRegistrarComponents(): SemanticComponent[] {
  return getCapabilityIndex().filter((c) => !ALREADY_REPRESENTED_CAPABILITY_IDS.has(c.CAPABILITY_ID)).map((c) => ({
    component_id: `CAPREG_${c.CAPABILITY_ID}`,
    component_type: CAPABILITY_TYPE_MAP[c.CAPABILITY_ID] ?? "COMPONENT",
    canonical_name: c.CAPABILITY_ID,
    parent_id: "COMMAND_ROUTER", // real, provable — see software/capability-registrar/index.ts's own header (every CAPABILITY_INDEX entry's real circuit.json parent is COMMAND_ROUTER)
    source_reference: c.CONTRACT,
    runtime_reference: c.RUNTIME_ENTRY ?? UNKNOWN,
    status: mapCapabilityStatus(c.STATUS),
    evidence_reference: c.EVIDENCE_SOURCE.join("; "),
    inputs: UNKNOWN, // no real circuit.json edge exists into this component — honest gap (capability-registry.ts entries are not yet drawn as topology edges)
    outputs: UNKNOWN, // same — no real outgoing edge exists either
    ports: UNKNOWN,
    contracts: [c.CONTRACT],
    dependencies: UNKNOWN,
    storage: UNKNOWN,
    permissions: c.REQUIRED_PERMISSION,
    executions: UNKNOWN,
    business_capability: UNKNOWN,
    history: UNKNOWN,
  }));
}

/** The single public read entry point — every real component this repo can currently prove, from three real sources, zero invented. */
export function buildSemanticComponents(): readonly SemanticComponent[] {
  return [...buildSystemAndStateComponents(), ...buildDomainComponents(), ...buildTopLevelComponents(), ...buildSubCircuitComponents(), ...buildCapabilityRegistrarComponents()];
}

function buildTopLevelConnections(): SemanticConnection[] {
  return circuit.edges.map((e) => {
    const connectionType = EDGE_CLASS_MAP[e.id] ?? UNKNOWN; // an edge added directly to circuit.json but never classified by build-sbgn-view.ts is honestly reported UNKNOWN, never guessed from its id
    // The ONLY real, structurally-provable permission gate in the current topology — see
    // control/command-router/ARCHITECTURE_DECISIONS.md §PERMISSION_BOUNDARY, which documents
    // and tests this exact edge as the real gate crossing point.
    const permissionGate = e.id === "e_permission_execution" ? "permissions/execution-policy/contract.ts evaluateExecutionPermission (see control/command-router/ARCHITECTURE_DECISIONS.md §PERMISSION_BOUNDARY)" : UNKNOWN;
    return {
      connection_id: e.id,
      source_component_id: e.from,
      source_port: UNKNOWN,
      target_component_id: e.to,
      target_port: UNKNOWN,
      connection_type: connectionType,
      transport: UNKNOWN, // real gap — no per-edge transport/protocol field exists anywhere in circuit.json or sbgn-view-builder.ts
      contract_or_event_or_data: UNKNOWN,
      permission_gate: permissionGate,
      runtime_state: UNKNOWN, // live IDLE/ACTIVE state is tracked by ../runtime/circuit-state.ts over a live SSE connection — this static projection has no live connection, so it cannot know current state
      evidence_reference: `dna-os-circuit/definition/circuit.json edge "${e.id}"${EDGE_CLASS_MAP[e.id] ? ` + dna-os-circuit/definition/sbgn-view-builder.ts EDGE_CLASS_MAP["${e.id}"]` : " (no EDGE_CLASS_MAP entry — never classified)"}`,
    } satisfies SemanticConnection;
  });
}

function buildSubCircuitConnections(): SemanticConnection[] {
  const out: SemanticConnection[] = [];
  for (const [parentId, sub] of Object.entries(circuit.sub_circuits)) {
    for (const e of sub.edges) {
      out.push({
        connection_id: e.id,
        source_component_id: e.from,
        source_port: UNKNOWN,
        target_component_id: e.to,
        target_port: UNKNOWN,
        connection_type: EDGE_CLASS_MAP[e.id] ?? UNKNOWN,
        transport: UNKNOWN,
        contract_or_event_or_data: UNKNOWN,
        permission_gate: UNKNOWN,
        runtime_state: UNKNOWN,
        evidence_reference: `dna-os-circuit/definition/circuit.json sub_circuits.${parentId} edge "${e.id}"${EDGE_CLASS_MAP[e.id] ? ` + EDGE_CLASS_MAP["${e.id}"]` : " (no EDGE_CLASS_MAP entry)"}`,
      });
    }
  }
  return out;
}

/**
 * VALIDATOR's port-to-owner edges — the ONLY place a real `source_port`/
 * `target_port` value can be filled, because VALIDATOR_PORTS is the only
 * real, structurally-encoded port data in this repo. These edges connect a
 * PORT-type component to its owner (VALIDATOR), NOT one component's port
 * to ANOTHER component's port — Owner's requested
 * "Component.output_port → Connection → Component.input_port" full
 * cross-component path does not exist in the real topology today (see
 * DNA_OS_VISUAL_LANGUAGE.md §PORT_MODEL: ports are documented satellite
 * approximations, never claimed as verified). Reported honestly as
 * PORT_UNVERIFIED in the Phase 1 report, not fabricated into a false
 * cross-component port path.
 */
function buildValidatorPortConnections(): SemanticConnection[] {
  // id scheme MUST match ./sbgn-view-builder.ts's buildPortElements() exactly (index-based,
  // `PORT_<ownerId>_<index>` / `PORT_EDGE_<portId>`) — this is the same real function that
  // builds the port nodes/edges the browser actually renders, so a connection_id/component_id
  // computed any other way would silently fail to match a real on-canvas element.
  return VALIDATOR_PORTS.map((p, index) => {
    const portComponentId = `PORT_${p.ownerId}_${index}`;
    const isInput = p.direction === "input";
    return {
      connection_id: `PORT_EDGE_${portComponentId}`,
      source_component_id: isInput ? portComponentId : p.ownerId,
      source_port: isInput ? p.portName : UNKNOWN,
      target_component_id: isInput ? p.ownerId : portComponentId,
      target_port: isInput ? UNKNOWN : p.portName,
      connection_type: UNKNOWN, // sbgn-view-builder.ts's buildPortElements() deliberately omits an SBGN `class` on port-connector edges (a plain line, no arrowhead) — honestly UNKNOWN, not invented
      transport: UNKNOWN,
      contract_or_event_or_data: UNKNOWN,
      permission_gate: UNKNOWN,
      runtime_state: UNKNOWN,
      evidence_reference: "dna-os-circuit/definition/sbgn-view-builder.ts VALIDATOR_PORTS (documented approximation — see dna-os-circuit/DNA_OS_VISUAL_LANGUAGE.md §PORT_MODEL, PORT_UNVERIFIED)",
    } satisfies SemanticConnection;
  });
}

/** The single public read entry point for connections — every real edge this repo can currently prove, zero invented, zero inferred from a name. */
export function buildSemanticConnections(): readonly SemanticConnection[] {
  return [...buildTopLevelConnections(), ...buildSubCircuitConnections(), ...buildValidatorPortConnections()];
}

/**
 * Owner's 5-tier semantic zoom hierarchy (2026-08-19): "Domain/System →
 * Capability → Component/Process → Function/Port/Connection/API/Storage →
 * Contract/Runtime/Evidence/Source". A pure, mechanical mapping from each
 * REAL `SemanticComponentType` already assigned above — never a guessed
 * per-node tier. "ระดับที่ไม่มีข้อมูลจริงไม่ต้องแสดง" (a tier with zero
 * real components simply has zero entries — see
 * ./tests/semantic-model.test.ts for the real per-tier counts).
 */
export type SemanticLodTier = "DOMAIN_SYSTEM" | "CAPABILITY" | "COMPONENT_PROCESS" | "FUNCTION_PORT_CONNECTION_API_STORAGE" | "CONTRACT_RUNTIME_EVIDENCE_SOURCE";

const LOD_TIER_MAP: Record<SemanticComponentType, SemanticLodTier> = {
  DOMAIN: "DOMAIN_SYSTEM",
  SYSTEM: "DOMAIN_SYSTEM",
  CAPABILITY: "CAPABILITY",
  COMPONENT: "COMPONENT_PROCESS",
  PROCESS: "COMPONENT_PROCESS",
  FUNCTION: "FUNCTION_PORT_CONNECTION_API_STORAGE",
  PORT: "FUNCTION_PORT_CONNECTION_API_STORAGE",
  API: "FUNCTION_PORT_CONNECTION_API_STORAGE",
  STORAGE: "FUNCTION_PORT_CONNECTION_API_STORAGE",
  EVENT: "FUNCTION_PORT_CONNECTION_API_STORAGE",
  RUNTIME: "CONTRACT_RUNTIME_EVIDENCE_SOURCE",
  CONTRACT: "CONTRACT_RUNTIME_EVIDENCE_SOURCE",
  AGENT: "COMPONENT_PROCESS",
  MODEL: "COMPONENT_PROCESS",
  EXECUTION: "COMPONENT_PROCESS",
  PERMISSION: "COMPONENT_PROCESS",
  EXTERNAL_SERVICE: "CAPABILITY",
  STATE: "CONTRACT_RUNTIME_EVIDENCE_SOURCE",
};

/** Real, deterministic — the same component always resolves to the same tier every call, no randomness, no per-render recomputation drift. */
export function lodTierOf(component: Pick<SemanticComponent, "component_type">): SemanticLodTier {
  return LOD_TIER_MAP[component.component_type];
}
