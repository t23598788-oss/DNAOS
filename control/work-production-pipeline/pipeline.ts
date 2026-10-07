/**
 * DNA_OS_WORK_PRODUCTION_PIPELINE_V1 — production coordinator, not a coding agent.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { emitLocalResourceEvent, invokeLocalCapability, type InvokeLocalCapabilityResult } from "../local-resource-access/contract";
import { createResourceHandle } from "../owner-client-runtime/handles";
import { upsertWorkContext } from "../owner-client-runtime/work-context";
import { classifyDisposablePath } from "../source-workspace/contract";
import { git, initBareRemote } from "./git-fixture";
import { nowIso, repoRoot } from "./host-runtime";
import {
  listDeployments,
  listNotifications,
  listPipelines,
  listProducedCapabilities,
  listVerifications,
  persistCapability,
  persistDeployment,
  persistNotification,
  persistPipeline,
  persistVerification,
} from "./persist";
import type {
  AffectClass,
  ArtifactState,
  CleanupOutcomeStatus,
  DeterministicCodeWorkOrderV1,
  GateDecision,
  OwnerDevelopmentIntentV1,
  PipelineRecordV1,
  PromotionRemoteState,
  RiskClass,
  RuntimeVerifyResult,
} from "./types";
import { ARTIFACT_STATES, MEANINGFUL_NOTIFICATIONS, PIPELINE_SCHEMA } from "./types";

const LINEAR: readonly ArtifactState[] = [
  "REQUESTED", "CONTEXT_RESOLVED", "AUTHORIZED_FOR_DEVELOPMENT", "IN_DEVELOPMENT", "AUTHORED",
  "ASSEMBLED", "BUILD_VERIFIED", "TEST_VERIFIED", "INTEGRATION_VERIFIED", "REVIEW_READY",
  "APPROVED_FOR_PUBLISH", "PUBLISHED", "PROMOTION_READY", "DEPLOYMENT_READY", "DEPLOYED",
  "RUNTIME_VERIFYING", "RUNTIME_VERIFIED", "CAPABILITY_REGISTERED", "ACTIVE",
];

const ANY_TO_HOLD = new Set<ArtifactState>(["BLOCKED", "BLOCKED_INCOMPLETE", "FAILED", "ROLLED_BACK", "RETIRED"]);

const VERIFICATION_REGISTRY = {
  schema: "CODE_VERIFICATION_REGISTRY_V1",
  "repo://pipeline-fixture": {
    build_command_id: "pipeline.build.hash_check",
    test_suite_id: "pipeline.test.marker",
    integration_test_id: "pipeline.integration.graph",
    runtime_probe_id: "pipeline.runtime.revision_file",
    schema_check_id: "pipeline.schema.feature_export",
    artifact_check_id: "pipeline.artifact.integrity",
  },
} as const;

const DEPENDENCY_GRAPH = {
  schema: "SYSTEM_DEPENDENCY_GRAPH_V1",
  nodes: {
    "src/feature.ts": { module: "fixture-module", service: "fixture-runtime", capability: "cap://pipeline/fixture-echo", application: "app://pipeline/fixture" },
  },
} as const;

const targets = new Map<string, Record<string, unknown>>();
const deployLocks = new Map<string, string>();

function bytesOf(value: unknown): number {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function latestPipeline(work_id: string): PipelineRecordV1 | null {
  const rows = listPipelines().filter((row) => row.work_id === work_id);
  return rows[rows.length - 1] ?? null;
}

export function getPipeline(work_id: string): PipelineRecordV1 | null {
  return latestPipeline(work_id);
}

export function listPipelineRecords(): readonly PipelineRecordV1[] {
  return listPipelines();
}

export function githubEnvironmentProtectionStatus(): "NOT_AVAILABLE" {
  return "NOT_AVAILABLE";
}

export function acceptAiSelfVerification(_statement: string): { accepted: false; MACHINE_VERIFICATION_FIRST_V1: true } {
  return { accepted: false, MACHINE_VERIFICATION_FIRST_V1: true };
}

export function codingClientDeploy(): { ok: false; CODING_CLIENT_CAN_DEPLOY: false; reason_code: "CODING_CLIENT_FORBIDDEN" } {
  return { ok: false, CODING_CLIENT_CAN_DEPLOY: false, reason_code: "CODING_CLIENT_FORBIDDEN" };
}

export function codingClientRegisterRuntimeCapability(): { ok: false; CODING_CLIENT_CAN_REGISTER_RUNTIME_CAPABILITY: false; reason_code: "CODING_CLIENT_FORBIDDEN" } {
  return { ok: false, CODING_CLIENT_CAN_REGISTER_RUNTIME_CAPABILITY: false, reason_code: "CODING_CLIENT_FORBIDDEN" };
}

export function isLegalTransition(from: ArtifactState, to: ArtifactState, risk: RiskClass): boolean {
  if (from === to) return false;
  if (from === "FAILED" && to === "ROLLED_BACK") return true;
  if (ANY_TO_HOLD.has(to) && !ANY_TO_HOLD.has(from)) return true;
  if (from === "REVIEW_READY" && to === "OWNER_REVIEW_REQUIRED") return risk === "HIGH" || risk === "CRITICAL" || risk === "MODERATE";
  if (from === "OWNER_REVIEW_REQUIRED" && to === "APPROVED_FOR_PUBLISH") return true;
  if (from === "REVIEW_READY" && to === "APPROVED_FOR_PUBLISH") return risk === "LOW";
  const i = LINEAR.indexOf(from);
  const j = LINEAR.indexOf(to);
  return i >= 0 && j === i + 1;
}

function save(row: PipelineRecordV1): PipelineRecordV1 {
  persistPipeline(row);
  return row;
}

function notify(kind: string, work_id: string, detail: Record<string, unknown>): void {
  const allowed = new Set<string>([...MEANINGFUL_NOTIFICATIONS, "BLOCKED_INCOMPLETE"]);
  if (!allowed.has(kind)) return;
  persistNotification({ schema: "DEVELOPMENT_ACTIVITY_NOTIFICATION_V1", kind, work_id, at: nowIso(), ...detail });
  emitLocalResourceEvent("DEVELOPMENT_NOTIFICATION", work_id, kind, undefined, { locality: "LOCAL", action: kind });
}

function apply(row: PipelineRecordV1, to: ArtifactState, rule: string, evidence: Record<string, unknown>, authority: string): PipelineRecordV1 {
  if (!isLegalTransition(row.state, to, row.risk_class)) {
    return save({
      ...row,
      state: "BLOCKED",
      evidence: { ...row.evidence, skip_attempt: { from: row.state, to, rule } },
      updated_at: nowIso(),
    });
  }
  const next: PipelineRecordV1 = {
    ...row,
    state: to,
    missing: to === "BLOCKED_INCOMPLETE" ? row.missing : [],
    evidence: { ...row.evidence, ...evidence, last_rule: rule },
    transitions: [...row.transitions, {
      from_state: row.state, to_state: to, transition_rule: rule, evidence, authority, timestamp: nowIso(),
    }],
    updated_at: nowIso(),
  };
  emitLocalResourceEvent("PRODUCTION_STATE_TRANSITION", row.work_id, `${row.state}->${to}`, undefined, {
    locality: "LOCAL", action: rule,
  });
  if (to === "REVIEW_READY" || to === "DEPLOYED" || to === "RUNTIME_VERIFIED" || to === "CAPABILITY_REGISTERED") {
    notify(to, row.work_id, { state: to });
  }
  if (to === "OWNER_REVIEW_REQUIRED") notify("OWNER_APPROVAL_REQUIRED", row.work_id, { state: to });
  if (to === "FAILED") {
    const kind = String(evidence.kind ?? "");
    if (kind.includes("BUILD")) notify("BUILD_FAILED", row.work_id, evidence);
    if (kind.includes("TEST")) notify("TEST_FAILED", row.work_id, evidence);
    if (kind.includes("DEPLOY")) notify("DEPLOYMENT_FAILED", row.work_id, evidence);
    if (kind.includes("RUNTIME")) notify("RUNTIME_VERIFICATION_FAILED", row.work_id, evidence);
  }
  return save(next);
}

export function attemptTransition(work_id: string, to: ArtifactState): { ok: boolean; STATE_SKIPPING_ALLOWED: false; record: PipelineRecordV1 | null } {
  const row = latestPipeline(work_id);
  if (!row) return { ok: false, STATE_SKIPPING_ALLOWED: false, record: null };
  const legal = isLegalTransition(row.state, to, row.risk_class);
  if (!legal) return { ok: false, STATE_SKIPPING_ALLOWED: false, record: row };
  return { ok: true, STATE_SKIPPING_ALLOWED: false, record: apply(row, to, "explicit", {}, "OWNER") };
}

export function classifyAffect(path: string): AffectClass {
  if (path in DEPENDENCY_GRAPH.nodes) return "DIRECTLY_AFFECTED";
  if (path.startsWith("src/")) return "TRANSITIVELY_AFFECTED";
  if (path.includes("unknown") || path.includes("UNMAPPED")) return "UNKNOWN";
  return "UNAFFECTED";
}

export function registerDeploymentTarget(input: {
  readonly target_id: string;
  readonly environment: string;
  readonly provider: string;
  readonly application: string;
  readonly deployment_method: string;
  readonly source_repository: string;
  readonly required_artifact: string;
  readonly health_probe: string;
  readonly rollback_method: string;
  readonly authority_policy: string;
  readonly secret_reference_policy: string;
  readonly runtime_identity: string;
  readonly status: string;
  readonly runtime_dir: string;
  readonly provider_resource_id?: string;
  readonly target_type?: string;
  readonly repository_binding?: string;
  readonly owner_enabled?: boolean;
  readonly mutation_capability?: string;
  readonly evidence_refs?: readonly string[];
  readonly authentication_ready?: boolean;
}): Record<string, unknown> {
  const row = { schema: "DEPLOYMENT_TARGET_REGISTRY_V1", ...input };
  targets.set(input.target_id, row);
  persistDeployment({ record_type: "TARGET", ...row });
  return row;
}

export function getDeploymentTarget(target_id: string): Record<string, unknown> | null {
  if (targets.has(target_id)) return targets.get(target_id) ?? null;
  const rows = listDeployments<Record<string, unknown>>().filter((row) => row.record_type === "TARGET" && row.target_id === target_id);
  return rows[rows.length - 1] ?? null;
}

export function listRegisteredDeploymentTargets(): readonly Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of listDeployments<Record<string, unknown>>()) {
    if (row.record_type === "TARGET") map.set(String(row.target_id), row);
  }
  for (const [id, row] of targets) map.set(id, row);
  return [...map.values()];
}

function normalizeIntent(input: {
  readonly work_id?: string;
  readonly owner_goal: string;
  readonly requested_change: string;
  readonly risk_class?: RiskClass;
  readonly production_intent?: boolean;
  readonly deployment_target?: string | null;
  readonly target_repository?: string;
  readonly workspace_root: string;
}): OwnerDevelopmentIntentV1 {
  return {
    schema: "OWNER_DEVELOPMENT_INTENT_V1",
    intent_id: `intent-${randomUUID()}`,
    work_id: input.work_id ?? `work-pipe-${randomUUID()}`,
    owner_goal: input.owner_goal,
    requested_change: input.requested_change,
    target_domain: "code",
    target_system: "dna-os-fixture",
    target_repository: input.target_repository ?? "repo://pipeline-fixture",
    known_resources: ["resource://local/files/fixture-corpus"],
    known_capabilities: ["local.files.search"],
    affected_components: ["src/feature.ts"],
    risk_class: input.risk_class ?? "LOW",
    required_evidence: ["build", "test", "hash"],
    acceptance_criteria: ["FEATURE_MARKER updated", "machine verification"],
    production_intent: input.production_intent ?? false,
    deployment_target: input.deployment_target ?? null,
    authority_requirements: ["OWNER_LANE_DEVELOPMENT"],
  };
}

function buildWorkOrder(intent: OwnerDevelopmentIntentV1, base_revision: string): DeterministicCodeWorkOrderV1 {
  return {
    schema: "DETERMINISTIC_CODE_WORK_ORDER_V1",
    work_order_id: `wo-${randomUUID()}`,
    work_id: intent.work_id,
    goal: intent.owner_goal,
    repository_id: intent.target_repository,
    base_revision,
    target_components: intent.affected_components,
    target_files: ["src/feature.ts"],
    allowed_paths: ["src/feature.ts"],
    forbidden_paths: [".git", "control/engineering-runtime"],
    related_interfaces: ["FEATURE_MARKER"],
    related_schemas: ["OWNER_DEVELOPMENT_INTENT_V1"],
    dependencies: ["fixture-module"],
    required_tests: ["pipeline.test.marker"],
    required_builds: ["pipeline.build.hash_check"],
    acceptance_criteria: intent.acceptance_criteria,
    expected_outputs: [intent.requested_change],
    side_effect_policy: "SCOPED_WRITE_ONLY",
    production_policy: intent.risk_class,
    evidence_requirements: intent.required_evidence,
    discovery_required: false,
  };
}

export function resolveLocalCodeContext(work_order: DeterministicCodeWorkOrderV1, workspace_root: string): {
  schema: "LOCAL_CODE_CONTEXT_RESOLVER_V1";
  relevant_files: readonly string[];
  relevant_symbols: readonly string[];
  related_tests: readonly string[];
  affected_modules: readonly string[];
  affected_runtime_capabilities: readonly string[];
  known_dependency_edges: readonly string[];
  handles: readonly string[];
  LOCAL_CONTEXT_BYTES: number;
  AI_CONTEXT_BYTES: number;
  AI_REPOSITORY_WIDE_SEARCH_REQUIRED: false;
} {
  const file = join(workspace_root, work_order.target_files[0] ?? "src/feature.ts");
  const source = existsSync(file) ? readFileSync(file, "utf8") : "";
  const handle = createResourceHandle({
    resource_id: "resource://local/files/fixture-corpus",
    logical_path: "notes.txt",
    work_id: work_order.work_id,
    owner_authority: "ALLOW",
    allowed_operations: ["READ"],
  });
  const local = bytesOf({ files: work_order.target_files, source, graph: DEPENDENCY_GRAPH.nodes["src/feature.ts"] });
  return {
    schema: "LOCAL_CODE_CONTEXT_RESOLVER_V1",
    relevant_files: work_order.target_files,
    relevant_symbols: ["FEATURE_MARKER"],
    related_tests: work_order.required_tests,
    affected_modules: ["fixture-module"],
    affected_runtime_capabilities: ["cap://pipeline/fixture-echo"],
    known_dependency_edges: ["src/feature.ts->fixture-module"],
    handles: [handle.resource_handle],
    LOCAL_CONTEXT_BYTES: local,
    AI_CONTEXT_BYTES: bytesOf({ goal: work_order.goal, files: work_order.target_files, symbols: ["FEATURE_MARKER"] }),
    AI_REPOSITORY_WIDE_SEARCH_REQUIRED: false,
  };
}

export function submitOwnerDevelopmentIntent(input: {
  readonly owner_goal: string;
  readonly requested_change: string;
  readonly risk_class?: RiskClass;
  readonly production_intent?: boolean;
  readonly deployment_target?: string | null;
  readonly workspace_root: string;
  readonly canonical_root: string;
  readonly disposable_root: string;
  readonly remote_root?: string | null;
  readonly work_id?: string;
  readonly omit_required?: readonly string[];
}): PipelineRecordV1 {
  const intent = normalizeIntent(input);
  let base = "UNCOMMITTED";
  try { base = git(input.workspace_root, ["rev-parse", "HEAD"]); } catch { /* new workspace */ }
  const work_order = buildWorkOrder(intent, base);
  const omitted = new Set(input.omit_required ?? []);
  const missing: string[] = [];
  if (omitted.has("test")) missing.push("MISSING_TEST");
  if (omitted.has("context")) missing.push("MISSING_CONTEXT");
  if (omitted.has("dependency")) missing.push("MISSING_DEPENDENCY");
  if (omitted.has("authority")) missing.push("MISSING_AUTHORITY");
  if (omitted.has("deployment_target")) missing.push("MISSING_DEPLOYMENT_TARGET");
  if (omitted.has("runtime_proof")) missing.push("MISSING_RUNTIME_PROOF");
  const ctx = omitted.has("context") ? null : resolveLocalCodeContext(work_order, input.workspace_root);
  upsertWorkContext({
    schema: "WORK_CONTEXT_V1",
    work_id: intent.work_id,
    goal: intent.owner_goal,
    canonical_actions: ["DEVELOP"],
    resource_handles: ctx?.handles ?? [],
    completed_steps: [],
    open_steps: ["DEVELOPMENT_LANE"],
    structured_results: { lane: "DEVELOPMENT_LANE" },
    evidence_refs: [],
    owner_decisions: [],
    approved_ai_context: { work_order_id: work_order.work_order_id },
    byte_counts: {
      source_bytes: ctx?.LOCAL_CONTEXT_BYTES ?? 0,
      local_bytes_processed: ctx?.LOCAL_CONTEXT_BYTES ?? 0,
      ai_context_bytes_sent: ctx?.AI_CONTEXT_BYTES ?? 0,
      ai_result_bytes: 0,
    },
    transcript_included: false,
  });
  const row: PipelineRecordV1 = {
    schema: PIPELINE_SCHEMA,
    work_id: intent.work_id,
    lane: "DEVELOPMENT_LANE",
    intent,
    work_order,
    state: "REQUESTED",
    risk_class: intent.risk_class,
    source_revision: base,
    remote_sha: null,
    promotion: "LOCAL_ONLY",
    artifact_id: null,
    deployment_id: null,
    capability_id: null,
    previous_verified_revision: null,
    owner_enabled: false,
    runtime_verified: false,
    missing,
    evidence: {
      workspace_root: input.workspace_root,
      canonical_root: input.canonical_root,
      disposable_root: input.disposable_root,
      remote_root: input.remote_root ?? null,
      context: ctx,
      DEVELOPMENT_ARTIFACT_EQUALS_RUNTIME_CAPABILITY: false,
    },
    metrics: {
      SOURCE_BYTES: ctx?.LOCAL_CONTEXT_BYTES ?? 0,
      LOCAL_BYTES_PROCESSED: ctx?.LOCAL_CONTEXT_BYTES ?? 0,
      LOCAL_CONTEXT_BYTES: ctx?.LOCAL_CONTEXT_BYTES ?? 0,
      AI_CONTEXT_BYTES_SENT: ctx?.AI_CONTEXT_BYTES ?? 0,
      AI_RESULT_BYTES: 0,
      BUILD_BYTES: 0,
      ARTIFACT_BYTES: 0,
      REMOTE_BYTES_PUBLISHED: 0,
      DEPLOYMENT_BYTES: 0,
      RESULT_BYTES: 0,
    },
    transitions: [],
    lineage: {
      schema: "END_TO_END_WORK_LINEAGE_V1",
      intent_id: intent.intent_id,
      work_id: intent.work_id,
      work_order_id: work_order.work_order_id,
      development_workspace: input.workspace_root,
    },
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  return save(row);
}

