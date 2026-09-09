/**
 * PRODUCTION_CHECKPOINT_RECONCILIATION_V1 — machine evidence only.
 * Coding-client prose never completes work. Cursor presence is not required.
 */

import { listCodingActivities, listOutputs, listSubmittedWork } from "../inbound-event-fabric/persist";
import type { CodingClientActivityV1, OwnerSubmittedWorkV1 } from "../inbound-event-fabric/types";
import { evaluateCanonicalEvent, makeCanonicalEvent } from "../owner-notification/contract";
import {
  githubPublishToDeploymentAuthority,
  listPipelineRecords,
  listRegisteredDeploymentTargets,
  productionBoundaryProjection,
  verifyRuntime,
} from "../work-production-pipeline/contract";
import { listDeployments, listVerifications } from "../work-production-pipeline/persist";
import type { PipelineRecordV1 } from "../work-production-pipeline/types";
import { nowIso } from "./host-runtime";
import {
  listCheckpoints,
  listCompletionReports,
  listDiskCatalogPipelines,
  persistCheckpointsForWork,
  persistCompletionReport,
  rememberCatchup,
  rememberEmitted,
} from "./persist";
import {
  CHECKPOINT_TYPES,
  CONTINUOUS_PRODUCTION_RECONCILER,
  OWNER_WORK_COMPLETION_NOTIFICATION,
  PRODUCTION_CHECKPOINT,
  PRODUCTION_CHECKPOINT_RECONCILIATION,
  PRODUCTION_CHECKPOINT_STALENESS,
  SOURCE_OF_TRUTH,
  TRUTH_LOCKS,
  WORK_COMPLETION_READINESS,
  WORK_COMPLETION_REPORT,
  type CheckpointState,
  type CheckpointType,
  type CurrentWorkOwnerReportV1,
  type OwnerWorkItemProjectionV1,
  type ProductionCheckpointV1,
  type ProductionEnvironment,
  type SourceLineageStatusV1,
  type StuckState,
  type WorkCompletionReadinessV1,
  type WorkCompletionReportV1,
} from "./types";

const PIPELINE_LINEAR = [
  "REQUESTED", "CONTEXT_RESOLVED", "AUTHORIZED_FOR_DEVELOPMENT", "IN_DEVELOPMENT", "AUTHORED",
  "ASSEMBLED", "BUILD_VERIFIED", "TEST_VERIFIED", "INTEGRATION_VERIFIED", "REVIEW_READY",
  "OWNER_REVIEW_REQUIRED", "APPROVED_FOR_PUBLISH", "PUBLISHED", "PROMOTION_READY",
  "DEPLOYMENT_READY", "DEPLOYED", "RUNTIME_VERIFYING", "RUNTIME_VERIFIED",
  "CAPABILITY_REGISTERED", "ACTIVE",
] as const;

function rank(state: string | undefined): number {
  if (!state) return -1;
  return PIPELINE_LINEAR.indexOf(state as typeof PIPELINE_LINEAR[number]);
}

function na(value: string | null | undefined): string {
  if (value === undefined || value === null || value === "") return "NOT_AVAILABLE";
  return value;
}

function isGitSha(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[0-9a-f]{7,40}$/i.test(value);
}

export function classifyProductionEnvironment(pipe: PipelineRecordV1 | null): ProductionEnvironment {
  const bounds = productionBoundaryProjection();
  const targets = listRegisteredDeploymentTargets();
  const targetId = pipe?.intent.deployment_target ?? null;
  const target = targetId
    ? targets.find((row) => String(row.target_id) === targetId) ?? null
    : targets[0] ?? null;
  const env = String(target?.environment ?? "");
  const provider = String(target?.provider ?? "");
  const method = String(target?.deployment_method ?? "");
  const looksFixture = /fixture|local/i.test(env) || /fixture|local/i.test(provider) || /fixture|local/i.test(method)
    || (typeof targetId === "string" && /local|fixture/i.test(targetId));
  const cloudWired = bounds.RAILWAY_DEPLOYMENT_MUTATION === "VERIFIED"
    || githubPublishToDeploymentAuthority() === "VERIFIED";
  if (looksFixture) return "LOCAL_FIXTURE";
  if (cloudWired && target && /railway|github|cloud|production/i.test(`${env} ${provider}`)) return "REMOTE_REAL";
  if (!pipe?.intent.production_intent && !target) return "NOT_AVAILABLE";
  if (bounds.RAILWAY_DEPLOYMENT_MUTATION === "NOT_WIRED" || bounds.GITHUB_PUBLISH_TO_DEPLOYMENT_AUTHORITY === "NOT_WIRED") {
    return looksFixture ? "LOCAL_FIXTURE" : "NOT_WIRED";
  }
  if (!target) return "NOT_WIRED";
  return "NOT_AVAILABLE";
}

function agentClaimsDone(work: OwnerSubmittedWorkV1 | undefined, activity: CodingClientActivityV1 | undefined): boolean {
  const stage = `${work?.current_stage ?? ""} ${work?.reported_status ?? ""} ${activity?.current_stage ?? ""} ${activity?.reported_status ?? ""}`;
  return /COMPLETED_CANDIDATE|HANDOFF_COMPLETE|DONE|COMPLETE/i.test(stage);
}

function requiresProduction(pipe: PipelineRecordV1 | null): boolean {
  return pipe?.intent.production_intent === true;
}

function requiresCapability(pipe: PipelineRecordV1 | null): boolean {
  if (!pipe) return false;
  return Boolean(pipe.capability_id) || pipe.lane === "DEVELOPMENT_LANE" && requiresProduction(pipe);
}

function requiresOwnerApproval(pipe: PipelineRecordV1 | null): boolean {
  const risk = pipe?.risk_class;
  return risk === "HIGH" || risk === "CRITICAL" || risk === "MODERATE";
}

function requiresBuild(pipe: PipelineRecordV1 | null): boolean {
  if (!pipe) return false;
  return (pipe.work_order.required_builds?.length ?? 0) > 0;
}

function requiresTest(pipe: PipelineRecordV1 | null): boolean {
  if (!pipe) return false;
  return (pipe.work_order.required_tests?.length ?? 0) > 0;
}

function verificationPass(work_id: string, test_id: string): boolean {
  return listVerifications<Record<string, unknown>>().some((row) => row.work_id === work_id && row.test_id === test_id && row.status === "PASS");
}

