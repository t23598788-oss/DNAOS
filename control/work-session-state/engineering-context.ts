/**
 * Canonical engineering-session work context: a projection over existing
 * authorities (work-session-state journal, git, runtime-revision, capability
 * registry). Not a second registry and not AI memory.
 *
 * Input: optional work_id; otherwise the latest ACTIVE (else latest) checkpoint.
 * Output: getCurrentWorkContext, recordEngineeringHandoff, activeEngineeringWorkId.
 */

import { getCapability } from "../command-router/contract";
import { readRuntimeRevision } from "../runtime-revision/contract";
import {
  allCurrentCheckpoints,
  appendCheckpoint,
  currentBranch,
  currentCheckpoint,
  currentRevision,
  journalPath,
  newSessionId,
} from "./store";
import { buildResumeContext } from "./resume";
import type {
  EngineeringProgress,
  ProvenancedRef,
  ResumeContext,
  WorkSessionCheckpoint,
} from "./types";

const SECRET_KEY = /token|password|secret|keychain|authorization|client_secret|refresh_token|access_token/i;

export interface CanonicalWorkContext {
  readonly queried_at: string;
  readonly work_id: string | null;
  readonly title: string | null;
  readonly domain: string | null;
  readonly git: {
    readonly authority: "git";
    readonly branch: string;
    readonly source_revision: string;
  };
  readonly runtime: {
    readonly authority: "runtime";
    readonly revision: string | null;
    readonly source: string;
    readonly dirty: boolean;
    readonly reason: string | null;
  };
  readonly revision_awareness: {
    readonly checkpoint_revision: string | null;
    readonly source_revision: string;
    readonly runtime_revision: string | null;
    readonly checkpoint_stale: boolean;
    readonly runtime_stale: boolean;
  };
  readonly completed_boundaries: readonly ProvenancedRef[];
  readonly current_boundary: ProvenancedRef | null;
  readonly next_boundary: ProvenancedRef | null;
  readonly relevant_files: readonly string[];
  readonly relevant_components: readonly string[];
  readonly relevant_capabilities: readonly {
    readonly capability_id: string;
    readonly authority: "capability_registry";
    readonly present: boolean;
    readonly health_status: string | null;
  }[];
  readonly open_prs: EngineeringProgress["open_pr_refs"];
  readonly proofs: EngineeringProgress["proofs"] | null;
  readonly blockers: ResumeContext["open_blockers"];
  readonly constraints: readonly string[];
  readonly resume: {
    readonly next_action: string;
    readonly resume_status: ResumeContext["resume_status"];
    readonly revision_drifted: boolean;
  };
  readonly sources: readonly { readonly fact: string; readonly authority: string; readonly path: string }[];
  readonly interpretation: string | null;
}

function rejectSecrets(value: unknown, path: string): void {
  if (typeof value === "string" && SECRET_KEY.test(path)) {
    throw new Error(`WORK_CONTEXT_SECRET_REFUSED:${path}`);
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) throw new Error(`WORK_CONTEXT_SECRET_REFUSED:${path}.${k}`);
      if (typeof v === "string" && /client_secret|refresh_token|ya29\.|1\/\/[A-Za-z0-9]|ghp_|github_pat_/.test(v)) {
        throw new Error(`WORK_CONTEXT_SECRET_REFUSED:${path}.${k}`);
      }
    }
  }
}

export function activeEngineeringWorkId(path = journalPath()): string | null {
  const rows = allCurrentCheckpoints(path);
  const active = rows.filter((row) => row.status === "ACTIVE" || row.status === "BLOCKED");
  const pool = active.length > 0 ? active : rows;
  if (pool.length === 0) return null;
  return pool.sort((a, b) => a.updated_at.localeCompare(b.updated_at)).at(-1)!.work_id;
}

function emptyProofs(now: string): EngineeringProgress["proofs"] {
  const unset = {
    status: "UNPROVEN" as const,
    authority: "work_session_state" as const,
    evidence_ref: null,
    source_revision: null,
    observed_at: now,
  };
  return { static: unset, hermetic: unset, live: { ...unset, authority: "command_evidence" } };
}