function workspaceOf(row: PipelineRecordV1): string {
  return String(row.evidence.workspace_root);
}

function implementScoped(row: PipelineRecordV1): { ok: boolean; bytes: number; hash: string } {
  const file = join(workspaceOf(row), "src/feature.ts");
  if (!row.work_order.allowed_paths.includes("src/feature.ts")) return { ok: false, bytes: 0, hash: "" };
  const marker = row.work_order.expected_outputs[0] ?? "FEATURE";
  const body = `export const FEATURE_MARKER = ${JSON.stringify(marker)};\n`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body, "utf8");
  return { ok: true, bytes: bytesOf(body), hash: createHash("sha256").update(body).digest("hex") };
}

function runRegisteredVerification(row: PipelineRecordV1, test_id: string): Record<string, unknown> {
  const started = Date.now();
  const file = join(workspaceOf(row), "src/feature.ts");
  const body = existsSync(file) ? readFileSync(file, "utf8") : "";
  const hash = createHash("sha256").update(body).digest("hex");
  let status: "PASS" | "FAIL" = "FAIL";
  if (test_id === "pipeline.build.hash_check") status = body.includes("FEATURE_MARKER") && existsSync(file) ? "PASS" : "FAIL";
  else if (test_id === "pipeline.test.marker") {
    const want = row.work_order.expected_outputs[0] ?? "";
    status = body.includes(JSON.stringify(want)) ? "PASS" : "FAIL";
  } else if (test_id === "pipeline.integration.graph") {
    status = classifyAffect("src/feature.ts") === "DIRECTLY_AFFECTED" && body.includes("FEATURE_MARKER") ? "PASS" : "FAIL";
  } else if (test_id === "pipeline.schema.feature_export") {
    status = /^export const FEATURE_MARKER/.test(body) ? "PASS" : "FAIL";
  }
  const rec = {
    schema: "CODE_VERIFICATION_REGISTRY_V1",
    verification_id: `ver-${randomUUID()}`,
    work_id: row.work_id,
    revision: row.source_revision,
    test_id,
    status,
    exit_code: status === "PASS" ? 0 : 1,
    duration: Date.now() - started,
    evidence_ref: `hash:${hash}`,
    MACHINE_DERIVED: true,
    AI_SELF_VERIFICATION_ACCEPTED: false,
  };
  persistVerification(rec);
  return rec;
}