function deployRecord(work_id: string): Record<string, unknown> | undefined {
  return listDeployments<Record<string, unknown>>().filter((row) => row.record_type === "DEPLOY" && row.work_id === work_id).at(-1);
}

function checkpoint(
  work_id: string,
  subject: string,
  type: CheckpointType,
  state: CheckpointState,
  extra: Partial<ProductionCheckpointV1> = {},
): ProductionCheckpointV1 {
  const now = extra.verified_at ?? (state === "VERIFIED" ? nowIso() : extra.completed_at ?? null);
  return {
    schema: PRODUCTION_CHECKPOINT,
    checkpoint_id: `ckpt:${work_id}:${type}`,
    work_id,
    subject,
    checkpoint_type: type,
    state,
    source_of_truth: SOURCE_OF_TRUTH[type],
    revision: extra.revision ?? "NOT_AVAILABLE",
    artifact_refs: extra.artifact_refs ?? [],
    report_refs: extra.report_refs ?? [],
    evidence_refs: extra.evidence_refs ?? [],
    started_at: extra.started_at ?? null,
    completed_at: extra.completed_at ?? (state === "VERIFIED" ? now : null),
    verified_at: state === "VERIFIED" ? now : extra.verified_at ?? null,
    failure_reason: extra.failure_reason ?? null,
    owner_attention_required: extra.owner_attention_required ?? false,
  };
}

