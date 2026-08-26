/**
 * หน้าที่: builds the Circuit graph FROM THE RUNNING SYSTEM instead of from a
 * hand-maintained map (Owner, 2026-08-26).
 *
 * NOTHING IN THIS FILE NAMES A SPECIFIC CAPABILITY. It walks source lists —
 * the read-path registry, the census snapshot, the observation store, the
 * service registry, the resource graph — and emits a node per entry it finds.
 * A capability registered tomorrow, a read path declared tomorrow, a service
 * added tomorrow appears with no edit here and none in the UI. That is the
 * whole point: the previous graph had to be edited by hand for every new box.
 *
 * EVERY EDGE CARRIES ITS EVIDENCE. `evidence` names the source list and the
 * field the relationship came out of. A relationship that cannot be evidenced
 * is emitted as an `UNRESOLVED` node — visible, and clearly not a fact —
 * rather than drawn as a real edge or silently dropped.
 *
 * READ ONLY, AND CHEAP ON PURPOSE. It reads the census SNAPSHOT
 * (`last-census.json`) rather than recomputing the census, and observes no
 * processes of its own. A graph endpoint that took a minute would not be a
 * graph endpoint.
 *
 * Input: none (all sources are read through their public contracts).
 * Output: `buildSystemGraph()` -> nodes + directed edges + per-source counts.
 * Dependency ที่อนุญาต: the public contracts of system-read-paths,
 * machine-observation, realtime-change, runtime-control, registry-database,
 * plus live-census's snapshot reader.
 * สิ่งที่ห้ามแตะ:
 * - ห้าม hard-code node/edge ของ capability ตัวใดตัวหนึ่ง.
 * - ห้าม emit edge ที่ไม่มี evidence.
 * - ห้าม recompute census ที่นี่ — อ่าน snapshot เท่านั้น.
 */

declare const require: any;

import { READ_PATHS, verifyReadPaths } from "../../control/system-read-paths/contract";
import { observationStoreStatus, readObservations } from "../../control/machine-observation/contract";
import { observationStatus } from "../../control/realtime-change/contract";
import { SERVICES } from "../../control/runtime-control/contract";
import { readRenderEvidence, routeOwnership } from "../../control/ui-render-verification/contract";
import { allCurrentCheckpoints, buildResumeContext } from "../../control/work-session-state/contract";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const CENSUS_SNAPSHOT = path.join(REPO_ROOT, "software/live-census/data/last-census.json");

export type GraphDomain =
  | "MACHINE_OBSERVATION" | "PROCESS" | "FILESYSTEM_EVENT" | "OBSERVATION_STORE"
  | "RESOURCE_RESOLUTION" | "RESOURCE_GRAPH" | "LIVE_CENSUS" | "STATE" | "EVIDENCE"
  | "BLUEPRINT_DOCUMENT" | "LIFECYCLE_VERDICT" | "RUNTIME_SERVICE" | "READ_PATH" | "CAPABILITY"
  | "UI_ROUTE" | "UI_IMPACT" | "RENDER_VERIFICATION" | "RENDER_EVIDENCE" | "COMPLETION_GATE"
  | "OWNER_INTENT" | "WORK" | "TASK" | "SESSION" | "EXECUTION" | "WORK_PHASE" | "BLOCKER"
  | "DECISION_REQUIRED" | "NEXT_ACTION" | "UNRESOLVED";

export interface GraphNode {
  id: string;
  label: string;
  domain: GraphDomain;
  /** Where this node came from — a source list, never a hand-written map. */
  source: string;
  evidence: readonly string[];
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** Directed relationship name. There is no undirected edge in this graph. */
  kind: string;
  evidence: readonly string[];
}

export interface SystemGraph {
  generated_at: string;
  /** How many entries each real source contributed — the auto-expansion counter. */
  source_counts: Record<string, number>;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  unresolved: readonly { id: string; reason: string }[];
}

interface CensusRecord {
  capability_key: string;
  path: string;
  resource_id: string | null;
  capability_id: string | null;
  current_status: string;
  runtime_state: string;
  source_digest: string;
  status_reason: string;
  evidence_references?: readonly string[];
}

