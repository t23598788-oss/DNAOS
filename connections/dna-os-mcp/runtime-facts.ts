/**
 * DNA OS runtime facts for external MCP self-reporting.
 * Facts are projected from persisted lifecycle, registry, and workspace
 * evidence. They are never inferred from GitHub by the MCP adapter.
 *
 * Dependency ที่อนุญาต: engineering-runtime, owner-command, source-workspace,
 * command-router, machine-model contracts.
 * สิ่งที่ห้ามแตะ: never return tokens, Keychain values, unrestricted paths,
 * or business-domain records.
 */

import { currentMachineIdentity } from "../../control/machine-model/contract";
import { listCapabilities } from "../../control/command-router/contract";
import {
  latestLifecycleForWork,
  listGithubPublicationProofs,
  listLifecycle,
  listVerifiedCapabilities,
  listWorkspaceCleanupRecords,
  latestGithubPublicationProof,
  latestPublicationPointer,
} from "../../control/engineering-runtime/contract";
import { latestWorkPointer } from "../../control/owner-command/contract";
import { getCurrentWorkContext } from "../../control/work-session-state/contract";
import { lookupCodeReferences, resolveCurrentSource } from "../../control/mcp-code-knowledge/contract";
import {
  listLocalWorkspaces,
  listWorkspaceCleanupEvidence,
  pathDisclosureRef,
  workspacesForWork,
} from "../../control/source-workspace/contract";

export const DNA_OS_RUNTIME_ID = "runtime://dna-os-infrastructure";

const SECRET_KEY = /token|password|secret|keychain|authorization|credential|cookie|private[_-]?key/i;
const SECRET_VALUE = /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+\S+)/i;

export interface ProofEnvelope {
  readonly source: "DNA_OS_RUNTIME";
  readonly runtime_id: string;
  readonly work_id: string | null;
  readonly fact_type: string;
  readonly status: string;
  readonly evidence_refs: readonly string[];
  readonly observed_at: string;
}

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value) || /keychain:\/\//i.test(value)) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(nested);
    }
    return out;
  }
  return value;
}

function identity() {
  const machine = currentMachineIdentity();
  return {
    dna_os_runtime_id: DNA_OS_RUNTIME_ID,
    system_instance_id: machine.machine_id ?? "instance:uninitialized",
    machine_state: machine.state,
  };
}

function envelope(fact_type: string, status: string, work_id: string | null, evidence_refs: readonly string[]): ProofEnvelope {
  return {
    source: "DNA_OS_RUNTIME",
    runtime_id: DNA_OS_RUNTIME_ID,
    work_id,
    fact_type,
    status,
    evidence_refs,
    observed_at: new Date().toISOString(),
  };
}

function commonWorkFields(workId: string | null) {
  const lifecycle = workId ? latestLifecycleForWork(workId) : null;
  const proof = workId ? latestGithubPublicationProof<Record<string, unknown>>(workId) : null;
  const pointer = workId ? latestPublicationPointer(workId) : null;
  const workspaces = workId ? workspacesForWork(workId) : [];
  const cleanup = workId
    ? listWorkspaceCleanupRecords().filter((row) => row.work_id === workId)
    : [];
  const cleanupLocal = workId
    ? listWorkspaceCleanupEvidence().filter((row) => row.work_id === workId)
    : [];
  const started = workId ? listLifecycle().find((row) => row.work_id === workId) : null;
  const evidence_ids = [
    lifecycle?.evidence_ref,
    typeof proof?.recorded_at === "string" ? `github-proof:${workId}` : null,
    ...cleanup.map((row) => String(row.evidence_id ?? "")),
    ...cleanupLocal.map((row) => String(row.evidence_id ?? "")),
    ...workspaces.flatMap((row) => row.evidence_refs),
  ].filter((row): row is string => typeof row === "string" && row.length > 0);

  return {
    ...identity(),
    work_id: workId,
    command_id: lifecycle?.command_id ?? null,
    current_stage: lifecycle?.stage ?? null,
    execution_status: lifecycle?.stage ?? null,
    capability_id: "engineering-runtime",
    worker_id: lifecycle?.worker_id ?? null,
    repository_id: pointer?.github_repository ? `github://${pointer.github_owner}/${pointer.github_repository}` : null,
    commit_sha: pointer?.dna_os_commit_sha ?? null,
    remote_sha: pointer?.remote_sha ?? (typeof proof?.remote_sha === "string" ? proof.remote_sha : null),
    verification_status: typeof proof?.status === "string" ? proof.status : lifecycle?.stage ?? null,
    evidence_ids,
    started_at: started?.recorded_at ?? null,
    updated_at: lifecycle?.recorded_at ?? null,
    completed_at: lifecycle?.stage === "VERIFIED" ? lifecycle.recorded_at : null,
    workspace_refs: workspaces.map((row) => ({
      workspace_id: row.workspace_id,
      current_state: row.current_state,
      path_reference: pathDisclosureRef(row.workspace_id),
    })),
    source_components: [
      "control/engineering-runtime/lifecycle.ts",
      "control/engineering-runtime/persist.ts",
      "control/source-workspace/local-registry.ts",
    ],
  };
}