export function deriveCheckpoints(input: {
  readonly work_id: string;
  readonly subject: string;
  readonly pipe: PipelineRecordV1 | null;
  readonly submitted: OwnerSubmittedWorkV1 | undefined;
  readonly activity: CodingClientActivityV1 | undefined;
  readonly reports: readonly string[];
}): readonly ProductionCheckpointV1[] {
  const { work_id, subject, pipe, submitted, activity, reports } = input;
  const r = rank(pipe?.state);
  const failed = pipe?.state === "FAILED" || (submitted?.failures ?? 0) > 0;
  const blocked = pipe?.state === "BLOCKED" || pipe?.state === "BLOCKED_INCOMPLETE";
  const rev = na(pipe?.source_revision ?? null);
  const remote = pipe?.remote_sha ?? null;
  const artifacts = pipe?.artifact_id ? [pipe.artifact_id] : [];
  const env = classifyProductionEnvironment(pipe);
  const prod = requiresProduction(pipe);
  const cap = requiresCapability(pipe);
  const buildOk = r >= rank("BUILD_VERIFIED") || verificationPass(work_id, "pipeline.build.hash_check");
  const testOk = r >= rank("TEST_VERIFIED") || verificationPass(work_id, "pipeline.test.marker");
  const integOk = r >= rank("INTEGRATION_VERIFIED") || pipe?.promotion === "INTEGRATED" || pipe?.promotion === "PUBLISHED_REMOTE" || pipe?.promotion === "REMOTE_VERIFIED";
  const published = Boolean(remote) && (pipe?.promotion === "PUBLISHED_REMOTE" || pipe?.promotion === "REMOTE_VERIFIED" || r >= rank("PUBLISHED"));
  const deployed = Boolean(pipe?.deployment_id) || Boolean(deployRecord(work_id));
  const runtime = pipe?.runtime_verified === true || r >= rank("RUNTIME_VERIFIED");
  const runtimeProbe = pipe?.intent.deployment_target ? verifyRuntime(work_id) : { result: "UNKNOWN" as const };
  const capReg = Boolean(pipe?.capability_id) || r >= rank("CAPABILITY_REGISTERED");
  const enabled = pipe?.owner_enabled === true || r >= rank("ACTIVE");
  const created = Boolean(pipe || submitted);
  const accepted = Boolean(submitted?.accepted_at) || r >= rank("AUTHORIZED_FOR_DEVELOPMENT") || Boolean(pipe);
  const implementing = r >= rank("IN_DEVELOPMENT") || Boolean(activity) || /IMPLEMENTING|IN_DEVELOPMENT|AUTHORED/i.test(submitted?.current_stage ?? "");

  const rows: ProductionCheckpointV1[] = [];
  rows.push(checkpoint(work_id, subject, "WORK_CREATED", created ? "VERIFIED" : "PENDING", { revision: rev, report_refs: reports, artifact_refs: artifacts, started_at: submitted?.submitted_at ?? pipe?.created_at ?? null }));
  rows.push(checkpoint(work_id, subject, "WORK_ACCEPTED", accepted ? "VERIFIED" : created ? "PENDING" : "NOT_AVAILABLE", { revision: rev, started_at: submitted?.accepted_at ?? pipe?.created_at ?? null }));
  rows.push(checkpoint(work_id, subject, "IMPLEMENTING", implementing ? "VERIFIED" : accepted ? "ACTIVE" : "PENDING", { revision: rev, source_of_truth: SOURCE_OF_TRUTH.IMPLEMENTING }));

  if (pipe && !requiresBuild(pipe)) {
    rows.push(checkpoint(work_id, subject, "BUILD_VERIFIED", "NOT_APPLICABLE", { revision: rev }));
  } else if (failed && pipe?.state === "FAILED" && r < rank("BUILD_VERIFIED") && !buildOk) {
    rows.push(checkpoint(work_id, subject, "BUILD_VERIFIED", "FAILED", { revision: rev, failure_reason: "BUILD_FAILED" }));
  } else {
    rows.push(checkpoint(work_id, subject, "BUILD_VERIFIED", buildOk ? "VERIFIED" : "PENDING", { revision: rev, evidence_refs: buildOk ? [`verify:${work_id}:build`] : [] }));
  }

  if (pipe && !requiresTest(pipe)) {
    rows.push(checkpoint(work_id, subject, "TEST_VERIFIED", "NOT_APPLICABLE", { revision: rev }));
  } else if (failed && !testOk && buildOk) {
    rows.push(checkpoint(work_id, subject, "TEST_VERIFIED", "FAILED", { revision: rev, failure_reason: "TEST_FAILED" }));
  } else {
    rows.push(checkpoint(work_id, subject, "TEST_VERIFIED", testOk ? "VERIFIED" : "PENDING", { revision: rev }));
  }

  rows.push(checkpoint(work_id, subject, "REVIEW_READY", r >= rank("REVIEW_READY") ? "VERIFIED" : testOk ? "PENDING" : "PENDING", { revision: rev }));

  if (!requiresOwnerApproval(pipe)) {
    rows.push(checkpoint(work_id, subject, "OWNER_APPROVAL_REQUIRED", "NOT_APPLICABLE", { revision: rev }));
  } else if (pipe?.state === "OWNER_REVIEW_REQUIRED") {
    rows.push(checkpoint(work_id, subject, "OWNER_APPROVAL_REQUIRED", "ACTIVE", { revision: rev, owner_attention_required: true }));
  } else {
    rows.push(checkpoint(work_id, subject, "OWNER_APPROVAL_REQUIRED", r >= rank("APPROVED_FOR_PUBLISH") ? "VERIFIED" : "PENDING", {
      revision: rev,
      owner_attention_required: false,
    }));
  }

  rows.push(checkpoint(work_id, subject, "ADMITTED", r >= rank("INTEGRATION_VERIFIED") || integOk ? "VERIFIED" : "PENDING", { revision: rev }));
  rows.push(checkpoint(work_id, subject, "INTEGRATED", integOk ? "VERIFIED" : "PENDING", { revision: rev, evidence_refs: integOk ? [`promotion:${pipe?.promotion ?? "none"}`] : [] }));

  const canonical = isGitSha(pipe?.source_revision) || (pipe?.promotion !== "LOCAL_ONLY" && Boolean(pipe?.source_revision && pipe.source_revision !== "UNCOMMITTED"));
  rows.push(checkpoint(work_id, subject, "CANONICAL_COMMIT_CREATED", canonical ? "VERIFIED" : integOk ? "PENDING" : "PENDING", { revision: rev }));

  if (!prod && !published) {
    rows.push(checkpoint(work_id, subject, "REMOTE_PUBLISHED", "NOT_APPLICABLE", { revision: na(remote) }));
  } else {
    rows.push(checkpoint(work_id, subject, "REMOTE_PUBLISHED", published ? "VERIFIED" : canonical ? "PENDING" : "PENDING", { revision: na(remote) }));
  }

  if (!prod && !deployed) {
    rows.push(checkpoint(work_id, subject, "DEPLOYMENT_STARTED", env === "NOT_WIRED" ? "NOT_AVAILABLE" : "NOT_APPLICABLE", { revision: rev }));
    rows.push(checkpoint(work_id, subject, "DEPLOYED", env === "NOT_WIRED" ? "NOT_AVAILABLE" : "NOT_APPLICABLE", { revision: rev }));
    rows.push(checkpoint(work_id, subject, "RUNTIME_VERIFIED", env === "NOT_WIRED" ? "NOT_AVAILABLE" : "NOT_APPLICABLE", { revision: rev }));
  } else {
    const startState: CheckpointState = r >= rank("DEPLOYMENT_READY") || r >= rank("DEPLOYMENT_STARTED" as never) || deployed
      ? (deployed || r >= rank("DEPLOYED") ? "VERIFIED" : "ACTIVE")
      : (published ? "PENDING" : "PENDING");
    rows.push(checkpoint(work_id, subject, "DEPLOYMENT_STARTED", startState, { revision: rev }));
    let deployState: CheckpointState = deployed ? "VERIFIED" : "PENDING";
    if (!deployed && published && env === "NOT_WIRED") deployState = "NOT_AVAILABLE";
    rows.push(checkpoint(work_id, subject, "DEPLOYED", deployState, { revision: rev, evidence_refs: pipe?.deployment_id ? [pipe.deployment_id] : [] }));
    let rtState: CheckpointState = "PENDING";
    if (runtime && runtimeProbe.result === "RUNTIME_VERIFIED") rtState = "VERIFIED";
    else if (runtimeProbe.result === "FAILED" || (pipe?.state === "FAILED" && deployed)) rtState = "FAILED";
    else if (deployed && !runtime) rtState = "PENDING";
    else if (!prod) rtState = "NOT_APPLICABLE";
    rows.push(checkpoint(work_id, subject, "RUNTIME_VERIFIED", rtState, {
      revision: na(String(pipe?.lineage?.runtime_revision ?? "")),
      failure_reason: rtState === "FAILED" ? "RUNTIME_VERIFICATION_FAILED" : null,
    }));
  }

  if (!cap && !capReg) {
    rows.push(checkpoint(work_id, subject, "CAPABILITY_REGISTERED", "NOT_APPLICABLE", { revision: rev }));
    rows.push(checkpoint(work_id, subject, "OWNER_ENABLED", "NOT_APPLICABLE", { revision: rev }));
  } else {
    rows.push(checkpoint(work_id, subject, "CAPABILITY_REGISTERED", capReg ? "VERIFIED" : "PENDING", { revision: rev }));
    rows.push(checkpoint(work_id, subject, "OWNER_ENABLED", enabled ? "VERIFIED" : capReg ? "PENDING" : "PENDING", {
      revision: rev,
      owner_attention_required: capReg && !enabled,
    }));
  }

  const required = requiredLane(pipe, prod, cap);
  const byType = new Map(rows.map((row) => [row.checkpoint_type, row]));
  const allRequiredOk = required.every((type) => {
    const row = byType.get(type);
    return row?.state === "VERIFIED" || row?.state === "NOT_APPLICABLE" || row?.state === "NOT_AVAILABLE";
  });
  const workComplete: CheckpointState = allRequiredOk ? "VERIFIED" : (failed ? "FAILED" : blocked ? "BLOCKED" : "PENDING");
  rows.push(checkpoint(work_id, subject, "WORK_COMPLETED", workComplete, {
    revision: rev,
    report_refs: reports,
    failure_reason: workComplete === "FAILED" ? (pipe?.state ?? "FAILED") : null,
  }));
  return rows;
}

function requiredLane(pipe: PipelineRecordV1 | null, prod: boolean, cap: boolean): CheckpointType[] {
  const required: CheckpointType[] = ["WORK_CREATED", "WORK_ACCEPTED", "IMPLEMENTING", "ADMITTED", "INTEGRATED"];
  if (!pipe || requiresBuild(pipe)) required.push("BUILD_VERIFIED");
  if (!pipe || requiresTest(pipe)) required.push("TEST_VERIFIED");
  if (pipe) required.push("CANONICAL_COMMIT_CREATED");
  if (prod) required.push("REMOTE_PUBLISHED", "DEPLOYED", "RUNTIME_VERIFIED");
  if (cap) required.push("CAPABILITY_REGISTERED", "OWNER_ENABLED");
  return required;
}