function assembleArtifact(row: PipelineRecordV1): Record<string, unknown> {
  const body = readFileSync(join(workspaceOf(row), "src/feature.ts"));
  const source_hash = createHash("sha256").update(body).digest("hex");
  return {
    schema: "PRODUCTION_ARTIFACT_V1",
    artifact_id: `art-${randomUUID()}`,
    work_id: row.work_id,
    source_revision: row.source_revision,
    source_hash,
    included_components: ["src/feature.ts"],
    build_result: row.evidence.build,
    test_results: row.evidence.test,
    configuration_refs: ["repo://pipeline-fixture"],
    deployment_manifest: { target: row.intent.deployment_target },
    target_environment: row.intent.deployment_target,
    capabilities_produced: ["cap://pipeline/fixture-echo"],
    rollback_ref: row.previous_verified_revision,
    evidence_bundle: { hash: source_hash },
    SOURCE_FILES_ARE_NOT_DEPLOYABLE_PROOF: true,
  };
}

export function productionGate(row: PipelineRecordV1): { schema: "EXTERNAL_PRODUCTION_GATE_V1"; decision: GateDecision; reproducible: true } {
  if (row.missing.length > 0 || row.state === "BLOCKED_INCOMPLETE") {
    return { schema: "EXTERNAL_PRODUCTION_GATE_V1", decision: "BLOCKED", reproducible: true };
  }
  if ((row.risk_class === "HIGH" || row.risk_class === "CRITICAL")
    && row.state !== "APPROVED_FOR_PUBLISH" && row.state !== "PUBLISHED" && row.state !== "PROMOTION_READY") {
    return { schema: "EXTERNAL_PRODUCTION_GATE_V1", decision: "OWNER_APPROVAL_REQUIRED", reproducible: true };
  }
  const build = listVerifications<Record<string, unknown>>().filter((v) => v.work_id === row.work_id && v.test_id === "pipeline.build.hash_check").at(-1);
  const test = listVerifications<Record<string, unknown>>().filter((v) => v.work_id === row.work_id && v.test_id === "pipeline.test.marker").at(-1);
  if (build?.status !== "PASS" || test?.status !== "PASS") {
    return { schema: "EXTERNAL_PRODUCTION_GATE_V1", decision: "NOT_READY", reproducible: true };
  }
  if (!row.intent.deployment_target && row.intent.production_intent) {
    return { schema: "EXTERNAL_PRODUCTION_GATE_V1", decision: "BLOCKED", reproducible: true };
  }
  return { schema: "EXTERNAL_PRODUCTION_GATE_V1", decision: "READY", reproducible: true };
}

