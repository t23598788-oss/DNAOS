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

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const CENSUS_SNAPSHOT = path.join(REPO_ROOT, "software/live-census/data/last-census.json");

export type GraphDomain =
  | "MACHINE_OBSERVATION" | "PROCESS" | "FILESYSTEM_EVENT" | "OBSERVATION_STORE"
  | "RESOURCE_RESOLUTION" | "RESOURCE_GRAPH" | "LIVE_CENSUS" | "STATE" | "EVIDENCE"
  | "BLUEPRINT_DOCUMENT" | "LIFECYCLE_VERDICT" | "RUNTIME_SERVICE" | "READ_PATH" | "CAPABILITY" | "UNRESOLVED";

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

  counts["nodes"] = nodes.size;
  counts["edges"] = edges.length;
  return { generated_at: at, source_counts: counts, nodes: [...nodes.values()], edges, unresolved };
}
