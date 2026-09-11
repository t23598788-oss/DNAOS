/**
 * หน้าที่: project the software circuit that ALREADY EXISTS in this repo's
 * own records into one nodes/edges answer a viewer can draw.
 *
 * IT DISCOVERS NOTHING. Every node and every edge is read out of a producer
 * that already proved it:
 *
 *   ../live-census/              130 capability records: path, domain,
 *                                owner_boundary, dependencies, callers,
 *                                runtime_state, current_status, evidence refs
 *   ../live-census/#deriveEdges  the declared-dependency edges, WITH the
 *                                state and reason that capability already
 *                                computes (CONNECTED_VERIFIED / DECLARED_ONLY
 *                                / BROKEN ...) — not recomputed here
 *   ../../observability/joint-monitor/data/joints.jsonl
 *                                REAL observed calls: from_capability ->
 *                                to_capability, with timestamps. This is the
 *                                only thing that can make an edge ACTIVE.
 *   ../../control/runtime-control/#SERVICES + real health probes
 *   credentials/registry/        which providers a credential reference exists for
 *
 * WHY NO NEW SOURCE: adding a scanner here would make this a second opinion
 * about the architecture, and the repo would then have two answers to the
 * same question. This file is allowed to JOIN, never to decide.
 *
 * NO EVIDENCE = NO EDGE, enforced literally: `edge()` refuses to build
 * anything whose evidence_ref is empty, and the refusal is counted in
 * `unresolved` rather than swallowed.
 *
 * Input: none (reads persisted producer records).
 * Output: `buildSystemGraph`.
 * Dependency ที่อนุญาต: ../live-census/contract.ts,
 * ../../control/runtime-control/contract.ts, node built-ins.
 * สิ่งที่ห้ามแตะ: never draw an edge because two things share a folder, a
 * name, or a prefix. Never turn UNKNOWN into a pass. Never widen the
 * activity window to make a graph look busier than the machine is.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { get as httpGet } from "node:http";
import { loadPreviousSnapshot, deriveEdges } from "../live-census/contract";
import type { CapabilityRecord } from "../live-census/contract";
import { SERVICES, runOperation } from "../../control/runtime-control/contract";
import type { ServiceId } from "../../control/runtime-control/types";
import { MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE, canExecuteMacLocalAgentCapability } from "../../contracts/architecture/runtime-node-and-optional-provider";
import type { ConnectionType, Declared, EdgeRuntimeStatus, EdgeState, FlowKind, GraphEdge, GraphNode, InterfaceKind, NodeOperations, ProviderIdentity, SystemGraph, UndeclaredReason } from "./types";

const SOURCE_MARKER = "software/system-graph/projection.ts";
const REPO_ROOT = resolvePath(new URL("../..", import.meta.url).pathname);
const JOINTS = join(REPO_ROOT, "observability/joint-monitor/data/joints.jsonl");
const CREDENTIALS = join(REPO_ROOT, "credentials/registry/data/api-credential-references.jsonl");
const CENSUS_SNAPSHOT = join(REPO_ROOT, "software/live-census/data/last-census.json");
/**
 * The Persistent Registry is the ONLY place in this repo where a capability's
 * purpose, input_contract, output_contract and side_effects are written down
 * by the registration pipeline. The census type has input_contract/
 * output_contract fields too, but nothing populates them — 0 of 142 records
 * carry one, which is why every declared-dependency edge reads contract=UNKNOWN.
 * Joining here reads that producer; it does not become a second opinion,
 * because this file still never decides a value of its own.
 */
const REGISTRY_CAPABILITIES = join(REPO_ROOT, "software/registry-database/data/canonical/capabilities.jsonl");

/**
 * How recent an observed call must be for its edge to read ACTIVE.
 * 15 minutes: long enough that a periodic supervisor tick still counts,
 * short enough that "active" means something is happening now rather than
 * happened today. Declared, because a viewer's sense of "live" is entirely
 * this number.
 */
const ACTIVITY_WINDOW_MS = 15 * 60 * 1000;

interface JointRow { from_capability?: string; to_capability?: string; status?: string; summary?: string; source?: string; event_id?: string; at?: string; task_id?: string }

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* a half-written line is not a row */ }
  }
  return out;
}

function nodeId(kind: string, key: string): string { return `${kind}:${key}`; }

/**
 * The script a LaunchAgent actually runs, read out of the plist's own
 * ProgramArguments. Real evidence of what launchd executes — not a guess
 * from the service's name.
 */