function promoteRemote(row: PipelineRecordV1): PipelineRecordV1 {
  const workspace = workspaceOf(row);
  const remote = String(row.evidence.remote_root ?? "");
  git(workspace, ["add", "src/feature.ts"]);
  try { git(workspace, ["commit", "-m", `pipeline ${row.work_id}`]); } catch { /* nothing to commit */ }
  const sha = git(workspace, ["rev-parse", "HEAD"]);
  let promotion: PromotionRemoteState = "INTEGRATED";
  let remote_sha: string | null = null;
  let published = 0;
  if (remote && existsSync(remote)) {
    try { git(workspace, ["remote", "remove", "origin"]); } catch { /* none */ }
    git(workspace, ["remote", "add", "origin", remote]);
    try {
      git(workspace, ["push", "-u", "origin", "HEAD"]);
      promotion = "PUBLISHED_REMOTE";
      try {
        remote_sha = git(remote, ["log", "-1", "--format=%H"]);
      } catch {
        remote_sha = git(workspace, ["rev-parse", "HEAD"]);
      }
      if (remote_sha === sha) promotion = "REMOTE_VERIFIED";
    } catch {
      promotion = "INTEGRATED";
    }
    published = bytesOf(readFileSync(join(workspace, "src/feature.ts")));
  }
  return save({
    ...row,
    source_revision: sha,
    remote_sha,
    promotion,
    metrics: { ...row.metrics, REMOTE_BYTES_PUBLISHED: published },
    lineage: { ...row.lineage, commit: sha, remote_revision: remote_sha },
    evidence: { ...row.evidence, promotion: { sha, remote_sha, GITHUB_ENV_PROTECTION: githubEnvironmentProtectionStatus() } },
    updated_at: nowIso(),
  });
}