export function recordEngineeringHandoff(input: {
  readonly work_id: string;
  readonly title: string;
  readonly domain: string;
  readonly objective?: string;
  readonly current_phase?: string;
  readonly next_action: string;
  readonly relevant_files: readonly string[];
  readonly relevant_capability_ids?: readonly string[];
  readonly completed_boundaries?: readonly ProvenancedRef[];
  readonly current_boundary?: ProvenancedRef | null;
  readonly next_boundary?: ProvenancedRef | null;
  readonly open_pr_refs?: EngineeringProgress["open_pr_refs"];
  readonly proofs?: EngineeringProgress["proofs"];
  readonly constraints?: readonly string[];
  readonly blockers?: WorkSessionCheckpoint["blockers"];
  readonly interpretation?: string | null;
  readonly status?: WorkSessionCheckpoint["status"];
}, path = journalPath()): WorkSessionCheckpoint {
  rejectSecrets(input, "handoff");
  const now = new Date().toISOString();
  const previous = currentCheckpoint(input.work_id, path);
  const sha = currentRevision();
  const engineering: EngineeringProgress = {
    title: input.title,
    domain: input.domain,
    completed_boundaries: input.completed_boundaries ?? previous?.engineering?.completed_boundaries ?? [],
    current_boundary: input.current_boundary !== undefined ? input.current_boundary : (previous?.engineering?.current_boundary ?? null),
    next_boundary: input.next_boundary !== undefined ? input.next_boundary : (previous?.engineering?.next_boundary ?? null),
    relevant_capability_ids: input.relevant_capability_ids ?? previous?.engineering?.relevant_capability_ids ?? [],
    open_pr_refs: input.open_pr_refs ?? previous?.engineering?.open_pr_refs ?? [],
    proofs: input.proofs ?? previous?.engineering?.proofs ?? emptyProofs(now),
    interpretation: input.interpretation !== undefined ? input.interpretation : (previous?.engineering?.interpretation ?? null),
  };
  return appendCheckpoint({
    work_id: input.work_id,
    owner_intent_id: previous?.owner_intent_id ?? input.title,
    task_id: previous?.task_id ?? null,
    session_id: previous?.session_id ?? newSessionId(),
    execution_id: previous?.execution_id ?? null,
    worker_identity: previous?.worker_identity ?? "engineering-handoff",
    repository: previous?.repository ?? "DNA-OS-INFRASTRUCTURE",
    branch: currentBranch(),
    affected_resource_ids: previous?.affected_resource_ids ?? [],
    affected_paths: input.relevant_files,
    objective: input.objective ?? previous?.objective ?? input.title,
    current_phase: input.current_phase ?? previous?.current_phase ?? (input.current_boundary?.id ?? "engineering"),
    steps: previous?.steps ?? [],
    blockers: input.blockers ?? previous?.blockers ?? [],
    decisions_required: previous?.decisions_required ?? [],
    evidence_refs: previous?.evidence_refs ?? [],
    source_revision: sha,
    last_verified_revision: sha,
    next_action: input.next_action,
    do_not_repeat: input.constraints ?? previous?.do_not_repeat ?? [],
    ui_context: previous?.ui_context ?? null,
    last_durable_event: previous?.last_durable_event ?? [],
    sync_state: previous?.sync_state ?? "SYNCED",
    engineering,
    resolution_ref: previous?.resolution_ref ?? null,
    cross_repo_evidence: previous?.cross_repo_evidence ?? [],
    status: input.status ?? previous?.status ?? "ACTIVE",
    started_at: previous?.started_at ?? now,
  }, path);
}

export function getCurrentWorkContext(workId?: string, path = journalPath()): CanonicalWorkContext {
  const queried_at = new Date().toISOString();
  const gitSha = currentRevision();
  const gitBranch = currentBranch();
  const runtime = readRuntimeRevision();
  const id = workId ?? activeEngineeringWorkId(path);
  const checkpoint = id ? currentCheckpoint(id, path) : null;
  const resume: ResumeContext | null = id ? buildResumeContext(id, path) : null;

  const eng = checkpoint?.engineering ?? null;
  const capIds = eng?.relevant_capability_ids ?? [];
  const capabilities = capIds.map((capability_id) => {
    const row = getCapability(capability_id);
    return {
      capability_id,
      authority: "capability_registry" as const,
      present: row !== undefined,
      health_status: row?.health_status ?? null,
    };
  });

  const checkpoint_stale = Boolean(checkpoint && checkpoint.source_revision !== gitSha && checkpoint.source_revision !== "UNKNOWN_REVISION");
  const runtime_stale = Boolean(runtime.revision && runtime.revision !== gitSha);

  return {
    queried_at,
    work_id: id,
    title: eng?.title ?? checkpoint?.objective ?? null,
    domain: eng?.domain ?? null,
    git: { authority: "git", branch: gitBranch, source_revision: gitSha },
    runtime: {
      authority: "runtime",
      revision: runtime.revision,
      source: runtime.source,
      dirty: runtime.dirty,
      reason: runtime.reason,
    },
    revision_awareness: {
      checkpoint_revision: checkpoint?.source_revision ?? null,
      source_revision: gitSha,
      runtime_revision: runtime.revision,
      checkpoint_stale,
      runtime_stale,
    },
    completed_boundaries: eng?.completed_boundaries ?? [],
    current_boundary: eng?.current_boundary ?? null,
    next_boundary: eng?.next_boundary ?? null,
    relevant_files: checkpoint?.affected_paths ?? [],
    relevant_components: [...new Set([
      ...(checkpoint?.affected_paths ?? []).map((p) => p.split("/").slice(0, 2).join("/")),
    ])],
    relevant_capabilities: capabilities,
    open_prs: eng?.open_pr_refs ?? [],
    proofs: eng?.proofs ?? null,
    blockers: resume?.open_blockers ?? [],
    constraints: checkpoint?.do_not_repeat ?? [],
    resume: {
      next_action: resume?.next_action ?? "no recorded engineering work",
      resume_status: resume?.resume_status ?? "NO_SUCH_WORK",
      revision_drifted: resume?.revision_drifted ?? false,
    },
    sources: [
      { fact: "git_head", authority: "git", path: "control/work-session-state/store.ts#currentRevision" },
      { fact: "runtime_revision", authority: "runtime", path: "control/runtime-revision/contract.ts#readRuntimeRevision" },
      { fact: "work_progress", authority: "work_session_state", path: "local-runtime/work-session-state/checkpoints.jsonl" },
      { fact: "capabilities", authority: "capability_registry", path: "control/command-router/capability-registry.ts" },
      { fact: "open_prs", authority: "github", path: "checkpoint.engineering.open_pr_refs (pointers only)" },
    ],
    interpretation: eng?.interpretation ?? null,
  };
}