function plistEntrypoint(plistPath: string): string | null {
  if (!existsSync(plistPath)) return null;
  try {
    const xml = readFileSync(plistPath, "utf8");
    const block = xml.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
    if (!block) return null;
    const args = [...block[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1].trim());
    // The first argument that looks like a source file this repo owns.
    return args.find((a) => /\.(ts|mjs|js)$/.test(a)) ?? args[args.length - 1] ?? null;
  } catch {
    return null;
  }
}

/** ค่าที่มีจริง พร้อมชื่อ producer ที่ให้มา */
function declared<T>(value: T, source: string): Declared<T> {
  return { value, undeclared_reason: null, source };
}

/** ค่าที่ยังไม่มี พร้อมเหตุผลที่นำไปทำอะไรต่อได้ ไม่ใช่ null เปล่า */
function undeclared<T>(reason: UndeclaredReason, source: string): Declared<T> {
  return { value: null, undeclared_reason: reason, source };
}

/**
 * The KIND of message a line carries, not the instances of it.
 *
 * A joint summary names one occurrence: "task task-4160d71d-... -> BLOCKED".
 * Counting those verbatim turns one meaning into 42 distinct "kinds", which
 * on screen reads as 42 different things flowing when it is one thing that
 * happened 42 times. Identifiers are replaced by a placeholder so the line
 * can say what it carries; the identifiers themselves stay in joints.jsonl,
 * which is where you go to chase a specific one.
 */
function summaryKind(summary: string | undefined): string {
  const text = (summary ?? "").trim();
  if (text === "") return "";
  const normalised = text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\btask-[A-Za-z0-9_-]+/g, "task-<id>")
    .replace(/\bwork-[A-Za-z0-9_-]+/g, "work-<id>")
    .replace(/\b\d{6,}\b/g, "<n>");
  // A "SOMETHING: detail" summary is a typed event; the type is the kind.
  // Anything else keeps its whole normalised sentence rather than being cut
  // at a colon that may not be a separator at all.
  const typed = normalised.match(/^([A-Z][A-Z0-9_]{2,}):/);
  return typed ? typed[1] : normalised;
}

const nonEmpty = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);

interface RegistryCapabilityRow {
  capability_id?: string;
  canonical_name?: string;
  purpose?: string;
  input_contract?: readonly string[];
  output_contract?: readonly string[];
  side_effects?: readonly string[];
  status?: string;
}

export interface BuildOptions {
  /** Probe every declared service for real health. Off by default: it costs real HTTP. */
  readonly probeServices?: boolean;
  readonly now?: number;
}

/**
 * CORE_NODE on non-darwin: HTTP health of declared ports may run.
 * launchctl / lsof / LaunchAgent host probes must not.
 */
export function coreNodeLiveServiceProbeKind(): "launchd_lsof_and_http" | "http_only" {
  return canExecuteMacLocalAgentCapability({ current_node: "CORE_NODE" }) ? "launchd_lsof_and_http" : "http_only";
}

/** Portable loopback GET against a declared health_path. Not a launchd/lsof probe. */
export function httpProbeDeclaredService(port: number, healthPath: string, timeoutMs = 1500): Promise<{ healthy: boolean; http_status: number | null }> {
  return new Promise((resolve) => {
    const req = httpGet({ host: "127.0.0.1", port, path: healthPath, timeout: timeoutMs }, (res) => {
      res.resume();
      const status = res.statusCode ?? null;
      resolve({ healthy: status !== null && status >= 200 && status < 400, http_status: status });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ healthy: false, http_status: null });
    });
    req.on("error", () => resolve({ healthy: false, http_status: null }));
  });
}