export function completionReadiness(rows: readonly ProductionCheckpointV1[], pipe: PipelineRecordV1 | null, submitted?: OwnerSubmittedWorkV1): WorkCompletionReadinessV1 {
  const work_id = rows[0]?.work_id ?? "UNRESOLVED";
  const prod = requiresProduction(pipe);
  const cap = requiresCapability(pipe);
  const required = requiredLane(pipe, prod, cap);
  const byType = new Map(rows.map((row) => [row.checkpoint_type, row]));
  const relevant = required.filter((type) => {
    const state = byType.get(type)?.state;
    return state !== "NOT_APPLICABLE" && state !== "NOT_AVAILABLE";
  });
  const satisfied = relevant.filter((type) => byType.get(type)?.state === "VERIFIED");
  const missing = relevant.filter((type) => byType.get(type)?.state !== "VERIFIED");
  const complete = missing.length === 0 && byType.get("WORK_COMPLETED")?.state === "VERIFIED";
  return {
    schema: WORK_COMPLETION_READINESS,
    work_id,
    WORK_COMPLETED: complete,
    required_checkpoints: relevant,
    satisfied,
    missing,
    stuck_state: stuckState(rows, pipe, submitted),
    owner_attention_required: rows.some((row) => row.owner_attention_required) || pipe?.state === "OWNER_REVIEW_REQUIRED",
  };
}

export function stuckState(rows: readonly ProductionCheckpointV1[], pipe: PipelineRecordV1 | null, submitted?: OwnerSubmittedWorkV1, activity?: CodingClientActivityV1): StuckState {
  const get = (type: CheckpointType) => rows.find((row) => row.checkpoint_type === type);
  if (get("RUNTIME_VERIFIED")?.state === "FAILED" || get("BUILD_VERIFIED")?.state === "FAILED" || get("TEST_VERIFIED")?.state === "FAILED" || pipe?.state === "FAILED") {
    return "BLOCKED_BY_FAILURE";
  }
  if (submitted && !submitted.client_connected && get("WORK_COMPLETED")?.state !== "VERIFIED" && !pipe?.state?.includes("FAIL")) {
    return "WAITING_FOR_CLIENT";
  }
  if (get("OWNER_APPROVAL_REQUIRED")?.state === "ACTIVE") return "WAITING_FOR_OWNER_ENABLE";
  if (get("CAPABILITY_REGISTERED")?.state === "VERIFIED" && get("OWNER_ENABLED")?.state === "PENDING") return "WAITING_FOR_OWNER_ENABLE";
  if (get("DEPLOYED")?.state === "VERIFIED" && get("RUNTIME_VERIFIED")?.state === "PENDING") return "WAITING_FOR_RUNTIME_VERIFY";
  if (get("REMOTE_PUBLISHED")?.state === "VERIFIED" && (get("DEPLOYED")?.state === "PENDING" || get("DEPLOYED")?.state === "NOT_AVAILABLE")) {
    return get("DEPLOYED")?.state === "NOT_AVAILABLE" ? "WAITING_FOR_DEPLOYMENT" : "WAITING_FOR_DEPLOYMENT";
  }
  if (get("INTEGRATED")?.state === "VERIFIED" && get("REMOTE_PUBLISHED")?.state === "PENDING") return "WAITING_FOR_PUBLISH";
  if (agentClaimsDone(submitted, activity) && get("INTEGRATED")?.state !== "VERIFIED") return "WAITING_FOR_INTEGRATION";
  if (get("IMPLEMENTING")?.state === "VERIFIED" && get("INTEGRATED")?.state !== "VERIFIED" && get("ADMITTED")?.state !== "VERIFIED") {
    return "WAITING_FOR_INTEGRATION";
  }
  return "NONE";
}

export function sourceLineageStatus(pipe: PipelineRecordV1 | null): SourceLineageStatusV1 {
  const work_id = pipe?.work_id ?? "UNRESOLVED";
  const workspace = na(pipe?.work_order.base_revision);
  const candidate = na(typeof pipe?.lineage.commit === "string" ? pipe.lineage.commit : pipe?.source_revision);
  const canonical = na(pipe?.source_revision);
  const remote = na(pipe?.remote_sha);
  const deployment = na(pipe?.deployment_id ? pipe.source_revision : null);
  const runtime = na(typeof pipe?.lineage.runtime_revision === "string" ? pipe.lineage.runtime_revision : null);
  const values = [workspace, candidate, canonical, remote, deployment, runtime];
  const known = values.filter((row) => row !== "NOT_AVAILABLE" && row !== "UNCOMMITTED");
  const aligned = known.length > 0 && known.every((row) => row === known[0]);
  let divergence: string | null = null;
  const labels = ["workspace_base_revision", "candidate_revision", "canonical_revision", "remote_revision", "deployment_revision", "runtime_revision"] as const;
  const seq = [workspace, candidate, canonical, remote, deployment, runtime];
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === "NOT_AVAILABLE" || seq[i - 1] === "NOT_AVAILABLE") {
      if (seq[i] === "NOT_AVAILABLE" && seq[i - 1] !== "NOT_AVAILABLE" && seq[i - 1] !== "UNCOMMITTED") {
        divergence = labels[i];
        break;
      }
      continue;
    }
    if (seq[i] !== seq[i - 1] && seq[i] !== "UNCOMMITTED" && seq[i - 1] !== "UNCOMMITTED") {
      divergence = labels[i];
      break;
    }
  }
  return {
    schema: "SOURCE_LINEAGE_STATUS_V1",
    work_id,
    workspace_base_revision: workspace,
    candidate_revision: candidate,
    canonical_revision: canonical,
    remote_revision: remote,
    deployment_revision: deployment,
    runtime_revision: runtime,
    SOURCE_LINEAGE_ALIGNED: aligned,
    divergence_boundary: aligned ? null : (divergence ?? "UNRESOLVED"),
  };
}