export function getRuntimeIdentityFact(): Record<string, unknown> {
  return redact({
    ...identity(),
    proof: envelope("runtime_identity", currentMachineIdentity().state, null, ["machine-model:currentMachineIdentity"]),
    persistent_local_footprint: [
      "DNA_OS_CONTROL_RUNTIME",
      "REGISTERED_CONFIGURATION_REFERENCES",
      "CONNECTION_METADATA",
      "CREDENTIAL_REFERENCES_ONLY",
      "MACHINE_IDENTITY",
      "RECOVERY_BOOTSTRAP",
      "ACTIVE_OR_INCOMPLETE_WORKSPACES",
    ],
    source_components: ["control/machine-model/machine-binding.ts"],
  }) as Record<string, unknown>;
}

export function getSystemHealthFact(): Record<string, unknown> {
  const caps = listCapabilities();
  const connected = caps.filter((row) => row.health_status === "CONNECTED").length;
  return redact({
    ...identity(),
    proof: envelope("system_health", currentMachineIdentity().state === "INITIALIZED" ? "HEALTHY" : currentMachineIdentity().state, null, ["command-router:listCapabilities"]),
    capability_count: caps.length,
    connected_capability_count: connected,
    source_components: ["control/command-router/capability-registry.ts", "control/machine-model/machine-binding.ts"],
  }) as Record<string, unknown>;
}

export function getLatestWorkFact(): Record<string, unknown> {
  const lifecycle = listLifecycle();
  const last = lifecycle.length > 0 ? lifecycle[lifecycle.length - 1]! : null;
  const pointer = latestWorkPointer();
  const workId = last?.work_id ?? pointer?.work_id ?? null;
  return redact({
    ...commonWorkFields(workId),
    proof: envelope("latest_work", last?.stage ?? pointer?.status ?? "NONE", workId, last ? [last.evidence_ref] : []),
    owner_pointer_status: pointer?.status ?? null,
    source_components: [
      "control/engineering-runtime/lifecycle.ts",
      "control/owner-command/work-identity.ts",
    ],
  }) as Record<string, unknown>;
}

export function getWorkStatusFact(workId?: string): Record<string, unknown> {
  const latest = getLatestWorkFact();
  const id = workId ?? (typeof latest.work_id === "string" ? latest.work_id : null);
  const fields = commonWorkFields(id);
  return redact({
    ...fields,
    proof: envelope("work_status", String(fields.current_stage ?? "UNKNOWN"), id, fields.evidence_ids),
  }) as Record<string, unknown>;
}

