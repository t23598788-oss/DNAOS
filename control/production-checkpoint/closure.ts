/**
 * PRODUCTION_ADMISSION_AND_LINEAGE_CLOSURE_V1
 * Classifies registered work, closes lineage reporting, and finalizes stale
 * historical records. Does not auto-repair divergence or invent cloud deploy.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listOutputs } from "../inbound-event-fabric/persist";
import { evaluateCanonicalEvent, makeCanonicalEvent } from "../owner-notification/contract";
import {
  codingClientDeploy,
  githubEnvironmentProtectionStatus,
  githubPublishToDeploymentAuthority,
  listRegisteredDeploymentTargets,
  productionBoundaryProjection,
  productionGate,
  verifyRuntime,
} from "../work-production-pipeline/contract";
import { listVerifications } from "../work-production-pipeline/persist";
import type { PipelineRecordV1 } from "../work-production-pipeline/types";
import { repoRoot } from "./host-runtime";
import { lastGithubEnvironmentProbe, lastRailwayDeployCapability, listFinalizations, persistFinalization, rememberCatchup, isRemoteTargetOwnerEnabled } from "./persist";
import {
  collectRegisteredWork,
  deriveCheckpoints,
  listProductionCheckpoints,
  reconcileRegisteredWork,
  sourceLineageStatus,
} from "./reconcile";
import {
  OWNER_PRODUCTION_READINESS_SUMMARY,
  PRODUCTION_ADMISSION_AND_LINEAGE_CLOSURE,
  PRODUCTION_ADMISSION_READINESS,
  SOURCE_LINEAGE_CLOSURE,
  WORK_STATE_FINALIZATION,
  type ActivityClass,
  type ClosedWorkItemV1,
  type DeploymentTargetStatusV1,
  type FinalizationState,
  type LineageStatus,
  type ProductionAdmissionReadinessV1,
  type SourceLineageClosureV1,
  type WorkClassification,
  type WorkStateFinalizationV1,
} from "./types";

function na(value: unknown): string {
  if (value === undefined || value === null || value === "") return "NOT_AVAILABLE";
  return String(value);
}

function isSha(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value) && value !== "UNCOMMITTED";
}

function verificationPass(work_id: string, test_id: string): boolean {
  return listVerifications<Record<string, unknown>>().some((row) => row.work_id === work_id && row.test_id === test_id && row.status === "PASS");
}

export function closeSourceLineage(pipe: PipelineRecordV1 | null, work_id: string): SourceLineageClosureV1 {
  const base = na(pipe?.work_order.base_revision);
  const workspace = na(pipe?.lineage.development_workspace ? pipe.work_order.base_revision : pipe?.work_order.base_revision);
  const candidate = na(typeof pipe?.lineage.commit === "string" ? pipe.lineage.commit : null);
  const canonical = na(pipe?.source_revision);
  const remote = na(pipe?.remote_sha);
  const deployment = na(pipe?.deployment_id ? pipe.source_revision : null);
  const runtime = na(typeof pipe?.lineage.runtime_revision === "string" ? pipe.lineage.runtime_revision : null);
  const values = [base, workspace, candidate, canonical, remote, deployment, runtime];
  const labels: LineageStatus[] = [
    "DIVERGED_AT_WORKSPACE",
    "DIVERGED_AT_WORKSPACE",
    "DIVERGED_AT_WORKSPACE",
    "DIVERGED_AT_CANONICAL",
    "DIVERGED_AT_REMOTE",
    "DIVERGED_AT_DEPLOYMENT",
    "DIVERGED_AT_RUNTIME",
  ];
  const present = values.map((value, i) => ({ value, label: labels[i]! })).filter((row) => row.value !== "NOT_AVAILABLE");
  let status: LineageStatus = "NOT_AVAILABLE";
  if (present.length === 0) status = "NOT_AVAILABLE";
  else if (present.every((row) => row.value === present[0]!.value && isSha(row.value))) status = "ALIGNED";
  else {
    let prev: string | null = null;
    status = "DIVERGED_AT_CANONICAL";
    for (const row of present) {
      if (row.value === "UNCOMMITTED") {
        status = "DIVERGED_AT_CANONICAL";
        break;
      }
      if (prev && row.value !== prev) {
        status = row.label;
        break;
      }
      prev = row.value;
    }
  }
  return {
    schema: SOURCE_LINEAGE_CLOSURE,
    work_id,
    base_revision: base,
    workspace_revision: workspace,
    candidate_revision: candidate === "NOT_AVAILABLE" ? workspace : candidate,
    canonical_revision: canonical,
    remote_revision: remote,
    deployment_revision: deployment,
    runtime_revision: runtime,
    LINEAGE_STATUS: status,
    AUTO_REPAIR_ALLOWED: false,
  };
}

export function admissionReadiness(work_id: string, pipe: PipelineRecordV1 | null): ProductionAdmissionReadinessV1 {
  const outputs = listOutputs().filter((row) => row.work_id === work_id);
  const scope_valid = Boolean(pipe?.work_order.allowed_paths?.length || pipe?.work_order.target_files?.length) && !pipe?.work_order.discovery_required;
  const lease_evidence_valid = pipe !== null && pipe.state !== "REQUESTED";
  const postMachine = Boolean(pipe && (
    ["BUILD_VERIFIED", "TEST_VERIFIED", "INTEGRATION_VERIFIED", "REVIEW_READY", "APPROVED_FOR_PUBLISH", "PUBLISHED", "PROMOTION_READY", "DEPLOYMENT_READY", "DEPLOYED", "RUNTIME_VERIFYING", "RUNTIME_VERIFIED", "CAPABILITY_REGISTERED", "ACTIVE"].includes(pipe.state)
    || (pipe.state === "FAILED" && Boolean(pipe.remote_sha || pipe.deployment_id))
  ));
  const mutation = Boolean(pipe?.lineage.files_diff) || Boolean(pipe?.evidence.hash) || pipe?.state === "AUTHORED" || pipe?.state === "ASSEMBLED" || Boolean(pipe?.artifact_id) || postMachine;
  const needsBuild = (pipe?.work_order.required_builds?.length ?? 0) > 0;
  const needsTest = (pipe?.work_order.required_tests?.length ?? 0) > 0;
  const required_build_passed = !needsBuild || verificationPass(work_id, "pipeline.build.hash_check") || postMachine;
  const required_tests_passed = !needsTest || verificationPass(work_id, "pipeline.test.marker") || postMachine;
  const revision_preimage_passed = Boolean(pipe?.source_revision && pipe.source_revision !== "UNCOMMITTED") || Boolean(pipe?.evidence.artifact);
  const no_unresolved_conflict = (pipe?.missing.length ?? 0) === 0 && pipe?.state !== "FAILED" && pipe?.state !== "BLOCKED";
  const work_output_exists = outputs.length > 0 || Boolean(pipe?.artifact_id) || postMachine;
  const candidate_source_handle_exists = Boolean(pipe?.evidence.workspace_root) || Boolean(pipe?.lineage.development_workspace) || postMachine;
  const missing: string[] = [];
  if (!scope_valid) missing.push("SCOPE");
  if (!lease_evidence_valid) missing.push("LEASE");
  if (!mutation) missing.push("SOURCE_MUTATION");
  if (!required_build_passed) missing.push("BUILD");
  if (!required_tests_passed) missing.push("TEST");
  if (!revision_preimage_passed) missing.push("REVISION_PREIMAGE");
  if (!no_unresolved_conflict) missing.push("CONFLICT");
  if (!work_output_exists) missing.push("OUTPUT");
  if (!candidate_source_handle_exists) missing.push("CANDIDATE_HANDLE");
  const alreadyAdmitted = Boolean(pipe && ["INTEGRATION_VERIFIED", "REVIEW_READY", "APPROVED_FOR_PUBLISH", "PUBLISHED", "PROMOTION_READY", "DEPLOYMENT_READY", "DEPLOYED", "RUNTIME_VERIFYING", "RUNTIME_VERIFIED", "CAPABILITY_REGISTERED", "ACTIVE"].includes(pipe.state));
  const READY = missing.length === 0 && pipe?.intent.production_intent === true && !alreadyAdmitted && pipe.state !== "FAILED";
  return {
    schema: PRODUCTION_ADMISSION_READINESS,
    work_id,
    READY,
    scope_valid,
    lease_evidence_valid,
    source_mutation_evidence_valid: mutation,
    required_build_passed,
    required_tests_passed,
    revision_preimage_passed,
    no_unresolved_conflict,
    work_output_exists,
    candidate_source_handle_exists,
    missing,
  };
}

function classifyWork(input: {
  readonly unregistered: boolean;
  readonly pipe: PipelineRecordV1 | null;
  readonly admission: ProductionAdmissionReadinessV1;
  readonly stuck: string;
}): WorkClassification {
  if (input.unregistered) return "UNREGISTERED_ACTIVITY";
  if (input.pipe?.state === "FAILED" || input.stuck === "BLOCKED_BY_FAILURE") return "BLOCKED_BY_FAILURE";
  if (input.admission.READY) return "READY_FOR_ADMISSION";
  const pipe = input.pipe;
  const needsBuild = (pipe?.work_order.required_builds?.length ?? 0) > 0;
  const needsTest = (pipe?.work_order.required_tests?.length ?? 0) > 0;
  if (pipe && (needsBuild || needsTest) && (!input.admission.required_build_passed || !input.admission.required_tests_passed)) {
    return "WAITING_FOR_MACHINE_VERIFICATION";
  }
  if (pipe && (pipe.promotion === "INTEGRATED" || pipe.state === "INTEGRATION_VERIFIED") && (pipe.source_revision === "UNCOMMITTED" || !isSha(String(pipe.source_revision)))) {
    return "WAITING_FOR_CANONICAL_COMMIT";
  }
  if (input.stuck === "WAITING_FOR_PUBLISH") return "WAITING_FOR_PUBLISH";
  if (input.stuck === "WAITING_FOR_DEPLOYMENT") return "WAITING_FOR_DEPLOYMENT";
  if (input.stuck === "WAITING_FOR_RUNTIME_VERIFY") return "WAITING_FOR_RUNTIME_VERIFY";
  if (input.stuck === "WAITING_FOR_OWNER_ENABLE") return "WAITING_FOR_OWNER_ENABLE";
  if (!pipe?.intent.production_intent) return "NOT_PRODUCTION_BOUND";
  if (input.stuck === "WAITING_FOR_INTEGRATION") return "WAITING_FOR_INTEGRATION";
  return "WAITING_FOR_INTEGRATION";
}

function activityClass(input: {
  readonly classification: WorkClassification;
  readonly pipe: PipelineRecordV1 | null;
  readonly last_activity_at: string;
  readonly finalized: FinalizationState | null;
}): ActivityClass {
  if (input.finalized) return input.finalized === "BLOCKED" ? "BLOCKED" : "STALE";
  if (input.classification === "BLOCKED_BY_FAILURE") return "BLOCKED";
  if (input.classification === "READY_FOR_ADMISSION") return "READY_FOR_ADMISSION";
  const pipe = input.pipe;
  const historicalFixture = pipe?.work_order.repository_id === "repo://pipeline-fixture"
    && pipe.state === "IN_DEVELOPMENT"
    && (pipe.source_revision === "UNCOMMITTED" || pipe.promotion === "LOCAL_ONLY")
    && (pipe.transitions?.length ?? 0) === 0
    && Object.keys(pipe.evidence ?? {}).length === 0;
  if (historicalFixture) return "STALE";
  if (input.classification.startsWith("WAITING_")) return "WAITING";
  if (input.classification === "NOT_PRODUCTION_BOUND" && historicalFixture) return "STALE";
  if (input.classification === "NOT_PRODUCTION_BOUND") return "WAITING";
  return "ACTIVE";
}

function finalizeIfStale(work_id: string, activity: ActivityClass, pipe: PipelineRecordV1 | null): WorkStateFinalizationV1 | null {
  const existing = listFinalizations().find((row) => row.work_id === work_id);
  if (existing) return existing;
  if (activity !== "STALE" && activity !== "BLOCKED") return null;
  const later = collectRegisteredWork(true).filter((row) => {
    if (!pipe || !row.pipe) return false;
    return row.pipe.work_order.repository_id === pipe.work_order.repository_id
      && row.work_id !== work_id
      && Date.parse(row.pipe.updated_at) > Date.parse(pipe.updated_at);
  });
  const finalized_as: FinalizationState = activity === "BLOCKED" ? "BLOCKED" : (later.length > 0 ? "SUPERSEDED" : "ABANDONED");
  const row: WorkStateFinalizationV1 = {
    schema: WORK_STATE_FINALIZATION,
    work_id,
    previous_activity_class: activity,
    finalized_as,
    evidence_refs: [
      `pipeline:${work_id}:${pipe?.state ?? "none"}`,
      `revision:${pipe?.source_revision ?? "NOT_AVAILABLE"}`,
      later[0] ? `superseded_by:${later[0].work_id}` : "no_successor",
    ],
    finalized_at: new Date().toISOString(),
    history_retained: true,
    AUTO_REPAIR_ALLOWED: false,
  };
  persistFinalization(row);
  return row;
}

export function inspectDeploymentTargets(): readonly DeploymentTargetStatusV1[] {
  const bounds = productionBoundaryProjection();
  const mutationWired = bounds.RAILWAY_DEPLOYMENT_MUTATION === "VERIFIED"
    || githubPublishToDeploymentAuthority() === "VERIFIED"
    || lastRailwayDeployCapability()?.mutation_runtime_verified === true;
  return listRegisteredDeploymentTargets().map((row) => {
    const id = String(row.target_id);
    const declared = String(row.target_type ?? "");
    const env = `${row.environment ?? ""} ${row.provider ?? ""} ${row.deployment_method ?? ""} ${id}`;
    const fixture = declared !== "REMOTE_REAL" && (/fixture/i.test(env) || /deploy:\/\/local\//i.test(id));
    const remoteDeclared = declared === "REMOTE_REAL" || String(row.provider ?? "") === "railway";
    const target_type: DeploymentTargetStatusV1["target_type"] = fixture
      ? "LOCAL_FIXTURE"
      : remoteDeclared
        ? "REMOTE_REAL"
        : (mutationWired ? "REMOTE_REAL" : "NOT_WIRED");
    return {
      target_id: id,
      target_type,
      authentication_ready: fixture ? true : Boolean(row.authentication_ready),
      runtime_verified: false,
      owner_enabled: row.owner_enabled === true || isRemoteTargetOwnerEnabled(id) || String(row.authority_policy ?? "").includes("OWNER_ENABLED"),
      mutation_wired: fixture ? true : mutationWired,
      health_probe_wired: Boolean(row.health_probe),
    };
  });
}

export function remoteProductionGate(): {
  readonly REMOTE_PRODUCTION_READY: false | true;
  readonly missing_boundary: "AUTH_NOT_READY" | "DEPLOY_MUTATION_NOT_WIRED" | "HEALTH_PROBE_NOT_WIRED" | "OWNER_NOT_ENABLED" | "PROVIDER_NOT_AVAILABLE" | "NONE";
  readonly PRODUCTION_ENVIRONMENT: "LOCAL_FIXTURE" | "REMOTE_REAL" | "NOT_WIRED" | "NOT_AVAILABLE";
  readonly REMOTE_REAL: "READY" | "NOT_WIRED" | "NOT_AVAILABLE";
} {
  const bounds = productionBoundaryProjection();
  const targets = inspectDeploymentTargets();
  const remote = targets.find((row) => row.target_type === "REMOTE_REAL");
  if (remote && remote.mutation_wired && remote.authentication_ready && remote.health_probe_wired && remote.owner_enabled) {
    return { REMOTE_PRODUCTION_READY: true, missing_boundary: "NONE", PRODUCTION_ENVIRONMENT: "REMOTE_REAL", REMOTE_REAL: "READY" };
  }
  const fixtures = targets.filter((row) => row.target_type === "LOCAL_FIXTURE");
  let missing: "AUTH_NOT_READY" | "DEPLOY_MUTATION_NOT_WIRED" | "HEALTH_PROBE_NOT_WIRED" | "OWNER_NOT_ENABLED" | "PROVIDER_NOT_AVAILABLE" = "DEPLOY_MUTATION_NOT_WIRED";
  if (!remote) missing = fixtures.length > 0 ? "PROVIDER_NOT_AVAILABLE" : "PROVIDER_NOT_AVAILABLE";
  else if (bounds.RAILWAY_DEPLOYMENT_MUTATION === "NOT_WIRED" || githubPublishToDeploymentAuthority() === "NOT_WIRED") missing = "DEPLOY_MUTATION_NOT_WIRED";
  else if (!remote.authentication_ready) missing = "AUTH_NOT_READY";
  else if (!remote.health_probe_wired) missing = "HEALTH_PROBE_NOT_WIRED";
  else if (!remote.owner_enabled) missing = "OWNER_NOT_ENABLED";
  return {
    REMOTE_PRODUCTION_READY: false,
    missing_boundary: missing,
    PRODUCTION_ENVIRONMENT: remote ? "REMOTE_REAL" : (fixtures.length > 0 ? "LOCAL_FIXTURE" : "NOT_WIRED"),
    REMOTE_REAL: remote ? "NOT_WIRED" : "NOT_AVAILABLE",
  };
}

export function githubProtectionStatus(): {
  readonly GITHUB_ENVIRONMENT: "NOT_AVAILABLE" | string;
  readonly GITHUB_REQUIRED_REVIEWERS: "NOT_AVAILABLE";
  readonly GITHUB_PREVENT_SELF_REVIEW: "NOT_AVAILABLE";
  readonly GITHUB_CUSTOM_DEPLOYMENT_PROTECTION: "NOT_AVAILABLE";
  readonly GITHUB_PROTECTION_RUNTIME_VERIFIED: false;
  readonly DNA_OS_PROTECTION_DECISION: "READY" | "NOT_READY" | "OWNER_APPROVAL_REQUIRED" | "BLOCKED";
  readonly CAN_BIND_CUSTOM_DEPLOYMENT_PROTECTION_LATER: false;
  readonly AUTO_CONFIGURED: false;
} {
  const connectionPath = join(repoRoot(), "connections/github/connection-document.json");
  let prPath = "NOT_WIRED";
  if (existsSync(connectionPath)) {
    const doc = JSON.parse(readFileSync(connectionPath, "utf8")) as { boundary_statuses?: Record<string, string> };
    prPath = doc.boundary_statuses?.["Pull Request path"] ?? "NOT_WIRED";
  }
  const env = githubEnvironmentProtectionStatus();
  const probe = lastGithubEnvironmentProbe();
  const latest = collectRegisteredWork(true).map((row) => row.pipe).filter((row): row is PipelineRecordV1 => Boolean(row)).at(-1);
  const decision = latest ? productionGate(latest).decision : "NOT_READY";
  void prPath;
  return {
    GITHUB_ENVIRONMENT: probe?.permission ?? env,
    GITHUB_REQUIRED_REVIEWERS: "NOT_AVAILABLE",
    GITHUB_PREVENT_SELF_REVIEW: "NOT_AVAILABLE",
    GITHUB_CUSTOM_DEPLOYMENT_PROTECTION: "NOT_AVAILABLE",
    GITHUB_PROTECTION_RUNTIME_VERIFIED: false,
    DNA_OS_PROTECTION_DECISION: decision,
    CAN_BIND_CUSTOM_DEPLOYMENT_PROTECTION_LATER: false,
    AUTO_CONFIGURED: false,
  };
}

export async function probeGithubEnvironments(): Promise<{ http_status: number | null; GITHUB_ENVIRONMENT: "NOT_AVAILABLE" }> {
  const url = "https://api.github.com/repos/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/environments";
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "DNA-OS-INFRASTRUCTURE",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    return { http_status: response.status, GITHUB_ENVIRONMENT: "NOT_AVAILABLE" };
  } catch {
    return { http_status: null, GITHUB_ENVIRONMENT: "NOT_AVAILABLE" };
  }
}

function catchupKind(classification: WorkClassification, remoteReady: ReturnType<typeof remoteProductionGate>): string {
  if (classification === "READY_FOR_ADMISSION") return "READY_ADMISSION";
  if (classification === "WAITING_FOR_INTEGRATION") return "WAIT_INTEGRATION";
  if (classification === "WAITING_FOR_CANONICAL_COMMIT") return "WAIT_CANONICAL";
  if (classification === "WAITING_FOR_PUBLISH") return "PUBLISHED";
  if (classification === "WAITING_FOR_DEPLOYMENT") {
    return remoteReady.REMOTE_REAL === "NOT_AVAILABLE" ? "NO_REMOTE_DEPLOY" : "WAIT_DEPLOY";
  }
  if (classification === "WAITING_FOR_RUNTIME_VERIFY") return "WAIT_RUNTIME";
  if (classification === "BLOCKED_BY_FAILURE") return "BLOCKED_RUNTIME";
  if (classification === "NOT_PRODUCTION_BOUND") return "STALE";
  return "STAGE";
}

function emitClosureCatchup(work_id: string, subject: string, classification: WorkClassification, kind: string): boolean {
  const key = `closure-v1|${work_id}|${classification}`;
  if (rememberCatchup(key)) return false;
  evaluateCanonicalEvent(makeCanonicalEvent({
    event_id: `evt:closure:${work_id}:${classification}`,
    event_type: "WORK_CHECKPOINT_COMPLETED",
    entity_id: `entity:work:${work_id}`,
    work_id,
    command_id: null,
    source_system: "dna-os-production-checkpoint",
    previous_state: null,
    current_state: classification,
    severity: classification === "BLOCKED_BY_FAILURE" ? "ERROR" : "INFO",
    owner_attention: classification === "BLOCKED_BY_FAILURE" || classification === "READY_FOR_ADMISSION",
    action_required: classification === "READY_FOR_ADMISSION" || classification === "WAITING_FOR_OWNER_ENABLE",
    evidence_refs: [`closure:${work_id}`],
  }), {
    subject,
    catchup: true,
    catchup_kind: kind,
    checkpoint: classification,
    revision: "NOT_AVAILABLE",
    PRODUCTION_ENVIRONMENT: remoteProductionGate().PRODUCTION_ENVIRONMENT,
  });
  return true;
}

export function closeRegisteredWork(options: { readonly includeDiskCatalog?: boolean; readonly catchup?: boolean } = {}): {
  readonly schema: typeof PRODUCTION_ADMISSION_AND_LINEAGE_CLOSURE;
  readonly items: readonly ClosedWorkItemV1[];
  readonly counts: Record<WorkClassification, number>;
  readonly activity_counts: Record<string, number>;
  readonly catchup_notifications: number;
  readonly stale_finalized: number;
  readonly summary: Record<string, unknown>;
  readonly blocked: {
    readonly WORK_ID: string;
    readonly BLOCKED_CHECKPOINT: string;
    readonly FAILURE_REASON: string;
    readonly LAST_GOOD_REVISION: string;
    readonly OWNER_ACTION_REQUIRED: boolean;
    readonly AUTO_REPAIR_ALLOWED: false;
  } | { readonly WORK_ID: "NOT_AVAILABLE" };
  readonly lineage: SourceLineageClosureV1 | null;
  readonly targets: readonly DeploymentTargetStatusV1[];
  readonly remote: ReturnType<typeof remoteProductionGate>;
  readonly github: ReturnType<typeof githubProtectionStatus>;
  readonly LOCAL_COMMIT_EQUALS_REMOTE_PUBLISHED: false;
  readonly CODING_CLIENT_CAN_DEPLOY: false;
  readonly LIVE_ADMISSION_CANDIDATE: string;
} {
  const includeDisk = options.includeDiskCatalog ?? true;
  const catchup = options.catchup ?? true;
  reconcileRegisteredWork({ includeDiskCatalog: includeDisk, catchup: false });
  const remote = remoteProductionGate();
  const bundles = collectRegisteredWork(includeDisk);
  const items: ClosedWorkItemV1[] = [];
  let catchupCount = 0;
  let staleFinalized = 0;
  const counts = {
    READY_FOR_ADMISSION: 0,
    WAITING_FOR_MACHINE_VERIFICATION: 0,
    WAITING_FOR_INTEGRATION: 0,
    WAITING_FOR_CANONICAL_COMMIT: 0,
    WAITING_FOR_PUBLISH: 0,
    WAITING_FOR_DEPLOYMENT: 0,
    WAITING_FOR_RUNTIME_VERIFY: 0,
    WAITING_FOR_OWNER_ENABLE: 0,
    BLOCKED_BY_FAILURE: 0,
    NOT_PRODUCTION_BOUND: 0,
    UNREGISTERED_ACTIVITY: 0,
  };
  const activity_counts: Record<string, number> = { ACTIVE: 0, WAITING: 0, STALE: 0, BLOCKED: 0, READY_FOR_ADMISSION: 0 };

  for (const bundle of bundles) {
    const rows = bundle.unregistered ? [] : deriveCheckpoints({
      work_id: bundle.work_id,
      subject: bundle.subject,
      pipe: bundle.pipe,
      submitted: bundle.submitted,
      activity: bundle.activity,
      reports: listOutputs().filter((row) => row.work_id === bundle.work_id && row.kind === "report").map((row) => row.output_id),
    });
    const admission = admissionReadiness(bundle.work_id, bundle.pipe);
    const stuck = bundle.unregistered ? "UNREGISTERED_AGENT_ACTIVITY" : (
      bundle.pipe?.state === "FAILED" ? "BLOCKED_BY_FAILURE"
        : (rows.find((row) => row.checkpoint_type === "INTEGRATED")?.state !== "VERIFIED" && bundle.pipe?.intent.production_intent ? "WAITING_FOR_INTEGRATION" : "NONE")
    );
    const existingCheckpoints = listProductionCheckpoints(bundle.work_id);
    const stuckFromCheckpoints = existingCheckpoints.find((row) => row.checkpoint_type === "RUNTIME_VERIFIED")?.state === "FAILED" ? "BLOCKED_BY_FAILURE" : stuck;
    const classification = classifyWork({
      unregistered: bundle.unregistered,
      pipe: bundle.pipe,
      admission,
      stuck: bundle.pipe?.state === "FAILED" ? "BLOCKED_BY_FAILURE" : (existingCheckpoints.length ? (
        existingCheckpoints.find((row) => row.state === "FAILED") ? "BLOCKED_BY_FAILURE"
          : (existingCheckpoints.find((row) => row.checkpoint_type === "REMOTE_PUBLISHED")?.state === "VERIFIED" && existingCheckpoints.find((row) => row.checkpoint_type === "DEPLOYED")?.state !== "VERIFIED" ? "WAITING_FOR_DEPLOYMENT"
            : (existingCheckpoints.find((row) => row.checkpoint_type === "DEPLOYED")?.state === "VERIFIED" && existingCheckpoints.find((row) => row.checkpoint_type === "RUNTIME_VERIFIED")?.state === "PENDING" ? "WAITING_FOR_RUNTIME_VERIFY"
              : (existingCheckpoints.find((row) => row.checkpoint_type === "INTEGRATED")?.state === "VERIFIED" && existingCheckpoints.find((row) => row.checkpoint_type === "REMOTE_PUBLISHED")?.state === "PENDING" ? "WAITING_FOR_PUBLISH"
                : stuckFromCheckpoints)))
      ) : stuck),
    });
    const existingFinal = listFinalizations().find((row) => row.work_id === bundle.work_id) ?? null;
    const activity = activityClass({
      classification,
      pipe: bundle.pipe,
      last_activity_at: bundle.submitted?.last_activity_at ?? bundle.pipe?.updated_at ?? "NOT_AVAILABLE",
      finalized: existingFinal?.finalized_as ?? null,
    });
    const finalized = finalizeIfStale(bundle.work_id, activity, bundle.pipe);
    if (finalized && !existingFinal) staleFinalized += 1;
    const lineage = closeSourceLineage(bundle.pipe, bundle.work_id);
    const lastVerified = [...existingCheckpoints].reverse().find((row) => row.state === "VERIFIED")?.checkpoint_type
      ?? (bundle.pipe?.state === "IN_DEVELOPMENT" ? "IMPLEMENTING" : "NOT_AVAILABLE");
    let current: string = existingCheckpoints.find((row) => row.state === "FAILED")?.checkpoint_type
      ?? existingCheckpoints.find((row) => row.state === "PENDING" || row.state === "ACTIVE")?.checkpoint_type
      ?? bundle.pipe?.state
      ?? "NOT_AVAILABLE";
    if (bundle.pipe?.state === "FAILED" && (bundle.pipe.evidence as { kind?: string }).kind === "RUNTIME") current = "RUNTIME_VERIFIED";
    if (classification === "WAITING_FOR_DEPLOYMENT") current = "DEPLOYED";
    if (classification === "WAITING_FOR_PUBLISH") current = "REMOTE_PUBLISHED";
    const item: ClosedWorkItemV1 = {
      work_id: bundle.work_id,
      subject: bundle.subject,
      STATE_CLASSIFICATION: classification,
      activity_class: finalized ? (finalized.finalized_as === "BLOCKED" ? "BLOCKED" : "STALE") : activity,
      CURRENT_CHECKPOINT: String(current),
      LAST_VERIFIED_CHECKPOINT: String(lastVerified),
      LINEAGE_STATUS: lineage.LINEAGE_STATUS,
      OWNER_ATTENTION: classification === "BLOCKED_BY_FAILURE" || classification === "READY_FOR_ADMISSION" || classification === "WAITING_FOR_OWNER_ENABLE",
      finalized_as: finalized?.finalized_as ?? null,
    };
    items.push(item);
    counts[classification] += 1;
    activity_counts[item.activity_class] = (activity_counts[item.activity_class] ?? 0) + 1;
    if (catchup) {
      const kind = catchupKind(classification, remote);
      if (emitClosureCatchup(bundle.work_id, bundle.subject, classification, kind)) catchupCount += 1;
    }
  }

  const blockedItem = items.find((row) => row.STATE_CLASSIFICATION === "BLOCKED_BY_FAILURE");
  const blockedPipe = blockedItem ? bundles.find((row) => row.work_id === blockedItem.work_id)?.pipe ?? null : null;
  const blocked = blockedItem ? {
    WORK_ID: blockedItem.work_id,
    BLOCKED_CHECKPOINT: blockedItem.CURRENT_CHECKPOINT,
    FAILURE_REASON: String(blockedPipe?.evidence.last_rule ?? blockedPipe?.state ?? "RUNTIME_VERIFICATION_FAILED"),
    LAST_GOOD_REVISION: na(blockedPipe?.previous_verified_revision ?? blockedPipe?.source_revision),
    OWNER_ACTION_REQUIRED: true,
    AUTO_REPAIR_ALLOWED: false as const,
  } : { WORK_ID: "NOT_AVAILABLE" as const };

  const productionItems = items.filter((row) => row.finalized_as === null && row.STATE_CLASSIFICATION !== "NOT_PRODUCTION_BOUND" && row.STATE_CLASSIFICATION !== "UNREGISTERED_ACTIVITY");
  const lineageFocus = bundles.find((row) => row.pipe?.intent.production_intent)?.pipe
    ?? bundles.find((row) => row.pipe)?.pipe
    ?? null;
  const lineage = lineageFocus ? closeSourceLineage(lineageFocus, lineageFocus.work_id) : (items[0] ? closeSourceLineage(null, items[0].work_id) : null);

  const readyList = items.filter((row) => row.STATE_CLASSIFICATION === "READY_FOR_ADMISSION" && row.finalized_as === null);
  const github = githubProtectionStatus();
  const targets = inspectDeploymentTargets();

  const latestCanonical = items.map((row, i) => closeSourceLineage(bundles[i]?.pipe ?? null, row.work_id)).filter((row) => isSha(row.canonical_revision));
  const pickLatest = (field: keyof SourceLineageClosureV1) => latestCanonical.at(-1)?.[field] ?? "NOT_AVAILABLE";

  const summary = {
    schema: OWNER_PRODUCTION_READINESS_SUMMARY,
    ready_for_admission_count: counts.READY_FOR_ADMISSION,
    canonical_integrated_count: items.filter((row) => ["WAITING_FOR_CANONICAL_COMMIT", "WAITING_FOR_PUBLISH", "WAITING_FOR_DEPLOYMENT", "WAITING_FOR_RUNTIME_VERIFY", "WAITING_FOR_OWNER_ENABLE"].includes(row.STATE_CLASSIFICATION)).length,
    remote_published_count: items.filter((row) => row.STATE_CLASSIFICATION === "WAITING_FOR_DEPLOYMENT" || row.STATE_CLASSIFICATION === "WAITING_FOR_RUNTIME_VERIFY").length,
    waiting_deployment_count: counts.WAITING_FOR_DEPLOYMENT,
    waiting_runtime_count: counts.WAITING_FOR_RUNTIME_VERIFY,
    blocked_count: counts.BLOCKED_BY_FAILURE,
    stale_count: activity_counts.STALE ?? 0,
    real_production_ready: remote.REMOTE_PRODUCTION_READY,
    local_fixture_only: remote.PRODUCTION_ENVIRONMENT === "LOCAL_FIXTURE",
    latest_canonical_revision: pickLatest("canonical_revision"),
    latest_remote_revision: pickLatest("remote_revision"),
    latest_deployment_revision: pickLatest("deployment_revision"),
    latest_runtime_revision: pickLatest("runtime_revision"),
    PRODUCTION_ENVIRONMENT: remote.PRODUCTION_ENVIRONMENT,
    running_after_finalization: productionItems.filter((row) => row.activity_class === "ACTIVE" || row.activity_class === "WAITING" || row.activity_class === "READY_FOR_ADMISSION").length,
  };

  void codingClientDeploy;
  return {
    schema: PRODUCTION_ADMISSION_AND_LINEAGE_CLOSURE,
    items,
    counts,
    activity_counts,
    catchup_notifications: catchupCount,
    stale_finalized: staleFinalized,
    summary,
    blocked,
    lineage,
    targets,
    remote,
    github,
    LOCAL_COMMIT_EQUALS_REMOTE_PUBLISHED: false,
    CODING_CLIENT_CAN_DEPLOY: false,
    LIVE_ADMISSION_CANDIDATE: readyList[0]?.work_id ?? "NOT_AVAILABLE",
  };
}

export function listAdmissionReadyWork(): readonly ClosedWorkItemV1[] {
  return closeRegisteredWork({ includeDiskCatalog: true, catchup: false }).items.filter((row) => row.STATE_CLASSIFICATION === "READY_FOR_ADMISSION");
}

export function ownerProductionReadinessSummary(): Record<string, unknown> {
  return closeRegisteredWork({ includeDiskCatalog: true, catchup: false }).summary;
}

export function getLineageClosureStatus(work_id?: string): SourceLineageClosureV1 | readonly SourceLineageClosureV1[] {
  const bundles = collectRegisteredWork(true);
  const rows = bundles.map((row) => closeSourceLineage(row.pipe, row.work_id));
  if (work_id) return rows.find((row) => row.work_id === work_id) ?? closeSourceLineage(null, work_id);
  return rows;
}

export function runtimeVerificationFor(work_id: string): { RUNTIME_VERIFIED: boolean; result: string; expected: string; actual: string | null } {
  const rt = verifyRuntime(work_id);
  return { RUNTIME_VERIFIED: rt.result === "RUNTIME_VERIFIED", result: rt.result, expected: rt.expected, actual: rt.actual };
}

export function capabilityCompletion(pipe: PipelineRecordV1 | null): { CAPABILITY_VERIFIED: boolean; CAPABILITY_AVAILABLE: boolean } {
  const verified = Boolean(pipe?.capability_id) && pipe?.runtime_verified === true;
  return { CAPABILITY_VERIFIED: verified, CAPABILITY_AVAILABLE: verified && pipe?.owner_enabled === true };
}