function lastVerified(rows: readonly ProductionCheckpointV1[]): CheckpointType | "NOT_AVAILABLE" {
  const order = CHECKPOINT_TYPES.filter((type) => type !== "WORK_COMPLETED");
  let last: CheckpointType | "NOT_AVAILABLE" = "NOT_AVAILABLE";
  for (const type of order) {
    if (rows.find((row) => row.checkpoint_type === type)?.state === "VERIFIED") last = type;
  }
  return last;
}

function currentCheckpoint(rows: readonly ProductionCheckpointV1[]): CheckpointType {
  const stuck = rows.find((row) => row.state === "ACTIVE" || row.state === "FAILED" || row.state === "BLOCKED");
  if (stuck) return stuck.checkpoint_type;
  const pending = CHECKPOINT_TYPES.find((type) => rows.find((row) => row.checkpoint_type === type)?.state === "PENDING");
  return pending ?? "WORK_COMPLETED";
}

function nextExpected(rows: readonly ProductionCheckpointV1[]): CheckpointType | "NOT_AVAILABLE" | "NONE" {
  for (const type of CHECKPOINT_TYPES) {
    const row = rows.find((item) => item.checkpoint_type === type);
    if (row && (row.state === "PENDING" || row.state === "ACTIVE")) return type;
  }
  if (rows.find((row) => row.checkpoint_type === "WORK_COMPLETED")?.state === "VERIFIED") return "NONE";
  return "NOT_AVAILABLE";
}

export function buildCompletionReport(input: {
  readonly work_id: string;
  readonly subject: string;
  readonly client: string;
  readonly started_at: string;
  readonly rows: readonly ProductionCheckpointV1[];
  readonly pipe: PipelineRecordV1 | null;
  readonly readiness: WorkCompletionReadinessV1;
  readonly reports_created: number;
  readonly artifacts_created: number;
}): WorkCompletionReportV1 {
  const env = classifyProductionEnvironment(input.pipe);
  const get = (type: CheckpointType) => input.rows.find((row) => row.checkpoint_type === type);
  const remaining = input.readiness.missing.map((type) => type);
  return {
    schema: WORK_COMPLETION_REPORT,
    work_id: input.work_id,
    subject: input.subject,
    client: input.client,
    started_at: input.started_at,
    completed_at: get("WORK_COMPLETED")?.state === "VERIFIED" ? (get("WORK_COMPLETED")?.completed_at ?? nowIso()) : null,
    final_checkpoint: currentCheckpoint(input.rows),
    reports_created: input.reports_created,
    artifacts_created: input.artifacts_created,
    tests_summary: get("TEST_VERIFIED")?.state ?? "NOT_AVAILABLE",
    integration_summary: get("INTEGRATED")?.state ?? "NOT_AVAILABLE",
    publish_summary: get("REMOTE_PUBLISHED")?.state ?? "NOT_AVAILABLE",
    deployment_summary: `${get("DEPLOYED")?.state ?? "NOT_AVAILABLE"}:${env}`,
    runtime_summary: get("RUNTIME_VERIFIED")?.state ?? "NOT_AVAILABLE",
    capability_summary: get("CAPABILITY_REGISTERED")?.state ?? "NOT_AVAILABLE",
    remaining_actions: remaining,
    evidence_refs: input.rows.flatMap((row) => row.evidence_refs),
    deployment_target_type: env,
    runtime_verification_type: env,
    PRODUCTION_ENVIRONMENT: env,
  };
}

function emitEvent(input: {
  readonly event_type: string;
  readonly work_id: string;
  readonly current_state: string;
  readonly previous_state: string | null;
  readonly facts: Record<string, string | number | boolean | null>;
  readonly evidence_refs: readonly string[];
  readonly action_required?: boolean;
  readonly owner_attention?: boolean;
  readonly severity?: "INFO" | "WARN" | "ERROR";
}): void {
  const extra = `${input.facts.revision ?? ""}|${input.facts.checkpoint ?? ""}|${input.facts.catchup ?? ""}`;
  const key = `${input.event_type}|${input.work_id}|${input.current_state}|${extra}`;
  if (rememberEmitted(key)) return;
  evaluateCanonicalEvent(makeCanonicalEvent({
    event_id: `evt:ckpt:${input.work_id}:${input.event_type}:${input.current_state}:${String(input.facts.revision ?? "na")}`,
    event_type: input.event_type,
    entity_id: `entity:work:${input.work_id}`,
    work_id: input.work_id,
    command_id: null,
    source_system: "dna-os-production-checkpoint",
    previous_state: input.previous_state,
    current_state: input.current_state,
    severity: input.severity ?? "INFO",
    owner_attention: input.owner_attention ?? false,
    action_required: input.action_required ?? false,
    evidence_refs: input.evidence_refs,
  }), input.facts);
}

function emitContinuous(prev: readonly ProductionCheckpointV1[], next: readonly ProductionCheckpointV1[], work_id: string, subject: string, reports: number, readiness: WorkCompletionReadinessV1, env: ProductionEnvironment): void {
  const prevMap = new Map(prev.map((row) => [row.checkpoint_type, row]));
  for (const row of next) {
    const before = prevMap.get(row.checkpoint_type);
    if (before?.state === row.state) continue;
    if (row.state === "VERIFIED") {
      const type = row.checkpoint_type === "REMOTE_PUBLISHED" ? "PUBLISHED"
        : row.checkpoint_type === "DEPLOYED" ? "DEPLOYED"
        : row.checkpoint_type === "RUNTIME_VERIFIED" ? "RUNTIME_VERIFIED"
        : row.checkpoint_type === "CAPABILITY_REGISTERED" ? "CAPABILITY_REGISTERED"
        : row.checkpoint_type === "OWNER_ENABLED" ? "CAPABILITY_AVAILABLE"
        : row.checkpoint_type === "WORK_COMPLETED" ? "WORK_FULLY_COMPLETED"
        : "WORK_CHECKPOINT_COMPLETED";
      emitEvent({
        event_type: type,
        work_id,
        current_state: row.checkpoint_type,
        previous_state: before?.state ?? null,
        facts: {
          subject,
          checkpoint: row.checkpoint_type,
          revision: row.revision,
          reports_created: reports,
          PRODUCTION_ENVIRONMENT: env,
        },
        evidence_refs: row.evidence_refs,
      });
      if (row.checkpoint_type === "WORK_COMPLETED") {
        emitEvent({
          event_type: "WORK_COMPLETION_REPORT_READY",
          work_id,
          current_state: "WORK_COMPLETION_REPORT_READY",
          previous_state: null,
          facts: { subject, reports_created: reports, checkpoint: "WORK_COMPLETED", revision: row.revision },
          evidence_refs: row.evidence_refs,
        });
      }
    } else if (row.state === "FAILED") {
      emitEvent({
        event_type: "WORK_CHECKPOINT_FAILED",
        work_id,
        current_state: row.checkpoint_type,
        previous_state: before?.state ?? null,
        facts: { subject, checkpoint: row.checkpoint_type, revision: row.revision, failure_reason: row.failure_reason },
        evidence_refs: row.evidence_refs,
        severity: "ERROR",
        owner_attention: true,
      });
    } else if (row.checkpoint_type === "OWNER_APPROVAL_REQUIRED" && row.state === "ACTIVE") {
      emitEvent({
        event_type: "WORK_WAITING_FOR_OWNER",
        work_id,
        current_state: row.checkpoint_type,
        previous_state: before?.state ?? null,
        facts: { subject, checkpoint: row.checkpoint_type, revision: row.revision },
        evidence_refs: row.evidence_refs,
        action_required: true,
        owner_attention: true,
      });
    }
  }
  void readiness;
}