export function cleanupDisposableWorkspace(work_id: string): { outcome: CleanupOutcomeStatus; reason: string } {
  const row = latestPipeline(work_id);
  if (!row) return { outcome: "BLOCKED", reason: "unknown work" };
  const disposable = String(row.evidence.disposable_root);
  const canonical = resolve(String(row.evidence.canonical_root));
  if (resolve(disposable) === canonical || resolve(disposable) === repoRoot()) {
    return { outcome: "BLOCKED", reason: "refuses canonical/repository_root" };
  }
  if (!classifyDisposablePath(disposable)) {
    return { outcome: "BLOCKED", reason: "path is not a registered disposable isolation directory" };
  }
  if (row.promotion !== "REMOTE_VERIFIED") {
    return { outcome: "BLOCKED", reason: "REMOTE_VERIFIED required before CLEANED" };
  }
  if (row.missing.length > 0) return { outcome: "BLOCKED", reason: "unresolved work" };
  if (!existsSync(canonical)) return { outcome: "RETAINED_REQUIRED", reason: "canonical missing — retain disposable" };
  rmSync(disposable, { recursive: true, force: true });
  save({ ...row, evidence: { ...row.evidence, cleanup: "CLEANED" }, updated_at: nowIso() });
  return { outcome: "CLEANED", reason: "remote verified and evidence persisted" };
}

function runtimeDir(target_id: string): string {
  const t = getDeploymentTarget(target_id);
  return String(t?.runtime_dir ?? join(repoRoot(), "control/work-production-pipeline/data/runtime", target_id.replaceAll("/", "_")));
}

export function writeRuntimeRevision(target_id: string, revision: string, healthy: boolean): void {
  const dir = runtimeDir(target_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "revision.txt"), revision, "utf8");
  writeFileSync(join(dir, "health.txt"), healthy ? "OK" : "FAIL", "utf8");
}

export function verifyRuntime(work_id: string): { result: RuntimeVerifyResult; expected: string; actual: string | null } {
  const row = latestPipeline(work_id);
  if (!row?.intent.deployment_target) return { result: "UNKNOWN", expected: "", actual: null };
  const dir = runtimeDir(row.intent.deployment_target);
  const expected = row.source_revision ?? "";
  const actual = existsSync(join(dir, "revision.txt")) ? readFileSync(join(dir, "revision.txt"), "utf8").trim() : null;
  const health = existsSync(join(dir, "health.txt")) ? readFileSync(join(dir, "health.txt"), "utf8").trim() : "FAIL";
  if (!actual) return { result: "UNKNOWN", expected, actual };
  if (actual !== expected) return { result: "FAILED", expected, actual };
  if (health !== "OK") return { result: "FAILED", expected, actual };
  return { result: "RUNTIME_VERIFIED", expected, actual };
}

function deployFixture(row: PipelineRecordV1, healthy: boolean): { ok: boolean; deployment_id: string; reason?: string; previous?: string | null } {
  const target_id = row.intent.deployment_target;
  if (!target_id) return { ok: false, deployment_id: "", reason: "MISSING_DEPLOYMENT_TARGET" };
  if (!getDeploymentTarget(target_id)) return { ok: false, deployment_id: "", reason: "UNREGISTERED_TARGET" };
  const lock = deployLocks.get(target_id);
  if (lock && lock !== row.work_id) {
    return { ok: false, deployment_id: "", reason: "DEPLOYMENT_CONFLICT" };
  }
  deployLocks.set(target_id, row.work_id);
  const deployment_id = `dep-${randomUUID()}`;
  const prevPath = join(runtimeDir(target_id), "revision.txt");
  const previous = existsSync(prevPath) ? readFileSync(prevPath, "utf8").trim() : row.previous_verified_revision;
  writeRuntimeRevision(target_id, row.source_revision ?? "unknown", healthy);
  persistDeployment({
    schema: "PRODUCTION_DEPLOYMENT_V1",
    record_type: "DEPLOY",
    deployment_id,
    work_id: row.work_id,
    target_id,
    state: "DEPLOYED",
    previous_verified_revision: previous,
    rollback_action: "restore_revision_file",
    rollback_authority: "POLICY_DETERMINISTIC",
    expected_revision: row.source_revision,
  });
  return { ok: true, deployment_id, previous };
}

