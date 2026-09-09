/**
 * หน้าที่: bridge ข้อมูล Research Monitor ที่มีอยู่จริงเข้า cross-system
 * canonical relationship store เดิม โดยไม่สร้าง database/registry ใหม่.
 *
 * Input: live Research Monitor read-only API + canonical stores เดิม.
 * Output: registerResearchEngineLineage(), readResearchEngineLineage().
 * Dependency ที่อนุญาต: adapter/read API ของ capability นี้, machine
 * observation RuntimeTarget, cross-system-store, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้าม hardcode canonical id, ห้ามใช้ PID เป็น identity ถาวร,
 * ห้าม mock/mirror research.db, ห้ามเขียน DB ของ Research Monitor.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { registerEntity, linkEntities, listEntities, listRelationships, getEntity } from "../../software/registry-database/cross-system-store";
import type { CrossSystemEntityRow, CrossSystemRelationshipRow } from "../../software/registry-database/cross-system-types";
import { declareRuntimeTarget } from "../../control/machine-observation/runtime-target";
import { RESEARCH_ENGINE_BASE_URL } from "./adapter-config";
import { checkResearchEngineHealth, fetchResearchEngineLatestLineage } from "./research-read-api";
import { parseLatestResearchResult } from "./payload-validation";

const EVIDENCE_FILE = join(process.cwd(), "control/agent-gateway/data/evidence.jsonl");

function sha(input: string, len = 16): string {
  return createHash("sha256").update(input).digest("hex").slice(0, len);
}

function idPart(input: string): string {
  const cleaned = input.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${cleaned}-${sha(input, 8)}`;
}

function requireOne<T>(rows: readonly T[], what: string): T {
  if (rows.length !== 1) throw new Error(`${what}: expected exactly one, got ${rows.length}`);
  return rows[0]!;
}

function jsonRows<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
}

function appendEvidence(row: Record<string, unknown>): string {
  const evidence_id = String(row.evidence_id);
  const existing = jsonRows<{ evidence_id?: string }>(EVIDENCE_FILE).some((r) => r.evidence_id === evidence_id);
  if (!existing) {
    mkdirSync(dirname(EVIDENCE_FILE), { recursive: true });
    appendFileSync(EVIDENCE_FILE, `${JSON.stringify(row)}\n`, "utf8");
  }
  return evidence_id;
}

function extractProcessId(process: Readonly<Record<string, unknown>> | null): number | null {
  const pid = process?.["process_id"];
  return typeof pid === "number" && Number.isInteger(pid) ? pid : null;
}

function currentApiPid(): string | null {
  try {
    const out = execFileSync("bash", ["-lc", "lsof -nP -iTCP:8787 -sTCP:LISTEN | awk 'NR==2 {print $2}'"], { encoding: "utf8" }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export interface RegisterResearchEngineLineageOptions {
  readonly baseUrl?: string;
  readonly applicationEntityId?: string;
}

export interface ResearchEngineLineageReport {
  readonly application_id: string;
  readonly capability_id: string;
  readonly work_id: string;
  readonly execution_id: string;
  readonly research_run_id: string;
  readonly research_execution_id: string;
  readonly process_entity_id: string;
  readonly evidence_id: string;
  readonly entity_ids: readonly string[];
  readonly relationship_ids: readonly string[];
}

export interface ResearchEngineCanonicalLineageSnapshot {
  readonly status: "ok" | "empty";
  readonly evidence_id: string | null;
  readonly source: string;
  readonly entities: readonly CrossSystemEntityRow[];
  readonly relationships: readonly CrossSystemRelationshipRow[];
  readonly application: CrossSystemEntityRow | null;
  readonly capability: ReturnType<ReturnType<typeof createPersistentFileStore>["findCapabilityById"]> | null;
  readonly chain: readonly {
    readonly label: string;
    readonly entity_type: string;
    readonly entity_id: string;
    readonly canonical_name: string | null;
    readonly state: string | null;
  }[];
}

export async function registerResearchEngineLineage(options: RegisterResearchEngineLineageOptions = {}): Promise<ResearchEngineLineageReport> {
  const baseUrl = options.baseUrl ?? RESEARCH_ENGINE_BASE_URL;
  const health = await checkResearchEngineHealth(baseUrl, 5_000);
  if (!health.healthy) throw new Error(`RESEARCH_ENGINE_OFFLINE: ${health.reason ?? "health check failed"}`);

  const registry = createPersistentFileStore();
  const capability = registry.findCapabilityByCanonicalName("research-engine");
  if (!capability) throw new Error("NO_CANONICAL_RESEARCH_ENGINE_CAPABILITY");

  const applications = listEntities().filter((e) => e.entity_type === "APPLICATION");
  const app = options.applicationEntityId
    ? applications.find((e) => e.entity_id === options.applicationEntityId)
    : requireOne(applications, "APPLICATION_SELECTION");
  if (!app) throw new Error(`APPLICATION_NOT_FOUND: ${options.applicationEntityId}`);

  const routeTarget = declareRuntimeTarget({
    capability_id: capability.capability_id,
    canonical_name: capability.canonical_name,
    process: { argv_contains: "research.dashboard.api.server --port 8787" },
    network: { host: "127.0.0.1", port: 8787 },
    health: { path: "/api/research/health", expected_status: 200 },
    evidence_refs: [`live:${baseUrl}/api/research/health status=${String(health.http_status)}`, `live:lsof tcp:8787 pid=${currentApiPid() ?? "NOT_OBSERVED"}`],
  });
  if (!routeTarget.ok) throw new Error(`RUNTIME_TARGET_NOT_DECLARED: ${routeTarget.reason_code} ${routeTarget.detail}`);

  const latest = await fetchResearchEngineLatestLineage(baseUrl, 5_000);
  if (latest.kind !== "ok") throw new Error(`RESEARCH_LINEAGE_UNAVAILABLE: ${latest.kind === "invalid_json" ? latest.reason : latest.reason}`);
  const parsed = parseLatestResearchResult(latest.body);
  if (!parsed.ok) throw new Error(`RESEARCH_LINEAGE_MALFORMED: ${parsed.reason}`);
  const f = parsed.value;
  if (!f.research_execution_id) throw new Error("RESEARCH_EXECUTION_ID_MISSING");

  const workSource = f.work_id ?? f.research_execution_id;
  const canonicalWorkId = `work://research-engine/${idPart(workSource)}`;
  const canonicalExecutionId = `execution://research-engine/${idPart(f.research_execution_id)}`;
  const canonicalResearchRunId = `research_run://research-engine/${idPart(f.run_id)}`;
  const canonicalProcessId = `process://research-engine/${idPart(f.research_execution_id)}`;
  const metricKey = Object.keys(f.metrics).at(0) ?? Object.keys(f.latency).at(0) ?? "not-measured";
  const canonicalMetricId = `metric://research-engine/${idPart(f.run_id)}/${idPart(metricKey)}`;
  const canonicalCostId = `cost://research-engine/${idPart(f.research_execution_id)}`;
  const canonicalDecisionId = `decision://research-engine/${idPart(f.run_id)}`;
  const evidenceId = `ev-research-lineage-${sha(`${app.entity_id}|${capability.capability_id}|${f.run_id}|${f.research_execution_id}`, 24)}`;
  const canonicalEvidenceId = `evidence://research-engine/${evidenceId}`;

  const processPid = extractProcessId(f.process);
  appendEvidence({
    evidence_id: evidenceId,
    task_id: workSource,
    kind: "verification",
    source: "connections/research-engine/lineage-bridge.ts",
    recorded_at: new Date().toISOString(),
    payload: {
      application_id: app.entity_id,
      capability_id: capability.capability_id,
      work_id: workSource,
      execution_id: f.research_execution_id,
      research_run_id: f.run_id,
      research_experiment_id: f.experiment_id,
      process_evidence: f.process,
      process_pid_observed: processPid,
      research_metric_keys: Object.keys(f.metrics),
      research_latency_keys: Object.keys(f.latency),
      research_cost: f.cost,
      research_decision: f.decision,
      source: `${baseUrl}/api/research/lineage/latest`,
    },
  });

  const entityInputs: Array<Parameters<typeof registerEntity>[0]> = [
    { entity_id: canonicalWorkId, entity_type: "WORK", canonical_name: workSource, state: "OBSERVED", source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { entity_id: canonicalExecutionId, entity_type: "EXECUTION", canonical_name: f.research_execution_id, state: "COMPLETED", source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { entity_id: canonicalResearchRunId, entity_type: "RESEARCH_RUN", canonical_name: f.run_id, state: "OBSERVED", source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { entity_id: canonicalProcessId, entity_type: "PROCESS", canonical_name: `process for ${f.research_execution_id}`, state: processPid === null ? "PROCESS_ID_NOT_MEASURED" : "PROCESS_ID_EVIDENCED", source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { entity_id: canonicalMetricId, entity_type: "METRIC", canonical_name: metricKey, state: metricKey === "not-measured" ? "NOT_MEASURED" : "OBSERVED", source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { entity_id: canonicalCostId, entity_type: "COST", canonical_name: `cost for ${f.research_execution_id}`, state: f.cost === null ? "NOT_MEASURED" : "OBSERVED", source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { entity_id: canonicalDecisionId, entity_type: "DECISION", canonical_name: `decision for ${f.run_id}`, state: f.decision === null ? "NO_DECISION_RECORD" : "OBSERVED", source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { entity_id: canonicalEvidenceId, entity_type: "EVIDENCE", canonical_name: evidenceId, state: "RECORDED", source_authority: "RUNTIME", evidence_refs: [evidenceId] },
  ];
  for (const input of entityInputs) {
    const result = registerEntity(input);
    if (result.status === "REJECTED") throw new Error(`ENTITY_REJECTED ${input.entity_id}: ${result.reason}`);
  }

  const linkInputs: Array<Parameters<typeof linkEntities>[0]> = [
    { from_type: "APPLICATION", from_id: app.entity_id, relationship_kind: "APPLICATION_USES_CAPABILITY", to_type: "CAPABILITY", to_id: capability.capability_id, source_authority: "DNA_OS_REGISTRY", evidence_refs: [evidenceId] },
    { from_type: "WORK", from_id: canonicalWorkId, relationship_kind: "WORK_TARGETS_CAPABILITY", to_type: "CAPABILITY", to_id: capability.capability_id, source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { from_type: "EXECUTION", from_id: canonicalExecutionId, relationship_kind: "EXECUTION_OF_WORK", to_type: "WORK", to_id: canonicalWorkId, source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { from_type: "EXECUTION", from_id: canonicalExecutionId, relationship_kind: "EXECUTION_RUNS_PROCESS", to_type: "PROCESS", to_id: canonicalProcessId, source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { from_type: "EXECUTION", from_id: canonicalExecutionId, relationship_kind: "EXECUTION_HAS_RESEARCH_RUN", to_type: "RESEARCH_RUN", to_id: canonicalResearchRunId, source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { from_type: "RESEARCH_RUN", from_id: canonicalResearchRunId, relationship_kind: "RESEARCH_RUN_HAS_METRIC", to_type: "METRIC", to_id: canonicalMetricId, source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { from_type: "RESEARCH_RUN", from_id: canonicalResearchRunId, relationship_kind: "RESEARCH_RUN_HAS_COST", to_type: "COST", to_id: canonicalCostId, source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { from_type: "RESEARCH_RUN", from_id: canonicalResearchRunId, relationship_kind: "RESEARCH_RUN_HAS_DECISION", to_type: "DECISION", to_id: canonicalDecisionId, source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { from_type: "METRIC", from_id: canonicalMetricId, relationship_kind: "METRIC_HAS_EVIDENCE", to_type: "EVIDENCE", to_id: canonicalEvidenceId, source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { from_type: "COST", from_id: canonicalCostId, relationship_kind: "COST_HAS_EVIDENCE", to_type: "EVIDENCE", to_id: canonicalEvidenceId, source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { from_type: "DECISION", from_id: canonicalDecisionId, relationship_kind: "DECISION_HAS_EVIDENCE", to_type: "EVIDENCE", to_id: canonicalEvidenceId, source_authority: "RUNTIME", evidence_refs: [evidenceId] },
    { from_type: "PROCESS", from_id: canonicalProcessId, relationship_kind: "PROCESS_HAS_EVIDENCE", to_type: "EVIDENCE", to_id: canonicalEvidenceId, source_authority: "RUNTIME", evidence_refs: [evidenceId] },
  ];
  const relationshipIds: string[] = [];
  for (const input of linkInputs) {
    const result = linkEntities(input);
    if (result.status === "REJECTED" || !result.relationship) throw new Error(`RELATIONSHIP_REJECTED ${input.relationship_kind}: ${result.reason}`);
    relationshipIds.push(result.relationship.relationship_id);
  }

  return {
    application_id: app.entity_id,
    capability_id: capability.capability_id,
    work_id: canonicalWorkId,
    execution_id: canonicalExecutionId,
    research_run_id: canonicalResearchRunId,
    research_execution_id: f.research_execution_id,
    process_entity_id: canonicalProcessId,
    evidence_id: evidenceId,
    entity_ids: entityInputs.map((e) => e.entity_id),
    relationship_ids: relationshipIds,
  };
}

export function readResearchEngineLineage(evidenceId: string): {
  readonly entities: readonly CrossSystemEntityRow[];
  readonly relationships: readonly CrossSystemRelationshipRow[];
} {
  const entities = listEntities().filter((e) => e.evidence_refs.includes(evidenceId) || e.entity_id.endsWith(evidenceId));
  const relationships = listRelationships().filter((r) => r.evidence_refs?.includes(evidenceId));
  return { entities, relationships };
}

function latestResearchEngineEvidenceEntity(): CrossSystemEntityRow | null {
  const evidenceEntities = listEntities()
    .filter((e) => e.entity_type === "EVIDENCE")
    .filter((e) => e.entity_id.startsWith("evidence://research-engine/"))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return evidenceEntities[0] ?? null;
}

function entityByType(entities: readonly CrossSystemEntityRow[], type: CrossSystemEntityRow["entity_type"]): CrossSystemEntityRow | null {
  return entities.find((e) => e.entity_type === type) ?? null;
}

export function readLatestResearchEngineCanonicalLineage(): ResearchEngineCanonicalLineageSnapshot {
  const evidenceEntity = latestResearchEngineEvidenceEntity();
  if (!evidenceEntity) {
    return {
      status: "empty",
      evidence_id: null,
      source: "software/registry-database/data/cross-system",
      entities: [],
      relationships: [],
      application: null,
      capability: null,
      chain: [],
    };
  }

  const evidenceId = evidenceEntity.canonical_name;
  const lineage = readResearchEngineLineage(evidenceId);
  const capabilityRelationship = lineage.relationships.find((r) => r.relationship_kind === "APPLICATION_USES_CAPABILITY" && r.to_type === "CAPABILITY");
  const applicationRelationship = lineage.relationships.find((r) => r.relationship_kind === "APPLICATION_USES_CAPABILITY" && r.from_type === "APPLICATION");
  const application = applicationRelationship ? getEntity(applicationRelationship.from_id) : entityByType(lineage.entities, "APPLICATION");
  const registry = createPersistentFileStore();
  const capability = capabilityRelationship ? registry.findCapabilityById(capabilityRelationship.to_id) : null;
  const entities = application && !lineage.entities.some((e) => e.entity_id === application.entity_id)
    ? [application, ...lineage.entities]
    : lineage.entities;

  const typed = (type: CrossSystemEntityRow["entity_type"]): CrossSystemEntityRow | null => entityByType(entities, type);
  const chain = [
    { label: "Application", row: application },
    {
      label: "Capability",
      row: capability ? {
        entity_id: capability.capability_id,
        entity_type: "CAPABILITY",
        canonical_name: capability.canonical_name,
        state: capability.status,
      } : null,
    },
    { label: "Work", row: typed("WORK") },
    { label: "Execution", row: typed("EXECUTION") },
    { label: "Research Run", row: typed("RESEARCH_RUN") },
    { label: "Metric", row: typed("METRIC") },
    { label: "Cost", row: typed("COST") },
    { label: "Decision", row: typed("DECISION") },
    { label: "Process", row: typed("PROCESS") },
    { label: "Evidence", row: evidenceEntity },
  ].flatMap(({ label, row }) => row ? [{
    label,
    entity_type: String(row.entity_type),
    entity_id: String(row.entity_id),
    canonical_name: "canonical_name" in row ? String(row.canonical_name) : null,
    state: "state" in row ? String(row.state) : null,
  }] : []);

  return {
    status: "ok",
    evidence_id: evidenceId,
    source: "software/registry-database/data/cross-system",
    entities,
    relationships: lineage.relationships,
    application,
    capability,
    chain,
  };
}