function catchupKind(readiness: WorkCompletionReadinessV1, rows: readonly ProductionCheckpointV1[], reports: number): { event_type: string; message_kind: string; facts: Record<string, string | number | boolean | null> } {
  const last = lastVerified(rows);
  if (readiness.WORK_COMPLETED) {
    return { event_type: "WORK_FULLY_COMPLETED", message_kind: "FULL", facts: { reports_created: reports, checkpoint: "WORK_COMPLETED" } };
  }
  if (readiness.stuck_state === "BLOCKED_BY_FAILURE") {
    return { event_type: "WORK_CHECKPOINT_FAILED", message_kind: "BLOCKED", facts: { checkpoint: currentCheckpoint(rows), reports_created: reports } };
  }
  if (readiness.stuck_state === "WAITING_FOR_OWNER_ENABLE" || readiness.owner_attention_required) {
    return { event_type: "WORK_WAITING_FOR_OWNER", message_kind: "OWNER", facts: { checkpoint: "OWNER_APPROVAL_REQUIRED", reports_created: reports } };
  }
  if (readiness.stuck_state === "WAITING_FOR_PUBLISH") {
    return { event_type: "WORK_CHECKPOINT_COMPLETED", message_kind: "WAIT_PUBLISH", facts: { checkpoint: "REMOTE_PUBLISHED", reports_created: reports } };
  }
  if (readiness.stuck_state === "WAITING_FOR_DEPLOYMENT") {
    return { event_type: "WORK_CHECKPOINT_COMPLETED", message_kind: "WAIT_DEPLOY", facts: { checkpoint: "DEPLOYED", reports_created: reports } };
  }
  if (readiness.stuck_state === "WAITING_FOR_RUNTIME_VERIFY") {
    return { event_type: "WORK_CHECKPOINT_COMPLETED", message_kind: "WAIT_RUNTIME", facts: { checkpoint: "RUNTIME_VERIFIED", reports_created: reports } };
  }
  if (last === "TEST_VERIFIED" || last === "BUILD_VERIFIED") {
    return { event_type: "WORK_CHECKPOINT_COMPLETED", message_kind: "VERIFIED", facts: { checkpoint: last, reports_created: reports } };
  }
  if (reports > 0) {
    return { event_type: "WORK_CHECKPOINT_COMPLETED", message_kind: "REPORTS", facts: { checkpoint: last, reports_created: reports } };
  }
  return { event_type: "WORK_CHECKPOINT_COMPLETED", message_kind: "STAGE", facts: { checkpoint: currentCheckpoint(rows), reports_created: reports } };
}

export interface RegisteredWorkBundle {
  readonly work_id: string;
  readonly subject: string;
  readonly client: string;
  readonly pipe: PipelineRecordV1 | null;
  readonly submitted: OwnerSubmittedWorkV1 | undefined;
  readonly activity: CodingClientActivityV1 | undefined;
  readonly unregistered: boolean;
}

export function collectRegisteredWork(includeDiskCatalog: boolean): RegisteredWorkBundle[] {
  const pipes = new Map<string, PipelineRecordV1>();
  for (const row of listPipelineRecords()) pipes.set(row.work_id, row);
  if (includeDiskCatalog) {
    for (const row of listDiskCatalogPipelines()) {
      if (!pipes.has(row.work_id)) pipes.set(row.work_id, row);
    }
  }
  const submitted = listSubmittedWork();
  const activities = listCodingActivities();
  const ids = new Set<string>([...pipes.keys(), ...submitted.map((row) => row.work_id)]);
  const bundles: RegisteredWorkBundle[] = [];
  for (const work_id of ids) {
    const pipe = pipes.get(work_id) ?? null;
    const sub = submitted.find((row) => row.work_id === work_id);
    const activity = activities.find((row) => row.work_id === work_id);
    bundles.push({
      work_id,
      subject: sub?.subject ?? pipe?.intent.owner_goal ?? activity?.subject ?? "UNRESOLVED",
      client: sub?.assigned_client ?? activity?.client_id ?? "NOT_AVAILABLE",
      pipe,
      submitted: sub,
      activity,
      unregistered: false,
    });
  }
  for (const activity of activities) {
    if (ids.has(activity.work_id)) continue;
    bundles.push({
      work_id: activity.work_id,
      subject: activity.subject,
      client: activity.client_id,
      pipe: null,
      submitted: undefined,
      activity,
      unregistered: true,
    });
  }
  return bundles;
}