export function rollbackProduction(work_id: string): PipelineRecordV1 | null {
  const row = latestPipeline(work_id);
  if (!row) return null;
  const target_id = row.intent.deployment_target;
  if (target_id && row.previous_verified_revision) writeRuntimeRevision(target_id, row.previous_verified_revision, true);
  if (target_id) deployLocks.delete(target_id);
  notify("ROLLBACK_OCCURRED", work_id, { previous: row.previous_verified_revision });
  emitLocalResourceEvent("PRODUCTION_ROLLBACK", work_id, row.previous_verified_revision ?? "none", undefined, { locality: "LOCAL", action: "ROLLBACK" });
  return apply({ ...row, capability_id: null, runtime_verified: false, owner_enabled: false }, "ROLLED_BACK", "PRODUCTION_ROLLBACK_V1", {
    previous_verified_revision: row.previous_verified_revision, rollback_action: "restore_revision_file", rollback_authority: "POLICY_DETERMINISTIC",
  }, "PIPELINE");
}

function registerProduced(row: PipelineRecordV1): PipelineRecordV1 {
  const capability_id = `cap://pipeline/fixture-echo/${row.work_id}`;
  persistCapability({
    schema: "PRODUCED_CAPABILITY_REGISTRATION_V1",
    capability_id,
    produced_by_work_id: row.work_id,
    source_revision: row.source_revision,
    runtime_target: row.intent.deployment_target,
    canonical_action: "local.files.search",
    input_contract: { query: "string" },
    output_contract: { matches: "array" },
    authority_policy: "OWNER_GRANT",
    side_effect_class: "READ",
    runtime_verified: true,
    owner_enabled: false,
    NEW_CAPABILITY_DEFAULT_OWNER_ENABLED: false,
  });
  emitLocalResourceEvent("PRODUCED_CAPABILITY_REGISTERED", row.work_id, capability_id, undefined, { locality: "LOCAL" });
  return save({
    ...row,
    capability_id,
    owner_enabled: false,
    lineage: { ...row.lineage, capability_id, deployment_id: row.deployment_id, runtime_revision: row.source_revision, artifact_id: row.artifact_id },
    updated_at: nowIso(),
  });
}

export function ownerEnableProducedCapability(work_id: string, explicit_owner_policy: true): PipelineRecordV1 | null {
  const row = latestPipeline(work_id);
  if (!row?.capability_id || !explicit_owner_policy) return row;
  persistCapability({ capability_id: row.capability_id, owner_enabled: true, runtime_verified: true, work_id });
  return save({ ...row, owner_enabled: true, updated_at: nowIso() });
}

export async function operationalInvokeProduced(input: {
  readonly work_id: string;
  readonly ai_client_id: string;
  readonly session_id: string;
  readonly resource_id?: string;
}): Promise<InvokeLocalCapabilityResult | {
  readonly ok: false;
  readonly reason_code: string;
  readonly DEV_STATE_CANNOT_BYPASS_CAPABILITY_REGISTRATION?: true;
  readonly state?: ArtifactState;
  readonly owner_enabled?: boolean;
  readonly runtime_verified?: boolean;
}> {
  const row = latestPipeline(input.work_id);
  if (!row) return { ok: false, reason_code: "UNKNOWN_WORK", DEV_STATE_CANNOT_BYPASS_CAPABILITY_REGISTRATION: true };
  const allowedStates: ArtifactState[] = ["CAPABILITY_REGISTERED", "ACTIVE"];
  if (!allowedStates.includes(row.state) || !row.capability_id) {
    return { ok: false, reason_code: "OPERATIONAL_CHAT_CANNOT_USE_DEV_ARTIFACT", DEV_STATE_CANNOT_BYPASS_CAPABILITY_REGISTRATION: true, state: row.state };
  }
  if (!row.runtime_verified || !row.owner_enabled) {
    return { ok: false, reason_code: "CAPABILITY_NOT_OWNER_ENABLED_OR_UNVERIFIED", owner_enabled: row.owner_enabled, runtime_verified: row.runtime_verified };
  }
  return invokeLocalCapability({
    ai_client_id: input.ai_client_id,
    session_id: input.session_id,
    work_id: input.work_id,
    capability: "local.files.search",
    resource_id: input.resource_id ?? "resource://local/files/fixture-corpus",
    input: { query: "fixture", max_matches: 3 },
  });
}

function blockIncomplete(row: PipelineRecordV1): PipelineRecordV1 {
  persistNotification({ schema: "DEVELOPMENT_ACTIVITY_NOTIFICATION_V1", kind: "BLOCKED_INCOMPLETE", work_id: row.work_id, at: nowIso(), missing: row.missing });
  emitLocalResourceEvent("PRODUCTION_BLOCKED_INCOMPLETE", row.work_id, row.missing.join(","), undefined, { locality: "LOCAL" });
  return apply(row, "BLOCKED_INCOMPLETE", "INCOMPLETE_WORK_BLOCKING_V1", { missing: row.missing, INCOMPLETE_DATA_AUTO_PROMOTED: false }, "PIPELINE");
}

export function markRuntimeUnhealthyForFixture(work_id: string): void {
  const row = latestPipeline(work_id);
  if (!row?.intent.deployment_target) return;
  writeRuntimeRevision(row.intent.deployment_target, row.source_revision ?? "x", false);
}