export async function buildSystemGraph(options: BuildOptions = {}): Promise<SystemGraph> {
  const now = options.now ?? Date.now();
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const unresolved: string[] = [];

  /** The only way an edge is created. An empty evidence_ref refuses, loudly. */
  const edge = (input: Omit<GraphEdge, "id" | "direction">): void => {
    if (!input.evidence_ref || input.evidence_ref.trim() === "") {
      unresolved.push(`edge ${input.from} -> ${input.to} (${input.connection_type}) was refused: no evidence_ref`);
      return;
    }
    if (!nodes.has(input.from) || !nodes.has(input.to)) {
      unresolved.push(`edge ${input.from} -> ${input.to} (${input.connection_type}) was refused: an endpoint is not a known node`);
      return;
    }
    edges.push({ ...input, id: `${input.connection_type}:${input.from}->${input.to}`, direction: "OUT" });
  };

  // ===== 0. THE REGISTRY, for the facts the census does not carry =======
  // role / inputs / outputs / produced evidence live only here. A capability
  // with no registry row cannot answer them, and says NOT_REGISTERED rather
  // than showing an empty box that reads the same as "takes nothing".
  const registryRows = readJsonl<RegistryCapabilityRow>(REGISTRY_CAPABILITIES);
  const registryById = new Map<string, RegistryCapabilityRow>();
  for (const row of registryRows) {
    if (row.capability_id) registryById.set(row.capability_id, row);
  }
  const registryAsOf = existsSync(REGISTRY_CAPABILITIES) ? statSync(REGISTRY_CAPABILITIES).mtime.toISOString() : null;

  /**
   * The seven operational facts for one capability, each joined from the
   * producer that actually recorded it. Nothing here infers: a missing value
   * becomes a reason, never a plausible-looking default.
   */
  const capabilityOperations = (record: CapabilityRecord): NodeOperations => {
    const registry = record.capability_id ? registryById.get(record.capability_id) ?? null : null;
    const registered = registry !== null;
    const REG = "software/registry-database#capabilities.jsonl";
    const CEN = "software/live-census#loadPreviousSnapshot";
    // No registry row = nobody ever declared what this does. That is a
    // different problem from "registered but left the field blank", and the
    // two need different follow-up, so they stay different tokens.
    const missing: UndeclaredReason = registered ? "NOT_DECLARED" : "NOT_REGISTERED";

    // The entrypoint is the real way in — the file launchd or a caller
    // actually reaches. It is evidence from git/census, not a guess from the
    // folder name.
    const entry = nonEmpty(record.entrypoint) ? String(record.entrypoint) : null;

    return {
      role: registry && nonEmpty(registry.purpose)
        ? declared(String(registry.purpose), REG) : undeclared<string>(missing, REG),
      inputs: registry && nonEmpty(registry.input_contract)
        ? declared(registry.input_contract as readonly string[], REG) : undeclared<readonly string[]>(missing, REG),
      outputs: registry && nonEmpty(registry.output_contract)
        ? declared(registry.output_contract as readonly string[], REG) : undeclared<readonly string[]>(missing, REG),
      interface_ref: entry ? declared(entry, CEN) : undeclared<string>("NOT_DECLARED", CEN),
      interface_kind: entry ? "SOURCE_ENTRYPOINT" : "NOT_DECLARED",
      // side_effects is where a registered capability says what it writes —
      // "appends OperationEvidence rows", "append-only JSONL at ...". That is
      // precisely "what evidence does it produce", recorded by its owner.
      produces_evidence: registry && nonEmpty(registry.side_effects)
        ? declared(registry.side_effects as readonly string[], REG) : undeclared<readonly string[]>(missing, REG),
      // owner_boundary is the folder that owns the code — the only ownership
      // any producer records. It is a boundary, not a person, and is labelled
      // as such on screen so nobody reads it as an on-call owner.
      owner: nonEmpty(record.owner_boundary)
        ? declared(`${record.owner_boundary}/ (repository boundary)`, CEN)
        : undeclared<string>("NOT_DECLARED", CEN),
      registration_state: registered ? "REGISTERED" : "NOT_REGISTERED",
    };
  };

  // ================= 1. CAPABILITIES, from the census ====================
  const census: readonly CapabilityRecord[] = loadPreviousSnapshot();
  const censusAsOf = existsSync(CENSUS_SNAPSHOT) ? statSync(CENSUS_SNAPSHOT).mtime.toISOString() : null;
  const byPath = new Map<string, CapabilityRecord>();

  for (const record of census) {
    byPath.set(record.path, record);
    const domain = record.domain || "unclassified";
    const domainNode = nodeId("domain", domain);
    if (!nodes.has(domainNode)) {
      nodes.set(domainNode, {
        id: domainNode, name: domain, type: "DOMAIN",
        boundary: "census domain", source_path: null, runtime_owner: null,
        runtime_status: "UNKNOWN", verification_status: "N/A",
        capability_id: null, service_id: null, domain, parent_id: null,
        evidence_refs: [`census:domain#${domain}`], source: "software/live-census#deriveCensus",
        // A domain is a classification, not a running thing. Every operational
        // question is NOT_APPLICABLE to it — which is a real answer, and a
        // different one from "we have not measured it yet".
        operations: {
          role: declared(`หมวดของวงจร — จัดกลุ่ม capability ที่ census จัดไว้ในโดเมนนี้`, "software/live-census#deriveCensus"),
          inputs: undeclared<readonly string[]>("NOT_APPLICABLE", "software/live-census#deriveCensus"),
          outputs: undeclared<readonly string[]>("NOT_APPLICABLE", "software/live-census#deriveCensus"),
          interface_ref: undeclared<string>("NOT_APPLICABLE", "software/live-census#deriveCensus"),
          interface_kind: "NOT_DECLARED",
          produces_evidence: undeclared<readonly string[]>("NOT_APPLICABLE", "software/live-census#deriveCensus"),
          owner: undeclared<string>("NOT_APPLICABLE", "software/live-census#deriveCensus"),
          registration_state: "NOT_APPLICABLE",
        },
        provider_identity: null,
      });
    }

    const id = nodeId("capability", record.capability_key);
    nodes.set(id, {
      id, name: record.canonical_name || record.path, type: "CAPABILITY",
      boundary: record.owner_boundary || "UNKNOWN",
      source_path: record.path,
      runtime_owner: record.owner_boundary || null,
      // census's own RuntimeState, mapped ONLY where the meanings line up.
      // Its vocabulary is richer than this graph's (IN_USE_NOW,
      // NO_CONSUMER_OBSERVED, SNAPSHOT_UNAVAILABLE ...); anything that is not
      // plainly running or plainly not running stays UNKNOWN rather than
      // being flattened into a colour that would overclaim.
      runtime_status:
        record.runtime_state === "RUNNING" || record.runtime_state === "IN_USE_NOW" ? "RUNNING"
          : record.runtime_state === "REGISTERED_NOT_RUNNING" ? "NOT_RUNNING"
            : "UNKNOWN",
      verification_status: record.current_status,
      capability_id: record.capability_id, service_id: null,
      domain, parent_id: domainNode,
      // A node's own existence is evidenced by the census record that
      // produced it, and its runtime claim by the field that made the
      // claim. Both are named explicitly — a node asserting RUNNING with an
      // empty evidence list is an unsourced claim, which the acceptance gate
      // rightly refused. `#` separates the key from the field because a
      // capability_key itself contains ':'.
      evidence_refs: [
        `census:${record.capability_key}#record`,
        `census:${record.capability_key}#runtime_state=${record.runtime_state}`,
        `census:${record.capability_key}#current_status=${record.current_status}`,
        ...record.evidence_references.slice(0, 4),
      ],
      source: "software/live-census#loadPreviousSnapshot",
      operations: capabilityOperations(record),
      provider_identity: null,
    });
  }

  // A capability sits inside its domain. This is a real containment recorded
  // by the census, not a visual grouping invented here.
  for (const record of census) {
    const domain = record.domain || "unclassified";
    edge({
      from: nodeId("domain", domain), to: nodeId("capability", record.capability_key),
      connection_type: "CONTAINS", contract: "census.domain", state: "CONNECTED_VERIFIED",
      runtime_status: "UNKNOWN", evidence_ref: `census:${record.capability_key}#domain=${domain}`,
      reason: "the census classifies this capability into this domain",
      source: "software/live-census#deriveCensus",
      // Nothing flows along a classification. Saying so explicitly is what
      // stops a viewer from counting 142 taxonomy lines as traffic.
      flow_kind: "CONTAINMENT",
      payload_semantic: undeclared<readonly string[]>("NOT_APPLICABLE", "software/live-census#deriveCensus"),
    });
  }

  // ================= 2. DECLARED DEPENDENCY EDGES ========================
  // States and reasons come from live-census itself. Recomputing them here
  // would be a second opinion about the same fact.
  for (const derived of deriveEdges(census)) {
    const from = byPath.get(derived.from);
    const to = byPath.get(derived.to);
    if (!from) { unresolved.push(`dependency edge from unknown path ${derived.from}`); continue; }
    if (!to) {
      // live-census already calls this BROKEN. Keep it visible as unresolved
      // rather than drawing a line to a node that does not exist.
      unresolved.push(`${derived.from} declares dependency on ${derived.to}, which is not a discovered capability (${derived.state})`);
      continue;
    }
    edge({
      from: nodeId("capability", from.capability_key), to: nodeId("capability", to.capability_key),
      connection_type: "DEPENDENCY",
      contract: to.input_contract?.[0] ?? "UNKNOWN",
      state: derived.state as EdgeState,
      runtime_status: "UNKNOWN",
      evidence_ref: `census:${from.capability_key}#dependencies[]=${derived.to}`,
      reason: derived.reason,
      source: "software/live-census#deriveEdges",
      flow_kind: "DECLARED_IMPORT",
      // A declared import proves the code CAN call; it never proves anything
      // moved, and no producer records what would move. Guessing a payload
      // from the two capability names is exactly the invented relationship
      // this graph refuses to draw.
      payload_semantic: undeclared<readonly string[]>("NOT_MEASURED", "software/live-census#deriveEdges"),
    });
  }

  // ================= 3. OBSERVED RUNTIME CALLS ===========================
  // The ONLY producer that can make an edge ACTIVE. Each row is a real call
  // one capability reported making to another, with a collector timestamp.
  const joints = readJsonl<JointRow>(JOINTS);
  const jointsAsOf = joints.length > 0 ? joints[joints.length - 1].at ?? null : null;

  /** capability path -> census key, so a joint's free-text name can be matched to a real node. */
  const resolveCapability = (name: string | undefined): CapabilityRecord | null => {
    if (!name) return null;
    const cleaned = name.trim();
    if (cleaned === "") return null;
    // exact path first
    const direct = byPath.get(cleaned);
    if (direct) return direct;
    // a joint may name a FILE inside a capability — attribute it to the
    // capability that owns the file, which is a real containment, not a guess
    for (const [path, record] of byPath) {
      if (cleaned.startsWith(`${path}/`)) return record;
    }
    // or it may name the capability by its canonical name
    for (const record of byPath.values()) {
      if (record.canonical_name === cleaned) return record;
    }
    return null;
  };

  const runtimePairs = new Map<string, { from: CapabilityRecord; to: CapabilityRecord; count: number; last: string; lastStatus: string; evidence: string; summaries: Map<string, number> }>();
  let unmatchedJoints = 0;
  let internalJoints = 0;
  const unmatchedNames = new Map<string, number>();
  for (const row of joints) {
    const from = resolveCapability(row.from_capability);
    const to = resolveCapability(row.to_capability);
    if (!from || !to) {
      unmatchedJoints += 1;
      // Name the endpoint that could not be resolved, so the gap is
      // actionable instead of a number nobody can chase.
      for (const [raw, resolved] of [[row.from_capability, from], [row.to_capability, to]] as const) {
        if (!resolved && raw) unmatchedNames.set(raw, (unmatchedNames.get(raw) ?? 0) + 1);
      }
      continue;
    }
    if (from.capability_key === to.capability_key) {
      // A call INSIDE one capability is real, but it is not a connection
      // between two components — drawing it would be a self-loop that says
      // nothing about topology.
      internalJoints += 1;
      continue;
    }
    const key = `${from.capability_key}->${to.capability_key}`;
    const previous = runtimePairs.get(key);
    const at = row.at ?? "";
    // WHAT ACTUALLY MOVED, in the reporter's own words. A joint row's
    // `summary` is written by the capability making the call
    // ("COMMAND_RECEIVED: resolution", "WORK_BLOCKED: ..."), so it is the one
    // real record of a payload's meaning anywhere in this repo. Kept as the
    // distinct kinds seen with how often, not as free text, so the screen can
    // say "this line carries these two kinds of message" instead of showing
    // one arbitrary last sentence.
    const summaries = previous?.summaries ?? new Map<string, number>();
    const kind = summaryKind(row.summary);
    if (kind !== "") summaries.set(kind, (summaries.get(kind) ?? 0) + 1);
    if (previous === undefined || at > previous.last) {
      runtimePairs.set(key, {
        from, to, count: (previous?.count ?? 0) + 1,
        last: at || previous?.last || "", lastStatus: row.status ?? previous?.lastStatus ?? "UNKNOWN",
        evidence: `joint-monitor:${row.event_id ?? "no-event-id"}`,
        summaries,
      });
    } else {
      previous.count += 1;
    }
  }
  if (internalJoints > 0) {
    unresolved.push(`${internalJoints} observed call(s) were internal to a single capability — real, but not a connection between components`);
  }
  if (unmatchedJoints > 0) {
    const worst = [...unmatchedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => `${name} (${count})`);
    unresolved.push(`${unmatchedJoints} observed call(s) name something the census does not know — reported, not drawn. Most frequent: ${worst.join(", ")}`);
  }

  for (const pair of runtimePairs.values()) {
    const ageMs = pair.last ? now - Date.parse(pair.last) : Number.POSITIVE_INFINITY;
    const active = Number.isFinite(ageMs) && ageMs <= ACTIVITY_WINDOW_MS;
    // NOT "BROKEN". A joint's `status` is the WORK's outcome, not the call's:
    // a row saying WORK_BLOCKED means the call arrived fine and the work was
    // blocked. An earlier draft marked those edges BROKEN and painted five
    // perfectly working connections as failures. A connection is only BROKEN
    // when a producer says the CONNECTION failed — which joint rows never do.
    // The observed status is carried as data so a reader can judge it.
    const runtimeStatus: EdgeRuntimeStatus = active ? "ACTIVE" : pair.last ? "INACTIVE" : "UNKNOWN";
    edge({
      from: nodeId("capability", pair.from.capability_key), to: nodeId("capability", pair.to.capability_key),
      connection_type: "RUNTIME_CALL", contract: "joint report", state: "OBSERVED_RUNTIME",
      runtime_status: runtimeStatus, evidence_ref: pair.evidence,
      reason: `${pair.count} observed call(s); last ${pair.last || "unknown"}; last reported work status=${pair.lastStatus} (the work's outcome, not the connection's)`,
      source: "observability/joint-monitor/data/joints.jsonl",
      observed_calls: pair.count, last_observed_at: pair.last || undefined,
      flow_kind: "DATA_FLOW",
      payload_semantic: pair.summaries.size > 0
        ? declared(
            [...pair.summaries.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`),
            "observability/joint-monitor/data/joints.jsonl#summary",
          )
        : undeclared<readonly string[]>("NOT_MEASURED", "observability/joint-monitor/data/joints.jsonl"),
    });
  }

  // ================= 4. SERVICES, with real health =======================
  const serviceIds = Object.keys(SERVICES as Record<string, unknown>);
  for (const serviceId of serviceIds) {
    const definition = (SERVICES as Record<string, { launchd_label: string; port: number; health_path: string }>)[serviceId];
    let runtimeStatus: GraphNode["runtime_status"] = "UNKNOWN";
    let evidence = `runtime-control#SERVICES:${serviceId}`;
    if (options.probeServices) {
      const probeKind = coreNodeLiveServiceProbeKind();
      if (probeKind === "http_only") {
        try {
          const probe = await httpProbeDeclaredService(definition.port, definition.health_path);
          runtimeStatus = probe.healthy ? "HEALTHY" : "UNHEALTHY";
          evidence = `http:127.0.0.1:${definition.port}${definition.health_path}; ${MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE}: launchd/lsof not attempted`;
        } catch (error) {
          runtimeStatus = "UNKNOWN";
          evidence = `${MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE}: ${error instanceof Error ? error.message : String(error)}`;
        }
      } else {
        try {
          const probe = await runOperation(serviceId as ServiceId, "health");
          runtimeStatus = probe.health_after.healthy === true ? "HEALTHY" : "UNHEALTHY";
          evidence = `runtime-control:${probe.operation_id}`;
        } catch (error) {
          runtimeStatus = "UNKNOWN";
          evidence = `runtime-control probe failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    }
    const id = nodeId("service", serviceId);
    nodes.set(id, {
      id, name: serviceId, type: "SERVICE",
      boundary: "launchd (macOS user domain)",
      source_path: null, runtime_owner: definition.launchd_label,
      runtime_status: runtimeStatus,
      verification_status: options.probeServices
        ? (coreNodeLiveServiceProbeKind() === "http_only" ? "HTTP_PROBED_MAC_HOST_DEFERRED" : "PROBED")
        : "NOT_PROBED",
      capability_id: null, service_id: serviceId, domain: "runtime", parent_id: null,
      evidence_refs: [evidence, `launchd:${definition.launchd_label}`, `port:${definition.port}${definition.health_path}`],
      source: "control/runtime-control#SERVICES",
      // A service's operational facts are fully known, because runtime-control
      // declares all of them and launchd proves them: the port is the real
      // way in, the LaunchAgent label is the real owner of the process.
      operations: {
        role: declared(`process ที่ launchd ดูแล ฟังอยู่ที่ 127.0.0.1:${definition.port}`, "control/runtime-control#SERVICES"),
        inputs: declared([`HTTP ที่ 127.0.0.1:${definition.port}`], "control/runtime-control#SERVICES"),
        outputs: declared([`HTTP response; health ที่ ${definition.health_path}`], "control/runtime-control#SERVICES"),
        interface_ref: declared(`127.0.0.1:${definition.port}${definition.health_path}`, "control/runtime-control#SERVICES"),
        interface_kind: "HTTP_PORT",
        produces_evidence: declared(
          [`launchd job state (${definition.launchd_label})`, `health probe ที่ ${definition.health_path}`],
          "control/runtime-control#SERVICES",
        ),
        owner: declared(`${definition.launchd_label} (LaunchAgent)`, "control/runtime-control#SERVICES"),
        registration_state: "NOT_APPLICABLE",
      },
      provider_identity: null,
    });
  }

  // A service is executed BY launchd and its code lives in a capability.
  // Both halves are real: the plist names the entrypoint, the census owns the path.
  for (const serviceId of serviceIds) {
    const definition = (SERVICES as Record<string, { plist_path: string }>)[serviceId];
    // THE PLIST NAMES THE ENTRYPOINT. That file path is hard evidence of
    // which code launchd actually runs — far better than matching the
    // service id against a folder name, which failed for every service
    // whose folder is named differently from its service id
    // (machine-observer runs control/machine-observation, and so on).
    const entrypoint = plistEntrypoint(definition.plist_path);
    const owner = entrypoint === null
      ? null
      : [...byPath.values()]
          .filter((record) => entrypoint.includes(`/${record.path}/`) || entrypoint.endsWith(`/${record.path}`))
          // longest path wins: control/machine-observation beats control
          .sort((a, b) => b.path.length - a.path.length)[0] ?? null;
    if (!owner) {
      unresolved.push(`service "${serviceId}": ${entrypoint === null ? `could not read an entrypoint from ${definition.plist_path}` : `entrypoint ${entrypoint} is not inside any capability the census knows`} — no edge drawn`);
      continue;
    }
    edge({
      from: nodeId("capability", owner.capability_key), to: nodeId("service", serviceId),
      connection_type: "RUNTIME_EXECUTION", contract: "launchd LaunchAgent", state: "CONNECTED_VERIFIED",
      runtime_status: nodes.get(nodeId("service", serviceId))?.runtime_status === "HEALTHY" ? "ACTIVE" : "UNKNOWN",
      evidence_ref: `plist:${definition.plist_path}#ProgramArguments=${entrypoint}`,
      reason: `launchd runs ${entrypoint}, which lives inside this capability, as service "${serviceId}"`,
      source: "control/runtime-control#SERVICES",
      flow_kind: "PROCESS_EXECUTION",
      payload_semantic: declared([`launchd spawn ของ ${entrypoint}`], "plist:ProgramArguments"),
    });
  }

  // ================= 5. PROVIDERS, from credential references ============
  interface CredentialRow { provider?: string; account?: string; status?: string; credential_ref?: string }
  const credentials = readJsonl<CredentialRow>(CREDENTIALS);
  const credentialsAsOf = existsSync(CREDENTIALS) ? statSync(CREDENTIALS).mtime.toISOString() : null;
  const providers = new Map<string, CredentialRow>();
  for (const row of credentials) {
    const provider = (row.provider ?? "").toLowerCase();
    if (provider === "") continue;
    if (!providers.has(provider) || row.status === "ACTIVE") providers.set(provider, row);
  }
  for (const [provider, row] of providers) {
    const id = nodeId("provider", provider);
    nodes.set(id, {
      id, name: provider, type: "PROVIDER",
      boundary: "external provider",
      source_path: null, runtime_owner: null,
      // ไม่มี producer ไหนวัดสถานะ provider จริง จึงเป็น UNKNOWN ไม่ใช่เขียว
      runtime_status: "UNKNOWN",
      verification_status: row.status ?? "UNKNOWN",
      capability_id: null, service_id: null, domain: "external", parent_id: null,
      evidence_refs: [`credential-reference:${row.credential_ref ?? "unknown"}`],
      source: "credentials/registry/data/api-credential-references.jsonl",
      // WHAT WE HONESTLY KNOW ABOUT SOMEONE ELSE'S SYSTEM: that we hold a
      // credential for it, for a named account. Not its purpose, not its
      // inputs, not its outputs — those live inside a system we do not run
      // and cannot observe. Every one of them is NOT_APPLICABLE rather than
      // an empty field, because "we cannot know this" and "nobody filled this
      // in" are different facts and only one of them is anyone's to fix.
      operations: {
        role: undeclared<string>("NOT_APPLICABLE", "credentials/registry"),
        inputs: undeclared<readonly string[]>("NOT_APPLICABLE", "credentials/registry"),
        outputs: undeclared<readonly string[]>("NOT_APPLICABLE", "credentials/registry"),
        interface_ref: row.credential_ref
          ? declared(row.credential_ref, "credentials/registry/data/api-credential-references.jsonl")
          : undeclared<string>("NOT_DECLARED", "credentials/registry"),
        interface_kind: row.credential_ref ? "CREDENTIAL_SCOPE" : "NOT_DECLARED",
        produces_evidence: undeclared<readonly string[]>("NOT_APPLICABLE", "credentials/registry"),
        owner: declared(`${provider} (ผู้ให้บริการภายนอก ไม่ใช่ DNA OS)`, "credentials/registry"),
        registration_state: "NOT_APPLICABLE",
      },
      provider_identity: {
        provider_key: provider,
        display_name: provider,
        account: row.account ?? null,
        credential_ref: row.credential_ref ?? null,
        credential_status: row.status ?? "UNKNOWN",
        outside_dna_os: true,
      },
    });
  }

  // ================= counts =============================================
  const nodesByType: Record<string, number> = {};
  for (const node of nodes.values()) nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;
  const edgesByType: Record<string, number> = {};
  const edgesByRuntime: Record<string, number> = {};
  for (const item of edges) {
    edgesByType[item.connection_type] = (edgesByType[item.connection_type] ?? 0) + 1;
    edgesByRuntime[item.runtime_status] = (edgesByRuntime[item.runtime_status] ?? 0) + 1;
  }
  const connected = new Set<string>();
  for (const item of edges) { connected.add(item.from); connected.add(item.to); }

  // HOW MUCH OF THE CIRCUIT CAN ACTUALLY ANSWER THE SEVEN QUESTIONS.
  // Published as a count so a viewer states the gap instead of implying
  // completeness by drawing every node the same way.
  const answerable: Record<string, number> = {};
  const applicable: Record<string, number> = {};
  for (const node of nodes.values()) {
    for (const field of ["role", "inputs", "outputs", "interface_ref", "produces_evidence", "owner"] as const) {
      const cell = node.operations[field];
      if (cell.undeclared_reason === "NOT_APPLICABLE") continue;
      applicable[field] = (applicable[field] ?? 0) + 1;
      if (cell.value !== null) answerable[field] = (answerable[field] ?? 0) + 1;
    }
  }
  const flowKinds: Record<string, number> = {};
  for (const item of edges) flowKinds[item.flow_kind] = (flowKinds[item.flow_kind] ?? 0) + 1;

  return {
    generated_at: new Date().toISOString(),
    nodes: [...nodes.values()],
    edges,
    sources: [
      { id: "live-census", detail: `${census.length} capability record(s)`, as_of: censusAsOf, available: census.length > 0 },
      { id: "joint-monitor", detail: `${joints.length} observed call row(s), ${runtimePairs.size} distinct pair(s)`, as_of: jointsAsOf, available: joints.length > 0 },
      { id: "runtime-control", detail: `${serviceIds.length} declared service(s)${options.probeServices ? (coreNodeLiveServiceProbeKind() === "http_only" ? ", HTTP probed (mac host deferred)" : ", probed live") : ", not probed"}`, as_of: null, available: true },
      { id: "credentials-registry", detail: `${providers.size} provider(s) with a credential reference`, as_of: credentialsAsOf, available: providers.size > 0 },
      { id: "persistent-registry", detail: `${registryRows.length} registered capability row(s) — the only source of role/inputs/outputs/produced-evidence`, as_of: registryAsOf, available: registryRows.length > 0 },
    ],
    counts: {
      nodes_by_type: nodesByType,
      edges_by_type: edgesByType,
      edges_by_runtime_status: edgesByRuntime,
      nodes_without_edges: [...nodes.keys()].filter((id) => !connected.has(id)).length,
      edges_by_flow_kind: flowKinds,
      operational_facts_declared: answerable,
      operational_facts_applicable: applicable,
    },
    unresolved,
  };
}