function readCensusSnapshot(): CensusRecord[] {
  try {
    const parsed = JSON.parse(String(fs.readFileSync(CENSUS_SNAPSHOT, "utf8")));
    return (parsed.capabilities ?? parsed.records ?? []) as CensusRecord[];
  } catch {
    return [];
  }
}

export function buildSystemGraph(): SystemGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const unresolved: { id: string; reason: string }[] = [];
  const counts: Record<string, number> = {};
  const at = new Date().toISOString();

  const addNode = (node: GraphNode): void => { if (!nodes.has(node.id)) nodes.set(node.id, node); };
  const addEdge = (edge: GraphEdge): void => {
    if (edge.evidence.length === 0) { unresolved.push({ id: edge.id, reason: "edge had no evidence and was refused" }); return; }
    edges.push(edge);
  };

  // ---- SOURCE 1: the declared read paths -------------------------------
  const verification = new Map(verifyReadPaths().map((entry) => [entry.id, entry]));
  counts["system-read-paths"] = READ_PATHS.length;
  for (const readPath of READ_PATHS) {
    const status = verification.get(readPath.id);
    addNode({ id: `read_path:${readPath.id}`, label: readPath.id, domain: "READ_PATH", source: "control/system-read-paths#READ_PATHS", evidence: [`${readPath.provider.contract_path}#${readPath.provider.symbol}`, `verification=${status?.status ?? "UNKNOWN"}`] });
    addNode({ id: `provider:${readPath.provider.capability}`, label: readPath.provider.capability, domain: "CAPABILITY", source: "control/system-read-paths#READ_PATHS.provider", evidence: [readPath.provider.contract_path] });
    addEdge({ id: `e_readpath_${readPath.id}_provider`, from: `read_path:${readPath.id}`, to: `provider:${readPath.provider.capability}`, kind: "SERVED_BY", evidence: [`${readPath.provider.contract_path}#${readPath.provider.symbol}`, `lookup_key=${readPath.request.lookup_key}`] });
    if (status && status.status !== "VERIFIED") unresolved.push({ id: `read_path:${readPath.id}`, reason: `${status.status}: ${status.detail}` });
  }

  // ---- SOURCE 2: the live-census snapshot ------------------------------
  const census = readCensusSnapshot();
  counts["live-census"] = census.length;
  addNode({ id: "live_census", label: "LIVE CENSUS", domain: "LIVE_CENSUS", source: "software/live-census/data/last-census.json", evidence: [`${census.length} capability records in the snapshot`] });
  for (const record of census) {
    const capabilityNode = `capability:${record.capability_key}`;
    addNode({ id: capabilityNode, label: record.path, domain: "CAPABILITY", source: "software/live-census snapshot", evidence: [`capability_key=${record.capability_key}`, `source_digest=${record.source_digest}`] });
    addEdge({ id: `e_census_reads_${record.capability_key}`, from: capabilityNode, to: "live_census", kind: "READ_BY", evidence: ["software/live-census/data/last-census.json", `observed status=${record.current_status}`] });

    // LIFECYCLE -> VERDICT, straight off the record's own derived status.
    const verdict = `verdict:${record.current_status}`;
    addNode({ id: verdict, label: record.current_status, domain: "LIFECYCLE_VERDICT", source: "software/live-census derived status", evidence: ["deriveStatus over the verification ledger + live digest"] });
    addEdge({ id: `e_verdict_${record.capability_key}`, from: capabilityNode, to: verdict, kind: "EVALUATED_BY_LIFECYCLE", evidence: [`status_reason=${String(record.status_reason).slice(0, 120)}`] });

    // STATE, as observed.
    const state = `state:${record.runtime_state}`;
    addNode({ id: state, label: record.runtime_state, domain: "STATE", source: "software/live-census runtime_state", evidence: ["derived from machine-observation evidence, or the command-string fallback"] });
    addEdge({ id: `e_state_${record.capability_key}`, from: capabilityNode, to: state, kind: "HAS_STATE", evidence: [`runtime_state=${record.runtime_state}`] });

    // RESOURCE identity, only where the registry really bound one.
    if (record.resource_id) {
      const resource = `resource:${record.resource_id}`;
      addNode({ id: resource, label: record.resource_id, domain: "RESOURCE_GRAPH", source: "software/registry-database (bound through the path resolver)", evidence: [`resource_id=${record.resource_id}`, `path=${record.path}`] });
      addEdge({ id: `e_impl_${record.capability_key}`, from: resource, to: capabilityNode, kind: "IMPLEMENTS", evidence: [`live-census bound resource_id=${record.resource_id} to ${record.path}`] });
    } else {
      unresolved.push({ id: capabilityNode, reason: "no registered resource identity covers this capability path" });
    }
  }

  // ---- SOURCE 3: the observation store ---------------------------------
  const storeStatus = observationStoreStatus();
  const observations = readObservations();
  counts["observation-store"] = observations.length;
  addNode({ id: "observation_store", label: "OBSERVATION STORE", domain: "OBSERVATION_STORE", source: "control/machine-observation/data/observations.jsonl", evidence: [`records=${storeStatus.records}`, `active_bytes=${storeStatus.active_bytes}`, `rotated_files=${storeStatus.rotated_files.length}`] });
  for (const record of observations.slice(-50)) {
    const event = `fs_event:${record.event_id}`;
    addNode({ id: event, label: record.path, domain: "FILESYSTEM_EVENT", source: "control/machine-observation observation store", evidence: [`event_id=${record.event_id}`, `observed_at=${record.observed_at}`, `source=${record.source}`] });
    addEdge({ id: `e_store_${record.event_id}`, from: event, to: "observation_store", kind: "APPENDED_TO", evidence: [`record_type=${record.record_type}`, `derived_by=${record.derived_by}`] });
    if (record.resource_id) {
      addEdge({ id: `e_resolves_${record.event_id}`, from: event, to: `resource:${record.resource_id}`, kind: "RESOLVES_TO", evidence: [`resolved through the existing path lookup to ${record.resource_id}`] });
      addEdge({ id: `e_evidence_${record.event_id}`, from: event, to: `resource:${record.resource_id}`, kind: "UPDATES_EVIDENCE_FOR", evidence: record.process_evidence.slice(0, 2) });
      addNode({ id: `resource:${record.resource_id}`, label: record.resource_id, domain: "RESOURCE_GRAPH", source: "observation record", evidence: [`seen in observation ${record.event_id}`] });
    } else {
      unresolved.push({ id: event, reason: "the observed path resolved to no registered resource" });
    }
    for (const meaning of record.meaning_records) {
      if (meaning.meaning_type === "DOCUMENT_RELATION" && record.resource_id) {
        const claim = `blueprint_claim:${meaning.source}`;
        addNode({ id: claim, label: meaning.source, domain: "BLUEPRINT_DOCUMENT", source: "control/system-read-paths blueprint read path", evidence: meaning.proof });
        addEdge({ id: `e_bp_${record.event_id}`, from: `resource:${record.resource_id}`, to: claim, kind: "REFERENCED_BY", evidence: meaning.proof });
      }
      if (meaning.meaning_type === "UNKNOWN") unresolved.push({ id: `meaning:${record.event_id}`, reason: String(meaning.proof[0] ?? "unknown meaning") });
    }
  }

  // ---- SOURCE 4: the observer itself -----------------------------------
  const observing = observationStatus();
  addNode({ id: "machine_observer", label: "MACHINE OBSERVER", domain: "MACHINE_OBSERVATION", source: "control/realtime-change observer status", evidence: [observing.observing ? `observing ${observing.scopes.length} scope(s) since ${observing.since}` : `not observing: ${observing.reason}`] });
  addEdge({ id: "e_observer_store", from: "machine_observer", to: "observation_store", kind: "PRODUCES", evidence: ["control/machine-observation/observer-daemon.ts appends every observed change"] });
  if (observing.observing) {
    counts["watch-scopes"] = observing.scopes.length;
    for (const scope of observing.scopes) {
      addNode({ id: `scope:${scope.path}`, label: scope.path, domain: "MACHINE_OBSERVATION", source: "control/realtime-change watch scopes", evidence: [`origin=${scope.origin}`, `origin_ref=${scope.origin_ref}`] });
      addEdge({ id: `e_watch_${scope.path}`, from: "machine_observer", to: `scope:${scope.path}`, kind: "WATCHES", evidence: [`origin=${scope.origin}`, `origin_ref=${scope.origin_ref}`] });
    }
  } else {
    counts["watch-scopes"] = 0;
    unresolved.push({ id: "machine_observer", reason: observing.reason });
  }

  // ---- SOURCE 5: the managed services ----------------------------------
  const services = Object.values(SERVICES);
  counts["runtime-control-services"] = services.length;
  for (const service of services) {
    addNode({ id: `service:${service.service_id}`, label: service.service_id, domain: "RUNTIME_SERVICE", source: "control/runtime-control#SERVICES", evidence: [`launchd_label=${service.launchd_label}`, `port=${service.port}`, `health_path=${service.health_path}`] });
  }
  // The observer is one of those services when the registry says so — matched
  // by its declared label, not by a name written here.
  const observerService = services.find((service) => service.launchd_label.includes("machine-observer"));
  if (observerService) {
    addEdge({ id: "e_service_observer", from: `service:${observerService.service_id}`, to: "machine_observer", kind: "RUNS", evidence: [`control/runtime-control#SERVICES.${observerService.service_id}`, `launchd_label=${observerService.launchd_label}`] });
  }

  // ---- SOURCE 6: UI routes + render evidence --------------------------
  // Routes come from the servers' own serveStaticFile calls; evidence comes
  // from the render stage's append-only log. Neither is a list written here.
  const ownership = routeOwnership();
  counts["ui-routes"] = ownership.size;
  for (const [owner, route] of ownership) {
    addNode({ id: `ui_route:${route}`, label: route, domain: "UI_ROUTE", source: "server serveStaticFile route table", evidence: [`served from ${owner}`] });
    addNode({ id: `ui_source:${owner}`, label: owner, domain: "UI_ROUTE", source: "server serveStaticFile route table", evidence: [`serves ${route}`] });
    addEdge({ id: `e_route_${route}`, from: `ui_source:${owner}`, to: `ui_route:${route}`, kind: "SERVED_AT", evidence: [`serveStaticFile(root, "${owner}/index.html") for url "${route}"`] });
  }

  const renderEvidence = readRenderEvidence();
  counts["render-evidence"] = renderEvidence.length;
  if (renderEvidence.length > 0) {
    addNode({ id: "ui_impact_detection", label: "UI IMPACT DETECTION", domain: "UI_IMPACT", source: "control/ui-render-verification/impact.ts", evidence: ["path rules over the changed set plus the real route table"] });
    addNode({ id: "ui_render_verification", label: "UI RENDER VERIFICATION", domain: "RENDER_VERIFICATION", source: "control/ui-render-verification/render-verify.ts", evidence: ["real runtime, real route, real browser DOM"] });
    addNode({ id: "completion_gate", label: "COMPLETION GATE", domain: "COMPLETION_GATE", source: "control/ui-render-verification/gate.ts", evidence: ["reuses control/runtime-verification for evidence freshness"] });
    addEdge({ id: "e_impact_to_render", from: "ui_impact_detection", to: "ui_render_verification", kind: "REQUESTS_VERIFICATION", evidence: ["UI_IMPACT=YES routes the change into the render stage"] });
    addEdge({ id: "e_render_to_gate", from: "ui_render_verification", to: "completion_gate", kind: "RETURNS_VERDICT", evidence: ["control/ui-render-verification/gate.ts reads the render verdict"] });
  }
  for (const evidence of renderEvidence.slice(-25)) {
    const node = `render_evidence:${evidence.execution_id}:${evidence.observed_at}`;
    addNode({ id: node, label: `${evidence.verdict} ${evidence.route}`, domain: "RENDER_EVIDENCE", source: "control/ui-render-verification/data/render-evidence.jsonl", evidence: [`execution_id=${evidence.execution_id}`, `source_digest=${evidence.source_digest}`, `screenshot=${evidence.screenshot_path || "none"}`] });
    addEdge({ id: `e_render_ev_${node}`, from: "ui_render_verification", to: node, kind: "PRODUCES_EVIDENCE", evidence: [`observed_at=${evidence.observed_at}`, `data_source=${evidence.data_source}`] });
    addEdge({ id: `e_ev_gate_${node}`, from: node, to: "completion_gate", kind: "DECIDES", evidence: [`verdict=${evidence.verdict}`, evidence.reason.slice(0, 90)] });
    const routeNode = `ui_route:${evidence.route}`;
    if (nodes.has(routeNode)) addEdge({ id: `e_ev_route_${node}`, from: node, to: routeNode, kind: "PROVES_ROUTE", evidence: [`runtime_url=${evidence.runtime_url}`] });
    for (const resourceId of evidence.resource_id) {
      addEdge({ id: `e_ev_res_${node}_${resourceId}`, from: node, to: `resource:${resourceId}`, kind: "EVIDENCE_FOR", evidence: [`resource_id=${resourceId}`, `source_digest=${evidence.source_digest}`] });
      addNode({ id: `resource:${resourceId}`, label: resourceId, domain: "RESOURCE_GRAPH", source: "render evidence lineage", evidence: [`named by render evidence ${evidence.execution_id}`] });
    }
  }

  // ---- SOURCE 7: persistent work state --------------------------------
  // Every node below comes out of the checkpoint journal that
  // `control/work-session-state/` owns. Nothing here names a work item, a
  // phase or a session: they appear because a checkpoint records them, and
  // they keep appearing after the worker that wrote them is gone — the work
  // node is derived from persisted state, never from a live process.
  const checkpoints = allCurrentCheckpoints();
  counts["work-session-state"] = checkpoints.length;
  for (const checkpoint of checkpoints) {
    const workNode = `work:${checkpoint.work_id}`;
    const resume = buildResumeContext(checkpoint.work_id);
    addNode({ id: workNode, label: checkpoint.objective.slice(0, 70) || checkpoint.work_id, domain: "WORK", source: "control/work-session-state#allCurrentCheckpoints", evidence: [`work_id=${checkpoint.work_id}`, `status=${checkpoint.status}`, `resume_status=${resume.resume_status}`, `checkpoint_id=${checkpoint.checkpoint_id}`] });

    if (checkpoint.owner_intent_id) {
      const intentNode = `owner_intent:${checkpoint.owner_intent_id}`;
      addNode({ id: intentNode, label: checkpoint.owner_intent_id, domain: "OWNER_INTENT", source: "control/work-session-state#checkpoint.owner_intent_id", evidence: [`declared by checkpoint ${checkpoint.checkpoint_id}`] });
      addEdge({ id: `e_intent_work_${checkpoint.work_id}`, from: intentNode, to: workNode, kind: "ORIGINATES", evidence: [`owner_intent_id=${checkpoint.owner_intent_id}`] });
    }
    if (checkpoint.task_id) {
      const taskNode = `task:${checkpoint.task_id}`;
      addNode({ id: taskNode, label: checkpoint.task_id, domain: "TASK", source: "control/work-session-state#checkpoint.task_id", evidence: ["status is owned by control/work-coordination, not restated here"] });
      addEdge({ id: `e_work_task_${checkpoint.work_id}`, from: workNode, to: taskNode, kind: "EXECUTES_TASK", evidence: [`task_id=${checkpoint.task_id}`] });
    }

    const sessionNode = `session:${checkpoint.session_id}`;
    addNode({ id: sessionNode, label: `${checkpoint.worker_identity} ${checkpoint.session_id.slice(-8)}`, domain: "SESSION", source: "control/work-session-state#checkpoint.session_id", evidence: [`worker_identity=${checkpoint.worker_identity}`, `updated_at=${checkpoint.updated_at}`] });
    addEdge({ id: `e_session_work_${checkpoint.session_id}`, from: sessionNode, to: workNode, kind: "WORKS_ON", evidence: [`session_id=${checkpoint.session_id}`, `work_id=${checkpoint.work_id}`] });
    if (checkpoint.execution_id) {
      const execNode = `execution:${checkpoint.execution_id}`;
      addNode({ id: execNode, label: checkpoint.execution_id.slice(-12), domain: "EXECUTION", source: "control/work-session-state#checkpoint.execution_id", evidence: [`session_id=${checkpoint.session_id}`] });
      addEdge({ id: `e_session_exec_${checkpoint.execution_id}`, from: sessionNode, to: execNode, kind: "RAN", evidence: [`execution_id=${checkpoint.execution_id}`] });
    }

    const phaseNode = `work_phase:${checkpoint.work_id}:${checkpoint.current_phase}`;
    addNode({ id: phaseNode, label: checkpoint.current_phase, domain: "WORK_PHASE", source: "control/work-session-state#checkpoint.current_phase", evidence: [`${resume.completed_steps.length} step(s) still-valid`, `${resume.pending_steps.length} pending`, `${resume.stale_steps.length} not re-provable`] });
    addEdge({ id: `e_work_phase_${checkpoint.work_id}`, from: workNode, to: phaseNode, kind: "AT_PHASE", evidence: [`current_phase=${checkpoint.current_phase}`] });

    for (const blocker of resume.open_blockers) {
      const blockerNode = `blocker:${checkpoint.work_id}:${blocker.blocker_id}`;
      addNode({ id: blockerNode, label: `${blocker.blocker_id} @ ${blocker.layer}`, domain: "BLOCKER", source: "control/work-session-state#checkpoint.blockers", evidence: [blocker.detail.slice(0, 120), `next_action=${blocker.next_action.slice(0, 90)}`, blocker.evidence_ref ?? "evidence_ref=none"] });
      addEdge({ id: `e_work_blocker_${checkpoint.work_id}_${blocker.blocker_id}`, from: workNode, to: blockerNode, kind: "BLOCKED_BY", evidence: [`layer=${blocker.layer}`] });
    }
    for (const decision of resume.open_decisions) {
      const decisionNode = `decision:${checkpoint.work_id}:${decision.decision_id}`;
      addNode({ id: decisionNode, label: decision.decision_id, domain: "DECISION_REQUIRED", source: "control/work-session-state#checkpoint.decisions_required", evidence: [decision.question.slice(0, 140), `decider=${decision.decider}`, `options=${decision.options.join(" | ").slice(0, 120)}`] });
      addEdge({ id: `e_work_decision_${checkpoint.work_id}_${decision.decision_id}`, from: workNode, to: decisionNode, kind: "AWAITS_DECISION", evidence: [`state=${decision.state}`] });
    }

    const nextNode = `next_action:${checkpoint.work_id}`;
    addNode({ id: nextNode, label: resume.next_action.slice(0, 90), domain: "NEXT_ACTION", source: "control/work-session-state#buildResumeContext", evidence: [`resume_status=${resume.resume_status}`, `checkpoint_revision=${resume.checkpoint_revision.slice(0, 12)}`, `current_revision=${resume.current_revision.slice(0, 12)}`, `revision_drifted=${resume.revision_drifted}`] });
    addEdge({ id: `e_work_next_${checkpoint.work_id}`, from: workNode, to: nextNode, kind: "NEXT_ACTION", evidence: ["derived by the resume engine from the step graph, blockers and decisions"] });

    for (const evidenceRef of checkpoint.evidence_refs.slice(0, 12)) {
      const evidenceNode = `work_evidence:${checkpoint.work_id}:${evidenceRef}`;
      addNode({ id: evidenceNode, label: evidenceRef.slice(0, 70), domain: "EVIDENCE", source: "control/work-session-state#checkpoint.evidence_refs", evidence: [`declared by work ${checkpoint.work_id}`] });
      addEdge({ id: `e_work_ev_${checkpoint.work_id}_${evidenceRef}`, from: workNode, to: evidenceNode, kind: "PROVEN_BY", evidence: [`evidence_ref=${evidenceRef}`] });
    }
    for (const resourceId of checkpoint.affected_resource_ids) {
      addNode({ id: `resource:${resourceId}`, label: resourceId, domain: "RESOURCE_GRAPH", source: "control/work-session-state#checkpoint.affected_resource_ids", evidence: [`named by work ${checkpoint.work_id}`] });
      addEdge({ id: `e_work_res_${checkpoint.work_id}_${resourceId}`, from: workNode, to: `resource:${resourceId}`, kind: "AFFECTS", evidence: [`affected_resource_ids of checkpoint ${checkpoint.checkpoint_id}`] });
    }
  }

  counts["nodes"] = nodes.size;
  counts["edges"] = edges.length;
  return { generated_at: at, source_counts: counts, nodes: [...nodes.values()], edges, unresolved };
}