async function step(row: PipelineRecordV1): Promise<PipelineRecordV1 | null> {
  if (row.missing.length > 0 && row.state !== "BLOCKED_INCOMPLETE") return blockIncomplete(row);
  if (ANY_TO_HOLD.has(row.state) || row.state === "ACTIVE" || row.state === "OWNER_REVIEW_REQUIRED") return null;
  if (row.state === "REVIEW_READY" && (row.risk_class === "HIGH" || row.risk_class === "CRITICAL" || row.risk_class === "MODERATE")) {
    return apply(row, "OWNER_REVIEW_REQUIRED", "PRODUCTION_PROMOTION_POLICY_V1", { HIGH_RISK_OWNER_GATE: true }, "POLICY");
  }
  switch (row.state) {
    case "REQUESTED":
      return apply(row, "CONTEXT_RESOLVED", "LOCAL_CODE_CONTEXT_RESOLVER_V1", { context: row.evidence.context }, "PIPELINE");
    case "CONTEXT_RESOLVED":
      return apply(row, "AUTHORIZED_FOR_DEVELOPMENT", "OWNER_WORK_LANES_V1", { lane: "DEVELOPMENT_LANE" }, "OWNER_POLICY");
    case "AUTHORIZED_FOR_DEVELOPMENT":
      return apply(row, "IN_DEVELOPMENT", "DETERMINISTIC_CODE_WORK_ORDER_V1", { work_order_id: row.work_order.work_order_id }, "PIPELINE");
    case "IN_DEVELOPMENT": {
      const authored = implementScoped(row);
      return apply({
        ...row,
        metrics: { ...row.metrics, AI_RESULT_BYTES: authored.bytes, LOCAL_BYTES_PROCESSED: row.metrics.LOCAL_BYTES_PROCESSED + authored.bytes },
        lineage: { ...row.lineage, files_diff: "src/feature.ts" },
      }, "AUTHORED", "scoped_implement", { hash: authored.hash, coding_agent_did_not_discover_machine: true }, "PIPELINE");
    }
    case "AUTHORED": {
      const artifact = assembleArtifact(row);
      return apply({ ...row, artifact_id: String(artifact.artifact_id), evidence: { ...row.evidence, artifact }, metrics: { ...row.metrics, ARTIFACT_BYTES: bytesOf(artifact) } }, "ASSEMBLED", "PRODUCTION_ARTIFACT_V1", { artifact_id: artifact.artifact_id }, "PIPELINE");
    }
    case "ASSEMBLED": {
      const build = runRegisteredVerification(row, "pipeline.build.hash_check");
      if (build.status !== "PASS") return apply({ ...row, evidence: { ...row.evidence, build } }, "FAILED", "MACHINE_VERIFICATION_FIRST_V1", { kind: "BUILD", build }, "MACHINE");
      return apply({ ...row, evidence: { ...row.evidence, build }, metrics: { ...row.metrics, BUILD_BYTES: Number(build.duration) } }, "BUILD_VERIFIED", "build_command_id", { verification_id: build.verification_id }, "MACHINE");
    }
    case "BUILD_VERIFIED": {
      const test = runRegisteredVerification(row, "pipeline.test.marker");
      if (test.status !== "PASS") return apply({ ...row, evidence: { ...row.evidence, test } }, "FAILED", "MACHINE_VERIFICATION_FIRST_V1", { kind: "TEST", test }, "MACHINE");
      return apply({ ...row, evidence: { ...row.evidence, test } }, "TEST_VERIFIED", "test_suite_id", { verification_id: test.verification_id }, "MACHINE");
    }
    case "TEST_VERIFIED": {
      const integ = runRegisteredVerification(row, "pipeline.integration.graph");
      if (integ.status !== "PASS") return apply({ ...row, evidence: { ...row.evidence, integ } }, "FAILED", "integration", { kind: "TEST", integ }, "MACHINE");
      return apply({ ...row, evidence: { ...row.evidence, integ } }, "INTEGRATION_VERIFIED", "integration_test_id", { verification_id: integ.verification_id }, "MACHINE");
    }
    case "INTEGRATION_VERIFIED":
      return apply(row, "REVIEW_READY", "PRODUCTION_CONVEYOR_V1", { no_manual_test_command: true }, "PIPELINE");
    case "REVIEW_READY":
      return apply(row, "APPROVED_FOR_PUBLISH", "LOW_RISK_AUTOMATIC_CONVEYOR", { risk: row.risk_class }, "POLICY");
    case "APPROVED_FOR_PUBLISH": {
      const published = promoteRemote(row);
      return apply(published, "PUBLISHED", "CANONICAL_SOURCE_PROMOTION_V1", { promotion: published.promotion }, "PIPELINE");
    }
    case "PUBLISHED":
      if (row.evidence.remote_root && row.promotion !== "REMOTE_VERIFIED") {
        return apply(row, "BLOCKED", "remote_not_verified", { promotion: row.promotion }, "MACHINE");
      }
      return apply(row, "PROMOTION_READY", "CANONICAL_SOURCE_PROMOTION_V1", { promotion: row.promotion }, "PIPELINE");
    case "PROMOTION_READY":
      if (row.intent.production_intent && !row.intent.deployment_target) {
        return blockIncomplete({ ...row, missing: ["MISSING_DEPLOYMENT_TARGET"] });
      }
      if (!row.intent.deployment_target) return null;
      return apply(row, "DEPLOYMENT_READY", "PRODUCTION_PROMOTION_POLICY_V1", { target: row.intent.deployment_target }, "POLICY");
    case "DEPLOYMENT_READY": {
      const dep = deployFixture(row, true);
      if (!dep.ok) {
        if (dep.reason === "MISSING_DEPLOYMENT_TARGET" || dep.reason === "UNREGISTERED_TARGET") {
          return blockIncomplete({ ...row, missing: ["MISSING_DEPLOYMENT_TARGET"] });
        }
        return apply(row, "FAILED", "PRODUCTION_DEPLOYMENT_V1", { kind: "DEPLOY", dep }, "MACHINE");
      }
      emitLocalResourceEvent("PRODUCTION_DEPLOYMENT", row.work_id, dep.deployment_id, undefined, { locality: "LOCAL" });
      return apply({
        ...row,
        deployment_id: dep.deployment_id,
        previous_verified_revision: dep.previous ?? row.previous_verified_revision,
        metrics: { ...row.metrics, DEPLOYMENT_BYTES: bytesOf(dep) },
        lineage: { ...row.lineage, deployment_id: dep.deployment_id },
      }, "DEPLOYED", "PRODUCTION_DEPLOYMENT_V1", { deployment_id: dep.deployment_id, deploy_command_is_not_runtime_verification: true }, "PIPELINE");
    }
    case "DEPLOYED":
      return apply(row, "RUNTIME_VERIFYING", "PRODUCTION_RUNTIME_VERIFICATION_V1", {}, "MACHINE");
    case "RUNTIME_VERIFYING": {
      const rt = verifyRuntime(row.work_id);
      if (rt.result !== "RUNTIME_VERIFIED") {
        const failed = apply({ ...row, runtime_verified: false }, "FAILED", "runtime_mismatch", { kind: "RUNTIME", rt }, "MACHINE");
        return rollbackProduction(failed.work_id) ?? failed;
      }
      return apply({ ...row, runtime_verified: true, lineage: { ...row.lineage, runtime_revision: rt.actual } }, "RUNTIME_VERIFIED", "revision_and_health", { rt, deploy_command_insufficient: true }, "MACHINE");
    }
    case "RUNTIME_VERIFIED": {
      const registered = registerProduced(row);
      return apply(registered, "CAPABILITY_REGISTERED", "PRODUCED_CAPABILITY_REGISTRATION_V1", { capability_id: registered.capability_id, owner_enabled: false }, "PIPELINE");
    }
    case "CAPABILITY_REGISTERED":
      return null;
    default:
      return null;
  }
}

