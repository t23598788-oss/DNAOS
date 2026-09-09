/**
 * หน้าที่: read-only projection for the Engineering Research Monitor.
 *
 * This is not a control plane, registry, or database. It normalizes current
 * observations from existing HTTP endpoints and append-only stores into one
 * UI-facing activity shape. It never writes, never stores source-code bodies,
 * and never returns evidence payload bodies.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listConnectionDeclarations } from "../../connections/connection-registry/declaration-registry";
import { readTelemetry } from "../../connections/telemetry/summary";
import { listReservations, listLocalWorkspaces, listWorkspaceCleanupEvidence } from "../../control/source-workspace/contract";

type FieldStatus = "MEASURED" | "NOT_MEASURED" | "DATA_MISSING";
type EventStatus = "LIVE" | "OK" | "STALE" | "OFFLINE" | "BLOCKED" | "FAILED" | "COMPLETED" | "RUNNING" | "DATA_MISSING" | string;

export interface MonitorActivityEvent {
  time: string;
  source: string;
  provider: string | null;
  resource: string | null;
  capability: string | null;
  work_id: string | null;
  execution_id: string | null;
  event_type: string;
  status: EventStatus;
  duration_ms: number | null;
  latency_ms: number | null;
  input_count: number | null;
  output_count: number | null;
  cost_usd: number | null;
  cost_thb: number | null;
  cpu: number | null;
  ram: number | null;
  disk: number | null;
  network: number | null;
  retry: number | null;
  error: string | null;
  bottleneck: string | null;
  health: string | null;
  evidence_ref: string | null;
  source_endpoint: string;
}

export interface MonitorSourceInventory {
  source: string;
  endpoint_or_store: string;
  collector_or_adapter: string;
  status: EventStatus;
  measured_fields: readonly string[];
  missing_fields: readonly string[];
  evidence_ref: string | null;
}

export interface MonitorActivitySnapshot {
  status: "ok";
  generated_at: string;
  schema_version: "DNA_OS_MONITOR_ACTIVITY_V1";
  rule: "read-only projection over existing stores/endpoints";
  field_contract: Record<string, FieldStatus>;
  inventory: readonly MonitorSourceInventory[];
  events: readonly MonitorActivityEvent[];
  summary: {
    total_events: number;
    live_sources: number;
    offline_sources: number;
    failed_or_blocked_events: number;
    measured_cost_events: number;
    measured_resource_events: number;
  };
}

interface HttpProbe<T = unknown> {
  ok: boolean;
  status: number | null;
  latency_ms: number | null;
  url: string;
  body: T | null;
  error: string | null;
}

const OWNER_BASE = process.env.DNA_OS_OWNER_INTERNAL_API_URL ?? "http://127.0.0.1:8791";
const RESEARCH_BASE = process.env.DNA_OS_RESEARCH_API_URL ?? "http://127.0.0.1:8787";
const MONITOR_UI_BASE = process.env.DNA_OS_RESEARCH_MONITOR_UI_URL ?? "http://127.0.0.1:5177";
const JOINT_MONITOR_BASE = process.env.DNA_OS_JOINT_MONITOR_URL ?? "http://127.0.0.1:5178";
const DNA_OS_COMPUTE_BASE = process.env.DNA_OS_COMPUTE_API_URL ?? "http://127.0.0.1:8788";
const MCP_BASE = process.env.DNA_OS_MCP_URL ?? "http://127.0.0.1:8793/mcp";

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function tailJsonl(file: string, limit: number): Record<string, unknown>[] {
  const path = join(process.cwd(), file);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0);
  return lines.slice(-limit).flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as unknown;
      return isRecord(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

async function httpJson<T = unknown>(url: string, init?: RequestInit): Promise<HttpProbe<T>> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, { cache: "no-store", ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { ok: response.ok, status: response.status, latency_ms: Date.now() - started, url, body: body as T, error: null };
  } catch (error) {
    return { ok: false, status: null, latency_ms: Date.now() - started, url, body: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function listeningProcess(port: number): { pid: number | null; command: string | null; evidence: string } {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", timeout: 1500 }).trim();
    const rows = out.split("\n");
    const cols = rows[1]?.trim().split(/\s+/) ?? [];
    return { command: cols[0] ?? null, pid: cols[1] ? Number(cols[1]) : null, evidence: `lsof:tcp:${port}` };
  } catch {
    return { command: null, pid: null, evidence: `lsof:tcp:${port}:NOT_LISTENING` };
  }
}

function gitMetadataEvent(): MonitorActivityEvent {
  const time = nowIso();
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 1500 }).trim();
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", timeout: 1500 }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", timeout: 1500 }).trim().length > 0;
    const latestTime = execFileSync("git", ["log", "-1", "--format=%cI"], { encoding: "utf8", timeout: 1500 }).trim();
    return event({
      time: latestTime || time,
      source: "git",
      provider: "github",
      resource: branch,
      event_type: "GIT_REVISION",
      status: dirty ? "DIRTY_WORKTREE" : "CLEAN",
      evidence_ref: `git:${sha}`,
      source_endpoint: "local git metadata",
    });
  } catch (error) {
    return event({ time, source: "git", provider: "github", event_type: "GIT_REVISION", status: "DATA_MISSING", error: error instanceof Error ? error.message : String(error), source_endpoint: "local git metadata" });
  }
}

function event(input: Partial<MonitorActivityEvent> & Pick<MonitorActivityEvent, "time" | "source" | "event_type" | "status" | "source_endpoint">): MonitorActivityEvent {
  return {
    provider: null,
    resource: null,
    capability: null,
    work_id: null,
    execution_id: null,
    duration_ms: null,
    latency_ms: null,
    input_count: null,
    output_count: null,
    cost_usd: null,
    cost_thb: null,
    cpu: null,
    ram: null,
    disk: null,
    network: null,
    retry: null,
    error: null,
    bottleneck: null,
    health: null,
    evidence_ref: null,
    ...input,
  };
}

function endpointEvent(source: string, probe: HttpProbe, capability: string | null = null): MonitorActivityEvent {
  return event({
    time: nowIso(),
    source,
    capability,
    event_type: "HEALTH_PROBE",
    status: probe.ok ? "LIVE" : "OFFLINE",
    latency_ms: probe.latency_ms,
    health: probe.status === null ? "NO_HTTP_STATUS" : `HTTP_${probe.status}`,
    error: probe.error,
    evidence_ref: `probe:${probe.url}`,
    source_endpoint: probe.url,
  });
}

function sourceInventory(source: string, endpoint_or_store: string, collector_or_adapter: string, status: EventStatus, measured: string[], missing: string[], evidence_ref: string | null): MonitorSourceInventory {
  return { source, endpoint_or_store, collector_or_adapter, status, measured_fields: measured, missing_fields: missing, evidence_ref };
}

function compactConnectionEvents(time: string): MonitorActivityEvent[] {
  return listConnectionDeclarations().map((connection) => event({
    time: connection.declared_at,
    source: "connection-registry",
    provider: connection.provider_id,
    resource: connection.canonical_target_id,
    capability: connection.executor_capability_id,
    event_type: connection.connection_type,
    status: connection.state,
    health: connection.health_probe ?? "NOT_MEASURED",
    evidence_ref: connection.verification_evidence_id,
    source_endpoint: "connections/connection-registry/data/connection-declarations.jsonl",
  })).concat(
    tailJsonl("connections/provider-authorization/data/authorizations.jsonl", 40).map((row) => event({
      time: asString(row.updated_at) ?? time,
      source: "provider-authorization",
      provider: asString(row.provider),
      resource: asString(row.connection_id),
      event_type: "AUTHORIZATION_STATE",
      status: asString(row.state) ?? "DATA_MISSING",
      error: asString(row.failure_reason),
      evidence_ref: asString(row.credential_ref),
      source_endpoint: "connections/provider-authorization/data/authorizations.jsonl",
    })),
  );
}

function compactTaskEvents(time: string): MonitorActivityEvent[] {
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of tailJsonl("control/agent-gateway/data/tasks.jsonl", 600)) {
    const taskId = asString(row.task_id);
    if (taskId) latest.set(taskId, row);
  }
  return [...latest.values()].slice(-120).map((row) => {
    const workOrder = isRecord(row.work_order) ? row.work_order : null;
    return event({
      time: asString(row.updated_at) ?? asString(row.created_at) ?? time,
      source: "agent-gateway",
      resource: asString(workOrder?.target_type),
      capability: null,
      work_id: asString(workOrder?.work_order_id),
      execution_id: asString(row.task_id),
      event_type: "WORK_STATE",
      status: asString(row.status) ?? "DATA_MISSING",
      evidence_ref: asString(row.task_id),
      source_endpoint: "control/agent-gateway/data/tasks.jsonl",
    });
  });
}

function compactEvidenceEvents(time: string): MonitorActivityEvent[] {
  return tailJsonl("control/agent-gateway/data/evidence.jsonl", 120).map((row) => {
    const payload = isRecord(row.payload) ? row.payload : {};
    const hasError = typeof payload.error === "string" || row.kind === "error";
    return event({
      time: asString(row.recorded_at) ?? time,
      source: "agent-gateway-evidence",
      resource: asString(row.source),
      work_id: asString(row.work_order_id),
      execution_id: asString(row.task_id),
      event_type: asString(row.kind) ?? "EVIDENCE",
      status: hasError ? "FAILED" : "OK",
      error: hasError ? "ERROR_RECORDED_IN_EVIDENCE_PAYLOAD" : null,
      evidence_ref: asString(row.evidence_id),
      source_endpoint: "control/agent-gateway/data/evidence.jsonl",
    });
  });
}

function sourceWorkspaceEvents(time: string): MonitorActivityEvent[] {
  const reservations = listReservations().slice(-80).map((r) => event({
    time: r.created_at,
    source: "source-workspace",
    resource: r.repository_id,
    work_id: r.work_id,
    event_type: "WORKSPACE_RESERVATION",
    status: "RESERVED",
    evidence_ref: r.reservation_id,
    source_endpoint: "control/source-workspace/data/reservations.jsonl",
  }));
  const workspaces = listLocalWorkspaces().slice(-80).map((w) => event({
    time: w.updated_at,
    source: "source-workspace",
    resource: w.purpose,
    work_id: w.work_id,
    event_type: "LOCAL_WORKSPACE_STATE",
    status: w.current_state,
    evidence_ref: w.workspace_id,
    source_endpoint: "control/source-workspace/data/local-workspaces.jsonl",
  }));
  const cleanup = listWorkspaceCleanupEvidence().slice(-40).map((c) => event({
    time: asString(c.recorded_at) ?? time,
    source: "source-workspace",
    resource: asString(c.path_kind) ?? asString(c.workspace_id),
    work_id: asString(c.work_id),
    event_type: "WORKSPACE_CLEANUP",
    status: asString(c.status) ?? asString(c.note) ?? "UNKNOWN",
    error: asString(c.status) === "FAILED" || asString(c.status) === "BLOCKED" ? "CLEANUP_FAILED" : null,
    evidence_ref: asString(c.evidence_id) ?? asString(c.cleanup_id),
    source_endpoint: "control/source-workspace/data/workspace-cleanup.jsonl",
  }));
  return reservations.concat(workspaces, cleanup);
}

function telemetryEvent(time: string): MonitorActivityEvent {
  const telemetry = readTelemetry();
  if (!telemetry.snapshot) {
    return event({ time, source: "connections/telemetry", event_type: "MACHINE_TELEMETRY", status: "DATA_MISSING", source_endpoint: "connections/telemetry/data/snapshots.jsonl" });
  }
  const s = telemetry.snapshot;
  return event({
    time: s.captured_at,
    source: "connections/telemetry",
    provider: "LOCAL_MAC",
    resource: "machine",
    event_type: "MACHINE_TELEMETRY",
    status: telemetry.freshness.status,
    cpu: s.cpu_ram.load_avg_1m,
    ram: s.cpu_ram.free_mem_bytes,
    disk: s.disk.capacity_percent,
    network: s.network_interfaces.length,
    health: telemetry.freshness.reason,
    evidence_ref: s.snapshot_id,
    source_endpoint: "connections/telemetry/data/snapshots.jsonl",
  });
}

function processEvents(time: string): MonitorActivityEvent[] {
  return [
    { source: "DNA OS Core / owner-command", port: 8791, endpoint: OWNER_BASE },
    { source: "Research API", port: 8787, endpoint: RESEARCH_BASE },
    { source: "Research Monitor UI", port: 5177, endpoint: MONITOR_UI_BASE },
    { source: "Joint Monitor", port: 5178, endpoint: JOINT_MONITOR_BASE },
    { source: "dna_os compute API", port: 8788, endpoint: DNA_OS_COMPUTE_BASE },
    { source: "DNA_OS_RUNTIME / MCP", port: 8793, endpoint: MCP_BASE },
  ].map((p) => {
    const proc = listeningProcess(p.port);
    return event({
      time,
      source: "machine-observation",
      provider: "LOCAL_MAC",
      resource: p.endpoint,
      event_type: "PROCESS_LISTENING",
      status: proc.pid === null ? "OFFLINE" : "LIVE",
      health: proc.command ? `${proc.command} pid=${proc.pid}` : "NOT_LISTENING",
      evidence_ref: proc.evidence,
      source_endpoint: "lsof -nP -iTCP:<port> -sTCP:LISTEN",
    });
  });
}

function extractResearchEvents(time: string, lineage: HttpProbe, active: HttpProbe, cost: HttpProbe, local: HttpProbe): MonitorActivityEvent[] {
  const out: MonitorActivityEvent[] = [endpointEvent("Research API", lineage, "research-engine"), endpointEvent("Research executions", active), endpointEvent("Research cost", cost), endpointEvent("Research local telemetry", local)];
  const body = isRecord(lineage.body) ? lineage.body : null;
  const execution = isRecord(body?.execution) ? body.execution : null;
  const metadata = isRecord(execution?.metadata) ? execution.metadata : null;
  const proc = isRecord(metadata?.process_measurement) ? metadata.process_measurement : null;
  if (body) {
    const lifecycle = isRecord(body.lifecycle) ? body.lifecycle : {};
    out.push(event({
      time: asString(execution?.ended_at) ?? asString(execution?.started_at) ?? time,
      source: "research-engine",
      provider: asString(execution?.provider),
      resource: asString(execution?.compute_source_id),
      capability: "research-engine",
      work_id: asString(metadata?.work_id),
      execution_id: asString(execution?.execution_id),
      event_type: "RESEARCH_LINEAGE_LATEST",
      status: asString(execution?.status) ?? "DATA_MISSING",
      duration_ms: asNumber(execution?.elapsed_ms),
      latency_ms: asNumber(lifecycle.cold_start_latency_ms),
      input_count: asNumber(execution?.input_tokens),
      output_count: asNumber(execution?.output_tokens),
      cost_usd: asNumber(execution?.cost_usd),
      cost_thb: asNumber(execution?.cost_thb),
      cpu: asNumber(execution?.local_cpu_time_ms),
      ram: asNumber(execution?.ram_peak_mb),
      disk: asNumber(isRecord(proc?.measurements) && isRecord(proc.measurements.disk_read_bytes) ? proc.measurements.disk_read_bytes.value : null),
      network: asNumber(execution?.network_bytes),
      retry: asNumber(execution?.retry_count),
      health: asString(execution?.cost_source) ?? "NOT_MEASURED",
      evidence_ref: asString(proc?.evidence_ref),
      source_endpoint: `${RESEARCH_BASE}/api/research/lineage/latest`,
    }));
  }
  const costBody = isRecord(cost.body) ? cost.body : null;
  const today = isRecord(costBody?.today) ? costBody.today : null;
  if (today) {
    out.push(event({
      time,
      source: "research-engine",
      event_type: "EXECUTION_COST_SUMMARY",
      status: "OK",
      input_count: asNumber(today.input_tokens),
      output_count: asNumber(today.output_tokens),
      cost_usd: asNumber(today.cost_usd),
      cost_thb: asNumber(today.cost_thb),
      health: `cost_not_measured=${String(today.cost_not_measured_count ?? "DATA_MISSING")}`,
      source_endpoint: `${RESEARCH_BASE}/api/executions/cost-summary`,
    }));
  }
  return out;
}

function extractComputeEvents(time: string, offers: HttpProbe, costs: HttpProbe): MonitorActivityEvent[] {
  const out: MonitorActivityEvent[] = [endpointEvent("dna_os compute API", offers), endpointEvent("dna_os execution cost", costs)];
  const offerBody = isRecord(offers.body) ? offers.body : null;
  const offerRows = Array.isArray(offerBody?.offers) ? offerBody.offers.filter(isRecord).slice(0, 40) : [];
  for (const row of offerRows) {
    out.push(event({
      time: asString(row.calculated_at) ?? time,
      source: "dna_os.compute",
      provider: asString(row.provider) ?? asString(row.source_id),
      resource: asString(row.gpu_type),
      event_type: "GPU_OFFER",
      status: asString(row.measurement_status) ?? asString(row.availability) ?? "OK",
      cost_usd: asNumber(row.price_usd_per_hour),
      cost_thb: asNumber(row.price_thb_per_hour),
      ram: asNumber(row.memory_gb),
      health: asString(row.fx_rate_source),
      evidence_ref: asString(row.evidence_id),
      source_endpoint: `${DNA_OS_COMPUTE_BASE}/api/gpu/offers`,
    }));
  }
  const costBody = isRecord(costs.body) ? costs.body : null;
  const costRows = Array.isArray(costBody?.costs) ? costBody.costs.filter(isRecord).slice(0, 40) : [];
  for (const row of costRows) {
    out.push(event({
      time,
      source: "dna_os.cost",
      provider: asString(row.compute_source_id),
      resource: asString(row.work_id),
      work_id: asString(row.work_id),
      execution_id: asString(row.execution_id),
      event_type: "EXECUTION_RESOURCE_COST",
      status: "OK",
      cost_usd: asNumber(row.cost_usd),
      cost_thb: asNumber(row.cost_thb),
      health: isRecord(row.rate_card) ? asString(row.rate_card.source_kind) : null,
      evidence_ref: asString(row.evidence_ref),
      source_endpoint: `${DNA_OS_COMPUTE_BASE}/api/execution/cost`,
    }));
  }
  return out;
}

function extractJointEvents(time: string, joints: HttpProbe, violations: HttpProbe): MonitorActivityEvent[] {
  const out: MonitorActivityEvent[] = [endpointEvent("joint-monitor", joints), endpointEvent("joint-monitor violations", violations)];
  const jointBody = isRecord(joints.body) ? joints.body : null;
  const jointRows = Array.isArray(jointBody?.joints) ? jointBody.joints.filter(isRecord).slice(-80) : [];
  for (const row of jointRows) {
    out.push(event({
      time: asString(row.occurred_at) ?? asString(row.received_at) ?? time,
      source: "joint-monitor",
      resource: asString(row.to_capability),
      capability: asString(row.from_capability),
      work_id: asString(row.task_id),
      event_type: "JOINT_EVENT",
      status: asString(row.status) ?? "DATA_MISSING",
      bottleneck: asString(row.summary),
      evidence_ref: asString(row.event_id),
      source_endpoint: `${JOINT_MONITOR_BASE}/joints`,
    }));
  }
  const violationBody = isRecord(violations.body) ? violations.body : null;
  const violationRows = Array.isArray(violationBody?.violations) ? violationBody.violations.filter(isRecord).slice(-40) : [];
  for (const row of violationRows) {
    out.push(event({
      time: asString(row.occurred_at) ?? asString(row.received_at) ?? time,
      source: "joint-monitor",
      execution_id: asString(row.launch_id),
      event_type: "VIOLATION",
      status: "FAILED",
      error: asString(row.reason),
      bottleneck: asString(row.detail),
      evidence_ref: asString(row.event_id),
      source_endpoint: `${JOINT_MONITOR_BASE}/violations`,
    }));
  }
  return out;
}

function fieldContract(events: readonly MonitorActivityEvent[]): Record<string, FieldStatus> {
  const keys: Array<keyof MonitorActivityEvent> = ["time", "source", "provider", "resource", "capability", "work_id", "execution_id", "event_type", "status", "duration_ms", "latency_ms", "input_count", "output_count", "cost_usd", "cost_thb", "cpu", "ram", "disk", "network", "retry", "error", "bottleneck", "health", "evidence_ref"];
  const out: Record<string, FieldStatus> = {};
  for (const key of keys) {
    const values = events.map((e) => e[key]).filter((value) => value !== null && value !== undefined && value !== "");
    out[key] = values.length > 0 ? "MEASURED" : "DATA_MISSING";
  }
  return out;
}

export async function buildMonitorActivitySnapshot(): Promise<MonitorActivitySnapshot> {
  const time = nowIso();
  const [ownerHealth, runtimeInventory, stateCurrent, canonicalLineage, researchHealth, researchLineage, activeExecutions, researchCost, localTelemetry, uiHealth, jointHealth, joints, violations, gpuOffers, executionCost] = await Promise.all([
    httpJson(`${OWNER_BASE}/health`),
    httpJson(`${OWNER_BASE}/runtime/inventory`),
    httpJson(`${OWNER_BASE}/state/current`),
    httpJson(`${OWNER_BASE}/canonical/lineage/research-engine/latest`),
    httpJson(`${RESEARCH_BASE}/api/research/health`),
    httpJson(`${RESEARCH_BASE}/api/research/lineage/latest`),
    httpJson(`${RESEARCH_BASE}/api/executions/active`),
    httpJson(`${RESEARCH_BASE}/api/executions/cost-summary`),
    httpJson(`${RESEARCH_BASE}/api/local/telemetry`),
    httpJson(MONITOR_UI_BASE),
    httpJson(`${JOINT_MONITOR_BASE}/health`),
    httpJson(`${JOINT_MONITOR_BASE}/joints`),
    httpJson(`${JOINT_MONITOR_BASE}/violations`),
    httpJson(`${DNA_OS_COMPUTE_BASE}/api/gpu/offers`),
    httpJson(`${DNA_OS_COMPUTE_BASE}/api/execution/cost`),
  ]);

  const inventory: MonitorSourceInventory[] = [
    sourceInventory("DNA OS Core / owner-command", `${OWNER_BASE}/health`, "transport/owner-command-http/server.ts", ownerHealth.ok ? "LIVE" : "OFFLINE", ["health", "latency"], ["token", "cost"], `probe:${OWNER_BASE}/health`),
    sourceInventory("runtime inventory / capability registry", `${OWNER_BASE}/runtime/inventory`, "transport/owner-command-http/server.ts#runtimeInventory", runtimeInventory.ok ? "LIVE" : "OFFLINE", ["capability", "resource", "connection", "health"], ["cost"], `probe:${OWNER_BASE}/runtime/inventory`),
    sourceInventory("agent-gateway / work state", "control/agent-gateway/data/tasks.jsonl + evidence.jsonl", "control/agent-gateway/contract.ts", "LIVE", ["work_id", "execution_id", "status", "evidence_ref"], ["token", "cost"], "control/agent-gateway/data/evidence.jsonl"),
    sourceInventory("source-workspace lifecycle", "control/source-workspace/data/*.jsonl", "control/source-workspace/contract.ts", "LIVE", ["work_id", "status", "evidence_ref"], ["cost"], "control/source-workspace/data"),
    sourceInventory("Research API", `${RESEARCH_BASE}/api/research/lineage/latest`, "connections/research-engine + research/dashboard/api", researchLineage.ok ? "LIVE" : "OFFLINE", ["work_id", "execution_id", "duration", "cpu", "ram", "evidence_ref"], ["token when no AI provider", "cost when no rate card"], `probe:${RESEARCH_BASE}/api/research/lineage/latest`),
    sourceInventory("Research Monitor UI", MONITOR_UI_BASE, "research/dashboard/monitor-ui/serve-static.mjs", uiHealth.ok ? "LIVE" : "OFFLINE", ["health"], ["execution"], `probe:${MONITOR_UI_BASE}`),
    sourceInventory("joint-monitor SSE", `${JOINT_MONITOR_BASE}/events`, "observability/joint-monitor/server.ts", jointHealth.ok ? "LIVE" : "OFFLINE", ["event", "status", "bottleneck"], ["cost"], `probe:${JOINT_MONITOR_BASE}/health`),
    sourceInventory("dna_os compute/cost", `${DNA_OS_COMPUTE_BASE}/api/gpu/offers`, "dna_os/api/server.py", gpuOffers.ok ? "LIVE" : "OFFLINE", ["cost_usd", "cost_thb", "provider", "resource", "evidence_ref"], ["runtime health per rented GPU"], `probe:${DNA_OS_COMPUTE_BASE}/api/gpu/offers`),
    sourceInventory("machine/process telemetry", "lsof + connections/telemetry/data/snapshots.jsonl + research local telemetry", "connections/telemetry + research/dashboard/api/local_telemetry.py", "LIVE", ["cpu", "ram", "disk", "network", "process"], ["per-process network on macOS"], "lsof/local_telemetry_samples"),
    sourceInventory("external providers", "connections/connection-registry/data/connection-declarations.jsonl", "connections/* adapters", "LIVE", ["provider", "endpoint", "authorization state"], ["provider billing unless explicit endpoint exists"], "connection-declarations.jsonl"),
    sourceInventory("canonical lineage", `${OWNER_BASE}/canonical/lineage/research-engine/latest`, "connections/research-engine/lineage-bridge.ts", canonicalLineage.ok ? "LIVE" : "OFFLINE", ["application", "capability", "work", "execution", "evidence_ref"], ["source body"], `probe:${OWNER_BASE}/canonical/lineage/research-engine/latest`),
  ];

  const events: MonitorActivityEvent[] = [
    endpointEvent("DNA OS Core / owner-command", ownerHealth, "owner-command"),
    endpointEvent("runtime inventory", runtimeInventory),
    endpointEvent("current state", stateCurrent),
    endpointEvent("canonical lineage", canonicalLineage, "research-engine"),
    endpointEvent("Research API", researchHealth, "research-engine"),
    endpointEvent("Research Monitor UI", uiHealth),
    endpointEvent("joint-monitor", jointHealth),
    gitMetadataEvent(),
    telemetryEvent(time),
    ...processEvents(time),
    ...extractResearchEvents(time, researchLineage, activeExecutions, researchCost, localTelemetry),
    ...extractComputeEvents(time, gpuOffers, executionCost),
    ...extractJointEvents(time, joints, violations),
    ...compactConnectionEvents(time),
    ...compactTaskEvents(time),
    ...compactEvidenceEvents(time),
    ...sourceWorkspaceEvents(time),
  ].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 600);

  return {
    status: "ok",
    generated_at: time,
    schema_version: "DNA_OS_MONITOR_ACTIVITY_V1",
    rule: "read-only projection over existing stores/endpoints",
    field_contract: fieldContract(events),
    inventory,
    events,
    summary: {
      total_events: events.length,
      live_sources: inventory.filter((s) => s.status === "LIVE").length,
      offline_sources: inventory.filter((s) => s.status === "OFFLINE").length,
      failed_or_blocked_events: events.filter((e) => ["FAILED", "BLOCKED", "OFFLINE"].includes(e.status)).length,
      measured_cost_events: events.filter((e) => e.cost_usd !== null || e.cost_thb !== null).length,
      measured_resource_events: events.filter((e) => e.cpu !== null || e.ram !== null || e.disk !== null || e.network !== null).length,
    },
  };
}