function projectItem(bundle: RegisteredWorkBundle, rows: readonly ProductionCheckpointV1[], readiness: WorkCompletionReadinessV1, reports: number): OwnerWorkItemProjectionV1 {
  const lineage = sourceLineageStatus(bundle.pipe);
  return {
    work_id: bundle.work_id,
    subject: bundle.subject,
    client: bundle.client,
    current_checkpoint: currentCheckpoint(rows),
    current_stage: bundle.submitted?.current_stage ?? bundle.pipe?.state ?? bundle.activity?.current_stage ?? "NOT_AVAILABLE",
    last_verified_checkpoint: lastVerified(rows),
    next_expected_checkpoint: nextExpected(rows),
    reports_created: reports,
    last_activity_at: bundle.submitted?.last_activity_at ?? bundle.activity?.last_activity_at ?? bundle.pipe?.updated_at ?? "NOT_AVAILABLE",
    attention_required: readiness.owner_attention_required,
    stuck_state: readiness.stuck_state,
    CANONICAL_REVISION: lineage.canonical_revision,
    REMOTE_REVISION: lineage.remote_revision,
    DEPLOYMENT_STATE: rows.find((row) => row.checkpoint_type === "DEPLOYED")?.state ?? "NOT_AVAILABLE",
    RUNTIME_STATE: rows.find((row) => row.checkpoint_type === "RUNTIME_VERIFIED")?.state ?? "NOT_AVAILABLE",
    OWNER_ATTENTION: readiness.owner_attention_required,
  };
}

export function reconcileRegisteredWork(options: { readonly includeDiskCatalog?: boolean; readonly catchup?: boolean } = {}): CurrentWorkOwnerReportV1 {
  const includeDisk = options.includeDiskCatalog ?? false;
  const catchup = options.catchup ?? false;
  const bundles = collectRegisteredWork(includeDisk);
  const items: OwnerWorkItemProjectionV1[] = [];
  let catchupCount = 0;
  let reportsTotal = 0;
  let aligned: boolean | "UNRESOLVED" = "UNRESOLVED";
  let env: ProductionEnvironment = "NOT_AVAILABLE";

  for (const bundle of bundles) {
    const outputs = listOutputs().filter((row) => row.work_id === bundle.work_id);
    const reportRefs = outputs.filter((row) => row.kind === "report").map((row) => row.output_id);
    reportsTotal += reportRefs.length + (bundle.submitted?.reports_created ?? 0);
    if (bundle.unregistered) {
      const rows = deriveCheckpoints({
        work_id: bundle.work_id,
        subject: bundle.subject,
        pipe: null,
        submitted: undefined,
        activity: bundle.activity,
        reports: reportRefs,
      }).map((row) => row.checkpoint_type === "WORK_COMPLETED" ? { ...row, state: "PENDING" as const } : row);
      persistCheckpointsForWork(bundle.work_id, rows);
      if (catchup && !rememberCatchup(`unreg|${bundle.work_id}`)) {
        emitEvent({
          event_type: "UNREGISTERED_AGENT_ACTIVITY",
          work_id: bundle.work_id,
          current_state: "UNREGISTERED_AGENT_ACTIVITY",
          previous_state: null,
          facts: { subject: bundle.subject, client: bundle.client, catchup: true, checkpoint: "UNREGISTERED_AGENT_ACTIVITY" },
          evidence_refs: [`activity:${bundle.activity?.client_id ?? "unknown"}`],
          owner_attention: true,
        });
        catchupCount += 1;
      }
      items.push({
        work_id: bundle.work_id,
        subject: bundle.subject,
        client: bundle.client,
        current_checkpoint: "IMPLEMENTING",
        current_stage: bundle.activity?.current_stage ?? "UNREGISTERED_AGENT_ACTIVITY",
        last_verified_checkpoint: "NOT_AVAILABLE",
        next_expected_checkpoint: "WORK_CREATED",
        reports_created: reportRefs.length,
        last_activity_at: bundle.activity?.last_activity_at ?? "NOT_AVAILABLE",
        attention_required: true,
        stuck_state: "UNREGISTERED_AGENT_ACTIVITY",
        CANONICAL_REVISION: "UNRESOLVED",
        REMOTE_REVISION: "NOT_AVAILABLE",
        DEPLOYMENT_STATE: "NOT_AVAILABLE",
        RUNTIME_STATE: "NOT_AVAILABLE",
        OWNER_ATTENTION: true,
      });
      continue;
    }

    const prev = listCheckpoints().filter((row) => row.work_id === bundle.work_id);
    const rows = deriveCheckpoints({
      work_id: bundle.work_id,
      subject: bundle.subject,
      pipe: bundle.pipe,
      submitted: bundle.submitted,
      activity: bundle.activity,
      reports: reportRefs,
    });
    persistCheckpointsForWork(bundle.work_id, rows);
    const readiness = completionReadiness(rows, bundle.pipe, bundle.submitted);
    const report = buildCompletionReport({
      work_id: bundle.work_id,
      subject: bundle.subject,
      client: bundle.client,
      started_at: bundle.submitted?.submitted_at ?? bundle.pipe?.created_at ?? nowIso(),
      rows,
      pipe: bundle.pipe,
      readiness,
      reports_created: reportRefs.length || bundle.submitted?.reports_created || 0,
      artifacts_created: outputs.filter((row) => row.kind === "artifact").length,
    });
    persistCompletionReport(report);
    env = report.PRODUCTION_ENVIRONMENT;
    const lineage = sourceLineageStatus(bundle.pipe);
    if (aligned === "UNRESOLVED") aligned = lineage.SOURCE_LINEAGE_ALIGNED;
    else aligned = aligned === true && lineage.SOURCE_LINEAGE_ALIGNED;

    if (catchup) {
      const key = `catchup|${bundle.work_id}`;
      if (!rememberCatchup(key)) {
        const kind = catchupKind(readiness, rows, report.reports_created);
        emitEvent({
          event_type: kind.event_type,
          work_id: bundle.work_id,
          current_state: String(kind.facts.checkpoint ?? currentCheckpoint(rows)),
          previous_state: null,
          facts: {
            subject: bundle.subject,
            catchup: true,
            catchup_kind: kind.message_kind,
            reports_created: report.reports_created,
            checkpoint: kind.facts.checkpoint ?? currentCheckpoint(rows),
            revision: rows.find((row) => row.checkpoint_type === "WORK_COMPLETED")?.revision ?? "NOT_AVAILABLE",
            PRODUCTION_ENVIRONMENT: env,
          },
          evidence_refs: report.evidence_refs,
          action_required: kind.event_type === "WORK_WAITING_FOR_OWNER",
          owner_attention: kind.event_type === "WORK_WAITING_FOR_OWNER" || kind.event_type === "WORK_CHECKPOINT_FAILED",
          severity: kind.event_type === "WORK_CHECKPOINT_FAILED" ? "ERROR" : "INFO",
        });
        catchupCount += 1;
      }
    } else {
      emitContinuous(prev, rows, bundle.work_id, bundle.subject, report.reports_created, readiness, env);
    }
    items.push(projectItem(bundle, rows, readiness, report.reports_created));
  }

  const blocked = items.filter((row) => row.stuck_state === "BLOCKED_BY_FAILURE" || row.current_stage.includes("BLOCK") || row.current_stage === "FAILED");
  const waitingOwner = items.filter((row) => row.OWNER_ATTENTION && (row.stuck_state === "WAITING_FOR_OWNER_ENABLE" || row.attention_required && row.stuck_state !== "UNREGISTERED_AGENT_ACTIVITY"));
  const completed = items.filter((row) => {
    const wc = listCheckpoints().find((item) => item.work_id === row.work_id && item.checkpoint_type === "WORK_COMPLETED");
    return wc?.state === "VERIFIED";
  });
  const running = items.filter((row) => !completed.some((item) => item.work_id === row.work_id) && row.stuck_state !== "UNREGISTERED_AGENT_ACTIVITY");

  return {
    CURRENT_RUNNING_WORK: running.length,
    CURRENT_COMPLETED_WORK: completed.length,
    CURRENT_BLOCKED_WORK: blocked.length,
    CURRENT_WAITING_OWNER: waitingOwner.length,
    CURRENT_REPORTS_CREATED: reportsTotal,
    items,
    catchup_notifications: catchupCount,
    PRODUCTION_ENVIRONMENT: env,
    SOURCE_LINEAGE_ALIGNED: aligned,
  };
}