export async function advanceProductionConveyor(work_id: string, stop_at?: ArtifactState): Promise<PipelineRecordV1> {
  let row = latestPipeline(work_id);
  if (!row) throw new Error("unknown work");
  for (let i = 0; i < 40; i++) {
    if (stop_at && row.state === stop_at) break;
    const next = await step(row);
    if (!next) break;
    row = next;
    emitLocalResourceEvent("PRODUCTION_CONVEYOR_ADVANCED", work_id, row.state, undefined, { locality: "LOCAL", action: row.state });
  }
  return latestPipeline(work_id)!;
}

export function ownerApprovePublish(work_id: string): PipelineRecordV1 | null {
  const row = latestPipeline(work_id);
  if (!row || row.state !== "OWNER_REVIEW_REQUIRED") return row;
  return apply(row, "APPROVED_FOR_PUBLISH", "OWNER_APPROVAL", { owner: true }, "OWNER");
}

export function reconcileDesiredWork(work_id: string): Promise<PipelineRecordV1> {
  return advanceProductionConveyor(work_id);
}

export function listDevelopmentNotifications(): readonly Record<string, unknown>[] {
  return listNotifications<Record<string, unknown>>();
}

export function getCodeVerificationRegistry(): typeof VERIFICATION_REGISTRY {
  return VERIFICATION_REGISTRY;
}

export function getSystemDependencyGraph(): typeof DEPENDENCY_GRAPH {
  return DEPENDENCY_GRAPH;
}

export function lanesContract(): Record<string, unknown> {
  return {
    schema: "OWNER_WORK_LANES_V1",
    DEVELOPMENT_LANE: true,
    CAPABILITY_USAGE_LANE: true,
    DEVELOPMENT_ARTIFACT_NE_REGISTERED_RUNTIME_CAPABILITY: true,
    DEVELOPMENT_AND_RUNTIME_AUTHORITY_SEPARATED: true,
    SURFACES_SHARE_IMPLICIT_AUTHORITY: false,
  };
}

export function productionWorkSurfaceSlice(): Record<string, unknown> {
  const latest = listPipelines().at(-1) ?? null;
  return {
    schema: "DNA_OS_WORK_PRODUCTION_PIPELINE_V1",
    DEVELOPMENT_SURFACE: {
      modes: ["DEVELOP", "BUILD", "TEST", "REVIEW", "PUBLISH", "DEPLOY", "VERIFY", "ACTIVATE"],
      work: latest ? { work_id: latest.work_id, state: latest.state, repository: latest.work_order.repository_id } : null,
    },
    OPERATIONAL_CAPABILITY_SURFACE: {
      modes: ["SEARCH", "READ", "CREATE", "WRITE", "RUN CAPABILITY", "PREVIEW", "APPROVE", "RESULT"],
      capabilities: listProducedCapabilities<Record<string, unknown>>().filter((row) => row.owner_enabled === true && row.runtime_verified === true),
    },
    SURFACES_SHARE_IMPLICIT_AUTHORITY: false,
  };
}

export function mcpDiscovery(kind: string, work_id?: string): Record<string, unknown> {
  const row = work_id ? latestPipeline(work_id) : listPipelines().at(-1) ?? null;
  switch (kind) {
    case "get_development_work":
      return { work: row, lane: row?.lane ?? "DEVELOPMENT_LANE" };
    case "get_development_status":
      return { state: row?.state ?? null, work_id: row?.work_id ?? null };
    case "get_production_pipeline":
      return { schema: PIPELINE_SCHEMA, states: ARTIFACT_STATES, record: row };
    case "get_artifact_status":
      return { artifact_id: row?.artifact_id ?? null, source_revision: row?.source_revision ?? null };
    case "get_verification_status":
      return { verifications: listVerifications().filter((v) => !work_id || (v as { work_id?: string }).work_id === work_id) };
    case "get_promotion_status":
      return { promotion: row?.promotion ?? null, remote_sha: row?.remote_sha ?? null, GITHUB_ENV_PROTECTION: githubEnvironmentProtectionStatus() };
    case "get_deployment_status":
      return { deployment_id: row?.deployment_id ?? null, targets: listRegisteredDeploymentTargets() };
    case "get_runtime_verification":
      return row ? verifyRuntime(row.work_id) : { result: "UNKNOWN" };
    case "get_capability_lineage":
      return { lineage: row?.lineage ?? null };
    case "list_development_notifications":
      return { notifications: listDevelopmentNotifications() };
    default:
      return { ok: false };
  }
}

export function prepareDisposableClone(canonical_root: string, disposable_root: string): void {
  mkdirSync(dirname(disposable_root), { recursive: true });
  if (existsSync(disposable_root)) rmSync(disposable_root, { recursive: true, force: true });
  git(dirname(disposable_root), ["clone", canonical_root, disposable_root]);
  git(disposable_root, ["config", "user.email", "pipeline-fixture@dna-os.local"]);
  git(disposable_root, ["config", "user.name", "DNA OS Pipeline Fixture"]);
}

export function attachBareRemote(_workspace: string, remote_root: string): void {
  initBareRemote(remote_root);
}

export { repoRoot };
export type { ArtifactState, PipelineRecordV1 };
