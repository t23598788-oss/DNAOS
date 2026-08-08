/**
 * scripts/build-system-control-graph.ts
 *
 * Owner Architecture Control Surface generator (2026-08-04). Per Rule 103
 * (Reuse Before Build), this does NOT re-walk source files or recompute the
 * import graph — that is already done by scripts/build-arch-book.ts and
 * written to registry/architecture-book.json. This script READS that file
 * plus the other already-real registries (commands/events/capabilities/
 * infrastructure/drivers/connector-lifecycle/health-report) and cross-
 * references them into one unified control graph for the
 * /admin/architecture "System Control Surface" UI (4 modes: Map / Runtime
 * Flow / Health & Drift / Infrastructure).
 *
 * Hard rule (owner, explicit): no fabricated relationships or fields. Every
 * node/edge here traces to a real field in a real source registry. Where no
 * real registry exists yet (AI Model / Compute Provider / Server-Pod), this
 * script does NOT invent one — it records the gap explicitly in
 * unknown_dimensions and NOT_IMPLEMENTED nodes are never emitted as if real.
 *
 * Output:
 *   registry/system-control-graph.json   — { generated_at, nodes, edges, summary, sources, unknown_dimensions }
 *   registry/system-control-summary.json — dashboard-sized counts only
 *
 * Fails loudly (non-zero exit, clear stderr) if a required source registry
 * is missing or malformed — never silently writes a partial graph.
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const REGISTRY_DIR = path.join(ROOT, "registry");

type AnyRec = Record<string, unknown>;

interface RequiredSource {
  key: string;
  file: string; // relative to registry/
  required: boolean;
}

// Real, minimal shapes of the fields this generator actually reads from
// each source registry — loosely typed with optional fields since these are
// external JSON files this script defensively tolerates being malformed
// (see the structural sanity checks below), never assumed complete.
interface ArchBookNode {
  id: string;
  type?: string;
  name_en?: string;
  layer?: string;
  status?: string;
  runtime_entry_point?: boolean;
  internal_dependencies?: string[];
  dependents?: string[];
  business_capabilities?: string[] | "UNKNOWN";
}
interface ArchBookEdge { source?: string; target?: string; label?: string }
interface ArchBookFile { nodes: ArchBookNode[]; edges: ArchBookEdge[]; summary?: unknown }
interface ModuleRegistryFile { modules: Record<string, unknown> }
interface CommandEntry { owner?: string; layer?: string }
interface CommandRegistryFile { commands: Record<string, CommandEntry> }
interface EventEntry { source?: string }
interface EventsFile { events: Record<string, EventEntry> }
interface CapabilityEntry { CapabilityId?: string; Category?: string; OwnerModule?: string; Version?: string | number }
interface CapabilityRegistryFile { capabilities: CapabilityEntry[] | Record<string, CapabilityEntry> }
interface InfraServiceEntry { name?: string; status?: string; cost_monthly_thb?: number; dependency_graph?: { modules?: string[] } }
interface InfrastructureFile { services: Record<string, InfraServiceEntry> }
interface DriverEntry { id?: string; module?: string; status?: string; platform?: string }
interface DriversFile { drivers: DriverEntry[] | Record<string, DriverEntry> }
interface ConnectorLifecycleFile { stages: string[]; status?: string }
interface HealthReportFile { registry_completeness_pct?: number; circular_dependencies?: number; duplicate_registrations?: { count?: number } }

// Every registry this generator reads. `required:true` ones abort the run
// if missing/malformed (per the "fail loudly" contract) — `required:false`
// ones (health report) degrade gracefully because build-arch-book.ts /
// arch-health-report.ts may not have been run yet in a fresh checkout, and
// their absence doesn't invalidate the rest of the graph.
const SOURCES: RequiredSource[] = [
  { key: "archBook", file: "architecture-book.json", required: true },
  { key: "moduleRegistry", file: "module-registry.json", required: true },
  { key: "commandRegistry", file: "command-registry.json", required: true },
  { key: "events", file: "events.json", required: true },
  { key: "capabilityRegistry", file: "capability-registry.json", required: true },
  { key: "infrastructure", file: "infrastructure.json", required: true },
  { key: "drivers", file: "drivers.json", required: true },
  { key: "connectorLifecycle", file: "connector-lifecycle.json", required: true },
  { key: "healthReport", file: "ARCHITECTURE_HEALTH_REPORT.json", required: false },
];

// Registries this control surface WOULD read if they existed. Confirmed
// absent by direct repo search (2026-08-04) — AI_REGISTRY.json is an
// AI-AGENT compatibility directory, not a runtime AI-model registry. There
// is currently no real ai_model / compute_provider / server_pod registry
// anywhere in this repo. Never fabricate nodes for these.
const UNKNOWN_DIMENSIONS = ["ai_model_registry", "compute_provider_registry", "server_pod_registry"];

function fail(msg: string): never {
  process.stderr.write(`\n[build-system-control-graph] FAILED: ${msg}\n\n`);
  process.exit(1);
}

function loadSource(rootDir: string, s: RequiredSource): AnyRec | null {
  const p = path.join(rootDir, s.file);
  if (!fs.existsSync(p)) {
    if (s.required) fail(`required source registry missing: registry/${s.file} (looked at ${p})`);
    return null;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf-8");
  } catch (e) {
    fail(`could not read registry/${s.file}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(raw!);
  } catch (e) {
    if (s.required) fail(`registry/${s.file} is not valid JSON: ${(e as Error).message}`);
    return null;
  }
}

// ---- node/edge shape (documented in the task spec, enforced by validateGraph below) ----

type NodeField = string | "UNKNOWN" | "NOT_IMPLEMENTED";

interface ControlNode {
  id: string;
  name: string;
  type: "Module" | "Layer" | "Command" | "Event" | "Capability" | "Service" | "Driver" | "Connector";
  layer: NodeField;
  source_file: NodeField;
  status: NodeField;
  runtime_callable: boolean | "UNKNOWN";
  provider: NodeField;
  dependencies: string[];
  dependents: string[];
  commands: string[];
  events: string[];
  capabilities: string[];
  health: NodeField;
  cost_source: NodeField;
}

interface ControlEdge {
  source: string;
  target: string;
  type:
    | "imports"
    | "calls"
    | "executes"
    | "emits"
    | "consumes"
    | "reads"
    | "writes"
    | "routes_to"
    | "hosted_on"
    | "uses_model"
    | "connected_to"
    | "governed_by";
}

function main() {
  const rootDir = process.env.SCG_REGISTRY_DIR ? path.resolve(process.env.SCG_REGISTRY_DIR) : REGISTRY_DIR;
  const outDir = process.env.SCG_OUT_DIR ? path.resolve(process.env.SCG_OUT_DIR) : REGISTRY_DIR;

  const loaded: Record<string, AnyRec | null> = {};
  for (const s of SOURCES) {
    loaded[s.key] = loadSource(rootDir, s);
  }

  const archBook = loaded.archBook as unknown as ArchBookFile;
  const moduleRegistry = loaded.moduleRegistry as unknown as ModuleRegistryFile;
  const commandRegistry = loaded.commandRegistry as unknown as CommandRegistryFile;
  const eventsReg = loaded.events as unknown as EventsFile;
  const capReg = loaded.capabilityRegistry as unknown as CapabilityRegistryFile;
  const infra = loaded.infrastructure as unknown as InfrastructureFile;
  const drivers = loaded.drivers as unknown as DriversFile;
  const connLife = loaded.connectorLifecycle as unknown as ConnectorLifecycleFile;
  const healthReport = loaded.healthReport as unknown as HealthReportFile | null;

  // ---- structural sanity checks (fail loudly on malformed shape, not just missing file) ----
  if (!Array.isArray(archBook.nodes)) fail("architecture-book.json: nodes is not an array — regenerate with `npm run arch` first");
  if (!Array.isArray(archBook.edges)) fail("architecture-book.json: edges is not an array");
  if (!moduleRegistry.modules || typeof moduleRegistry.modules !== "object") fail("module-registry.json: modules is not an object");
  if (!commandRegistry.commands || typeof commandRegistry.commands !== "object") fail("command-registry.json: commands is not an object");
  if (!eventsReg.events || typeof eventsReg.events !== "object") fail("events.json: events is not an object");
  if (!capReg.capabilities) fail("capability-registry.json: capabilities missing");
  if (!infra.services || typeof infra.services !== "object") fail("infrastructure.json: services is not an object");
  if (!drivers.drivers) fail("drivers.json: drivers missing");
  if (!Array.isArray(connLife.stages)) fail("connector-lifecycle.json: stages is not an array");

  const nodes: ControlNode[] = [];
  const edges: ControlEdge[] = [];
  const nodeIds = new Set<string>();

  function addNode(n: ControlNode) {
    if (nodeIds.has(n.id)) return; // idempotent within one run
    nodeIds.add(n.id);
    nodes.push(n);
  }
  function addEdge(e: ControlEdge) {
    edges.push(e);
  }

  // ---- 1. Module + Layer nodes, straight from architecture-book.json (real, already-computed AST graph) ----
  const bookNodeById = new Map<string, ArchBookNode>();
  for (const bn of archBook.nodes) bookNodeById.set(bn.id, bn);

  for (const bn of archBook.nodes) {
    const type = bn.type === "Layer" ? "Layer" : "Module";
    const path_ = typeof bn.id === "string" ? bn.id.replace(/^(module|layer):/, "") : "UNKNOWN";
    addNode({
      id: bn.id,
      name: bn.name_en || path_,
      type,
      layer: bn.layer ?? "UNKNOWN",
      source_file: type === "Module" ? path_ : "UNKNOWN",
      status: bn.status ?? "UNKNOWN",
      runtime_callable: typeof bn.runtime_entry_point === "boolean" ? bn.runtime_entry_point : "UNKNOWN",
      provider: "UNKNOWN",
      dependencies: Array.isArray(bn.internal_dependencies) ? bn.internal_dependencies : [],
      dependents: Array.isArray(bn.dependents) ? bn.dependents : [],
      commands: [],
      events: [],
      capabilities: Array.isArray(bn.business_capabilities) ? bn.business_capabilities : [],
      health: bn.status ?? "UNKNOWN",
      cost_source: "UNKNOWN",
    });
  }

  // Real edges: imports/contains, straight from architecture-book.json's `label` field
  // (confirmed real field name by reading the file — NOT `type`).
  for (const be of archBook.edges) {
    if (!be.source || !be.target) continue;
    const label = be.label === "contains" ? "governed_by" : "imports";
    addEdge({ source: be.source, target: be.target, type: label as ControlEdge["type"] });
  }

  // ---- 2. Command nodes, cross-referenced to their owner module (real `owner` field in command-registry.json) ----
  const commandOwnerIndex = new Map<string, string[]>(); // module path -> command names
  for (const [cmdName, cmdData] of Object.entries(commandRegistry.commands)) {
    const owner: string | undefined = cmdData?.owner;
    const nodeId = `command:${cmdName}`;
    addNode({
      id: nodeId,
      name: cmdName,
      type: "Command",
      layer: cmdData?.layer ?? "UNKNOWN",
      source_file: owner ?? "UNKNOWN",
      status: "UNKNOWN",
      runtime_callable: "UNKNOWN",
      provider: "UNKNOWN",
      dependencies: [],
      dependents: [],
      commands: [],
      events: [],
      capabilities: [],
      health: "UNKNOWN",
      cost_source: "UNKNOWN",
    });
    if (owner) {
      const ownerModuleId = `module:${owner}`;
      if (bookNodeById.has(ownerModuleId)) {
        addEdge({ source: nodeId, target: ownerModuleId, type: "calls" });
        const list = commandOwnerIndex.get(owner) || [];
        list.push(cmdName);
        commandOwnerIndex.set(owner, list);
      }
      // owner may be a layer name (e.g. "engines/validation/dispatcher.ts" is a
      // module path; some commands' owner is just a layer) — only emit the
      // edge when a real module node exists, per the "only emit an edge type
      // you can actually derive" rule. No edge fabricated when owner doesn't
      // resolve to a real node.
    }
  }
  // Back-fill `commands` on module nodes now that we know real ownership.
  for (const n of nodes) {
    if (n.type === "Module") {
      const modulePath = n.id.replace(/^module:/, "");
      const cmds = commandOwnerIndex.get(modulePath);
      if (cmds) n.commands = cmds;
    }
  }

  // ---- 3. Event nodes. events.json has NO module-owner field (confirmed by reading the
  // file — only `source` (a layer name like "cognitive") and `data` (field list)).
  // We can therefore only place events at the LAYER level, never claim a specific
  // module owns an event — emitting a module-level edge here would be a fabrication.
  for (const [eventName, eventData] of Object.entries(eventsReg.events)) {
    const nodeId = `event:${eventName}`;
    const sourceLayer: string | undefined = eventData?.source;
    addNode({
      id: nodeId,
      name: eventName,
      type: "Event",
      layer: sourceLayer ?? "UNKNOWN",
      source_file: "UNKNOWN", // no module-level owner exists in events.json — honestly UNKNOWN, not guessed
      status: "UNKNOWN",
      runtime_callable: "UNKNOWN",
      provider: "UNKNOWN",
      dependencies: [],
      dependents: [],
      commands: [],
      events: [],
      capabilities: [],
      health: "UNKNOWN",
      cost_source: "UNKNOWN",
    });
    if (sourceLayer) {
      const layerNodeId = `layer:${sourceLayer}`;
      if (bookNodeById.has(layerNodeId)) {
        addEdge({ source: nodeId, target: layerNodeId, type: "emits" });
      }
    }
  }

  // ---- 4. Capability nodes (from capability-registry.json's frozen list) ----
  // capability-registry.json uses PascalCase fields (CapabilityId/OwnerModule/
  // Category/Description/Version/InputContract...) — confirmed by reading a
  // real sample, distinct casing from every other registry read here.
  const capabilities: CapabilityEntry[] = Array.isArray(capReg.capabilities)
    ? capReg.capabilities
    : Object.entries(capReg.capabilities).map(([k, v]) => ({ CapabilityId: k, ...v }));
  for (const cap of capabilities) {
    const capId = cap.CapabilityId;
    if (!capId) continue;
    const nodeId = `capability:${capId}`;
    addNode({
      id: nodeId,
      name: capId,
      type: "Capability",
      layer: cap.Category ?? "UNKNOWN",
      source_file: cap.OwnerModule ?? "UNKNOWN",
      status: cap.Version ? `v${cap.Version}` : "UNKNOWN",
      runtime_callable: "UNKNOWN",
      provider: "UNKNOWN",
      dependencies: [],
      dependents: [],
      commands: [],
      events: [],
      capabilities: [],
      health: "UNKNOWN",
      cost_source: "UNKNOWN",
    });
    const ownerModule = cap.OwnerModule;
    if (ownerModule && bookNodeById.has(`module:${ownerModule}`)) {
      addEdge({ source: nodeId, target: `module:${ownerModule}`, type: "governed_by" });
      const list = commandOwnerIndex.get(ownerModule) || [];
      // not commands, but reuse module lookup below to attach capability ids
    }
  }
  // Back-fill `capabilities` on module nodes now that ownership is known.
  const capsByModule = new Map<string, string[]>();
  for (const cap of capabilities) {
    if (cap.CapabilityId && cap.OwnerModule) {
      const l = capsByModule.get(cap.OwnerModule) || [];
      l.push(cap.CapabilityId);
      capsByModule.set(cap.OwnerModule, l);
    }
  }
  for (const n of nodes) {
    if (n.type === "Module") {
      const modulePath = n.id.replace(/^module:/, "");
      const caps = capsByModule.get(modulePath);
      if (caps) n.capabilities = caps;
    }
  }

  // ---- 5. Infrastructure Service nodes (real, from infrastructure.json) ----
  for (const [svcKey, svcData] of Object.entries(infra.services)) {
    const nodeId = `service:${svcKey}`;
    addNode({
      id: nodeId,
      name: svcData.name || svcKey,
      type: "Service",
      layer: "services",
      source_file: "UNKNOWN",
      status: svcData.status ?? "UNKNOWN",
      runtime_callable: true,
      provider: svcData.name || svcKey,
      dependencies: [],
      dependents: [],
      commands: [],
      events: [],
      capabilities: [],
      health: svcData.status ?? "UNKNOWN",
      cost_source: typeof svcData.cost_monthly_thb === "number" ? `infrastructure.json:${svcKey}.cost_monthly_thb` : "UNKNOWN",
    });
    const depGraph = svcData.dependency_graph;
    if (depGraph && Array.isArray(depGraph.modules)) {
      for (const modPath of depGraph.modules as string[]) {
        const modId = `module:${modPath}`;
        if (bookNodeById.has(modId)) {
          addEdge({ source: modId, target: nodeId, type: "connected_to" });
        }
      }
    }
  }

  // ---- 6. Driver nodes (real, from drivers.json) ----
  const driverEntries: [string, DriverEntry][] = Array.isArray(drivers.drivers)
    ? drivers.drivers.map((d, i): [string, DriverEntry] => [d.id || `driver_${i}`, d])
    : Object.entries(drivers.drivers);
  for (const [driverKey, driverData] of driverEntries) {
    const nodeId = `driver:${driverKey}`;
    addNode({
      id: nodeId,
      name: driverKey,
      type: "Driver",
      layer: "plugins",
      source_file: driverData.module ?? "UNKNOWN",
      status: driverData.status ?? "UNKNOWN",
      runtime_callable: "UNKNOWN",
      provider: driverData.platform ?? "UNKNOWN",
      dependencies: [],
      dependents: [],
      commands: [],
      events: [],
      capabilities: [],
      health: driverData.status ?? "UNKNOWN",
      cost_source: "UNKNOWN",
    });
    if (driverData.module && bookNodeById.has(`module:${driverData.module}`)) {
      addEdge({ source: nodeId, target: `module:${driverData.module}`, type: "governed_by" });
    }
  }

  // ---- 7. Connector lifecycle stage nodes (real, from connector-lifecycle.json) ----
  for (const stage of connLife.stages as string[]) {
    const nodeId = `connector_stage:${stage}`;
    addNode({
      id: nodeId,
      name: stage,
      type: "Connector",
      layer: "registry",
      source_file: "registry/connector-lifecycle.json",
      status: connLife.status ?? "UNKNOWN",
      runtime_callable: "UNKNOWN",
      provider: "UNKNOWN",
      dependencies: [],
      dependents: [],
      commands: [],
      events: [],
      capabilities: [],
      health: "UNKNOWN",
      cost_source: "UNKNOWN",
    });
  }
  for (let i = 0; i < (connLife.stages as string[]).length - 1; i++) {
    addEdge({
      source: `connector_stage:${(connLife.stages as string[])[i]}`,
      target: `connector_stage:${(connLife.stages as string[])[i + 1]}`,
      type: "routes_to",
    });
  }

  // ---- data_tables -> "reads"/"writes" edges are NOT derivable: build-arch-book.ts's
  // data_tables field does not distinguish read vs write (confirmed by reading real
  // node samples — it's a flat list of table names touched). Emitting "reads" for all
  // of them would be a guess disguised as a derived fact, so we deliberately do not.
  // This is recorded as a real, named gap rather than silently absent.
  const dataTableEdgeGap = "data_tables field in architecture-book.json does not distinguish read vs write access — reads/writes edge type not emitted, would require re-instrumenting scripts/build-arch-book.ts's AST walk";

  // ---- summary ----
  const summary = {
    total_nodes: nodes.length,
    total_edges: edges.length,
    modules: nodes.filter((n) => n.type === "Module").length,
    layers: nodes.filter((n) => n.type === "Layer").length,
    commands: nodes.filter((n) => n.type === "Command").length,
    events: nodes.filter((n) => n.type === "Event").length,
    capabilities: nodes.filter((n) => n.type === "Capability").length,
    services: nodes.filter((n) => n.type === "Service").length,
    drivers: nodes.filter((n) => n.type === "Driver").length,
    connector_stages: nodes.filter((n) => n.type === "Connector").length,
    module_health: archBook.summary ?? "UNKNOWN",
    registry_completeness_pct: healthReport?.registry_completeness_pct ?? "UNKNOWN",
    circular_dependencies: healthReport?.circular_dependencies ?? "UNKNOWN",
    duplicate_registrations: healthReport?.duplicate_registrations?.count ?? "UNKNOWN",
    unknown_field_counts: {
      nodes_with_unknown_source_file: nodes.filter((n) => n.source_file === "UNKNOWN").length,
      nodes_with_unknown_status: nodes.filter((n) => n.status === "UNKNOWN").length,
      nodes_with_unknown_provider: nodes.filter((n) => n.provider === "UNKNOWN").length,
    },
    unknown_dimensions: UNKNOWN_DIMENSIONS,
    known_derivation_gaps: [dataTableEdgeGap],
  };

  const sources = SOURCES.filter((s) => loaded[s.key] !== null).map((s) => `registry/${s.file}`);

  const graph = {
    generated_at: new Date().toISOString(),
    nodes,
    edges,
    summary,
    sources,
    unknown_dimensions: UNKNOWN_DIMENSIONS,
  };

  validateGraph(graph);

  const graphPath = path.join(outDir, "system-control-graph.json");
  const summaryPath = path.join(outDir, "system-control-summary.json");
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
  fs.writeFileSync(
    summaryPath,
    JSON.stringify({ generated_at: graph.generated_at, ...summary, sources }, null, 2)
  );

  process.stdout.write(
    `[build-system-control-graph] wrote ${graphPath} (${nodes.length} nodes, ${edges.length} edges) and ${summaryPath}\n`
  );
}

// Real shape of the graph object main() constructs above and hands to this
// validator — kept as its own interface (rather than reusing AnyRec) since
// every field here is already known/constructed, not arbitrary external JSON.
interface ControlGraphOutput {
  generated_at: string;
  nodes: ControlNode[];
  edges: ControlEdge[];
  summary: unknown;
  sources: string[];
  unknown_dimensions: string[];
}

// Simple runtime schema check (no new JSON-schema dependency, per the task
// constraint) — checks shape, not content correctness.
function validateGraph(graph: ControlGraphOutput) {
  const errs: string[] = [];
  if (typeof graph.generated_at !== "string") errs.push("generated_at must be a string");
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) errs.push("nodes must be a non-empty array");
  if (!Array.isArray(graph.edges)) errs.push("edges must be an array");
  if (!graph.summary || typeof graph.summary !== "object") errs.push("summary must be an object");
  if (!Array.isArray(graph.sources) || graph.sources.length === 0) errs.push("sources must be a non-empty array");
  if (!Array.isArray(graph.unknown_dimensions)) errs.push("unknown_dimensions must be an array");

  const nodeIds = new Set<string>();
  const requiredNodeFields = [
    "id", "name", "type", "layer", "source_file", "status", "runtime_callable",
    "provider", "dependencies", "dependents", "commands", "events", "capabilities",
    "health", "cost_source",
  ];
  for (const n of graph.nodes) {
    for (const f of requiredNodeFields) {
      if (!(f in n)) errs.push(`node ${n.id ?? "?"} missing field ${f}`);
    }
    if (typeof n.id === "string") nodeIds.add(n.id);
  }
  let danglingEdges = 0;
  for (const e of graph.edges) {
    if (!e.source || !e.target || !e.type) errs.push(`edge missing source/target/type: ${JSON.stringify(e)}`);
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) danglingEdges++;
  }
  // Dangling edges are allowed (architecture-book.json itself has some — e.g. the
  // literal-template-string edge target seen in raw data) but must not exceed a
  // sane fraction, else something is structurally broken, not just noisy.
  if (graph.edges.length > 0 && danglingEdges / graph.edges.length > 0.5) {
    errs.push(`too many dangling edges (${danglingEdges}/${graph.edges.length}) — source graph likely malformed`);
  }

  if (errs.length > 0) {
    fail(`output failed self-validation:\n  - ${errs.slice(0, 20).join("\n  - ")}${errs.length > 20 ? `\n  ...and ${errs.length - 20} more` : ""}`);
  }
}

main();