export function getProductionCheckpoint(work_id: string, checkpoint_type?: string): ProductionCheckpointV1 | readonly ProductionCheckpointV1[] | null {
  const rows = listCheckpoints().filter((row) => row.work_id === work_id);
  if (checkpoint_type) return rows.find((row) => row.checkpoint_type === checkpoint_type) ?? null;
  return rows;
}

export function listProductionCheckpoints(work_id?: string): readonly ProductionCheckpointV1[] {
  const rows = listCheckpoints();
  return work_id ? rows.filter((row) => row.work_id === work_id) : rows;
}

export function getWorkCompletionReadiness(work_id: string): WorkCompletionReadinessV1 | null {
  const rows = listCheckpoints().filter((row) => row.work_id === work_id);
  if (rows.length === 0) return null;
  const pipe = [...listPipelineRecords(), ...listDiskCatalogPipelines()].find((row) => row.work_id === work_id) ?? null;
  const submitted = listSubmittedWork().find((row) => row.work_id === work_id);
  return completionReadiness(rows, pipe, submitted);
}

export function getWorkCompletionReport(work_id: string): WorkCompletionReportV1 | null {
  return listCompletionReports().find((row) => row.work_id === work_id) ?? null;
}

export function getSourceLineageStatus(work_id: string): SourceLineageStatusV1 {
  const pipe = [...listPipelineRecords(), ...listDiskCatalogPipelines()].find((row) => row.work_id === work_id) ?? null;
  return sourceLineageStatus(pipe);
}

export function extendedOwnerWorkNotificationSummary(): Record<string, unknown> {
  const items = collectRegisteredWork(false).map((bundle) => {
    const rows = listCheckpoints().filter((row) => row.work_id === bundle.work_id);
    const reports = listOutputs().filter((row) => row.work_id === bundle.work_id && row.kind === "report").length;
    const readiness = rows.length ? completionReadiness(rows, bundle.pipe, bundle.submitted) : null;
    return {
      work_id: bundle.work_id,
      subject: bundle.subject,
      client: bundle.client,
      current_checkpoint: rows.length ? currentCheckpoint(rows) : "NOT_AVAILABLE",
      current_stage: bundle.submitted?.current_stage ?? bundle.pipe?.state ?? "NOT_AVAILABLE",
      last_verified_checkpoint: rows.length ? lastVerified(rows) : "NOT_AVAILABLE",
      next_expected_checkpoint: rows.length ? nextExpected(rows) : "NOT_AVAILABLE",
      reports_created: reports || bundle.submitted?.reports_created || 0,
      last_activity_at: bundle.submitted?.last_activity_at ?? bundle.pipe?.updated_at ?? "NOT_AVAILABLE",
      attention_required: readiness?.owner_attention_required ?? bundle.submitted?.attention_required ?? false,
    };
  });
  const today = new Date().toISOString().slice(0, 10);
  const completedToday = listCompletionReports().filter((row) => row.completed_at?.startsWith(today)).length;
  return {
    schema: "OWNER_WORK_NOTIFICATION_SUMMARY_V1",
    running_work_count: items.filter((row) => row.current_checkpoint !== "WORK_COMPLETED").length,
    completed_today_count: completedToday,
    failed_work_count: listCheckpoints().filter((row) => row.checkpoint_type === "WORK_COMPLETED" && row.state === "FAILED").length
      || listSubmittedWork().filter((row) => row.failures > 0).length,
    blocked_work_count: items.filter((row) => String(row.current_stage).includes("BLOCK")).length,
    waiting_owner_count: items.filter((row) => row.attention_required).length,
    reports_created_count: listOutputs().filter((row) => row.kind === "report").length,
    work: items,
    ...TRUTH_LOCKS,
    PRODUCTION_CHECKPOINT_RECONCILIATION_V1: true,
    CONTINUOUS_PRODUCTION_RECONCILER_V1: CONTINUOUS_PRODUCTION_RECONCILER,
    OWNER_WORK_COMPLETION_NOTIFICATION_V1: OWNER_WORK_COMPLETION_NOTIFICATION,
    PRODUCTION_CHECKPOINT_STALENESS_V1: PRODUCTION_CHECKPOINT_STALENESS,
  };
}

export function productionCheckpointSurfaceSlice(): Record<string, unknown> {
  return {
    schema: PRODUCTION_CHECKPOINT_RECONCILIATION,
    grants_authority: false,
    OWNER_UI_PRESENCE_REQUIRED: false,
    CODING_CLIENT_FRONTMOST_REQUIRED: false,
    REPOSITORY_REDISCOVERY_REQUIRED: false,
    AGENT_STATUS_QUERY_REQUIRED: false,
    summary: extendedOwnerWorkNotificationSummary(),
  };
}

export { PRODUCTION_CHECKPOINT_RECONCILIATION, TRUTH_LOCKS };