export function getWorkEvidenceFact(workId?: string): Record<string, unknown> {
  const status = getWorkStatusFact(workId);
  const id = typeof status.work_id === "string" ? status.work_id : null;
  const github = id ? listGithubPublicationProofs().filter((row) => row.work_id === id) : [];
  const cleanup = id ? listWorkspaceCleanupEvidence().filter((row) => row.work_id === id) : [];
  const engCleanup = id ? listWorkspaceCleanupRecords().filter((row) => row.work_id === id) : [];
  return redact({
    ...status,
    proof: envelope("work_evidence", String(status.verification_status ?? "UNKNOWN"), id, Array.isArray(status.evidence_ids) ? status.evidence_ids as string[] : []),
    github_remote_proofs: github.map((row) => ({
      work_id: row.work_id,
      status: row.status,
      remote_sha: row.remote_sha,
      lineage_verified: row.lineage_verified,
      expected_files_verified: row.expected_files_verified,
      ci_required: row.ci_required,
      recorded_at: row.recorded_at,
    })),
    workspace_cleanup_proofs: [
      ...[...cleanup, ...engCleanup].map((row) => ({
        work_id: row.work_id,
        note: row.note ?? row.status,
        status: row.status,
        evidence_id: row.evidence_id,
      })),
      ...workspacesForWork(id ?? "").filter((row) => row.current_state === "CLEANED").map((row) => ({
        work_id: row.work_id,
        note: "WORKSPACE_CLEANED",
        status: "CLEANED",
        evidence_id: row.evidence_refs[row.evidence_refs.length - 1] ?? row.workspace_id,
      })),
    ],
    source_components: [
      "control/engineering-runtime/persist.ts",
      "control/source-workspace/cleanup.ts",
    ],
  }) as Record<string, unknown>;
}

export function getCurrentWorkContextFact(workId?: string): Record<string, unknown> {
  const ctx = getCurrentWorkContext(workId);
  return redact({
    ...identity(),
    proof: envelope(
      "current_work_context",
      ctx.resume.resume_status,
      ctx.work_id,
      [
        "control/work-session-state/contract.ts#getCurrentWorkContext",
        ...ctx.sources.map((row) => row.path),
      ],
    ),
    work_context: ctx,
    targeted_read: {
      SOURCE_SEARCH_REQUIRED: false,
      read_only_paths: ctx.relevant_files,
      instruction: "Read only these paths unless they are insufficient. Do not start with a repository-wide search.",
    },
    source_components: [
      "control/work-session-state/engineering-context.ts",
      "control/runtime-revision/contract.ts",
      "control/command-router/capability-registry.ts",
    ],
  }) as Record<string, unknown>;
}

export function resolveCurrentSourceFact(workId?: string, includeHistorical = false): Record<string, unknown> {
  const resolved = resolveCurrentSource(workId, { include_historical: includeHistorical });
  return redact({
    ...identity(),
    proof: envelope(
      "current_source",
      resolved.resolution,
      resolved.work_id,
      resolved.sources.map((row) => row.path),
    ),
    current_source: resolved,
    source_components: [
      "control/mcp-code-knowledge/source-resolution.ts",
      "software/repository-registry/registry.ts",
    ],
  }) as Record<string, unknown>;
}

export function lookupCodeReferencesFact(input: {
  readonly capability_id?: string;
  readonly query?: string;
  readonly include_historical?: boolean;
  readonly work_id?: string;
}): Record<string, unknown> {
  const lookup = lookupCodeReferences(input);
  return redact({
    ...identity(),
    proof: envelope(
      "code_references",
      lookup.unresolved_reason ? "UNRESOLVED" : "RESOLVED",
      lookup.capability_id,
      lookup.sources.map((row) => row.path),
    ),
    code_references: lookup,
    source_components: [
      "control/mcp-code-knowledge/source-resolution.ts",
      "control/command-router/capability-registry.ts",
    ],
  }) as Record<string, unknown>;
}

export function getCapabilityStatusFact(capabilityId?: string): Record<string, unknown> {
  const caps = listCapabilities();
  const verified = listVerifiedCapabilities();
  const one = capabilityId ? caps.find((row) => row.capability_id === capabilityId) : null;
  return redact({
    ...identity(),
    proof: envelope("capability_status", one?.health_status ?? "CATALOG", capabilityId ?? null, ["command-router:listCapabilities"]),
    capability: one ? { id: one.capability_id, health_status: one.health_status, available: one.health_status === "CONNECTED" } : null,
    catalog_count: caps.length,
    verified_engineering_capabilities: verified.length,
    source_components: ["control/command-router/capability-registry.ts", "control/engineering-runtime/persist.ts"],
  }) as Record<string, unknown>;
}

export function containsCredentialMaterial(payload: unknown): boolean {
  const text = JSON.stringify(payload);
  return SECRET_VALUE.test(text) || /keychain:\/\//i.test(text);
}
