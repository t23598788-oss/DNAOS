/**
 * หน้าที่: Autonomous Engineering Loop. DNA OS owns the lifecycle.
 * Coding workers only propose scoped writes. Completion, GitHub, and
 * registry stay behind existing Engineering gates.
 *
 * Input: Owner command fields + admitted coding intent + checkout_root.
 * Output: loop result with canonical work_id and lifecycle evidence.
 * Dependency ที่อนุยาต: existing engineering complete/publish/gate,
 * ./lifecycle.ts, ./engineering-worker-registry.ts, ./proceed-gate.ts.
 * สิ่งที่ห้ามแตะ: never publish before READY_TO_PUBLISH gate.
 * never registry-write before remote SHA match. never trust worker complete.
 */

import { createHash, randomUUID } from "node:crypto";
import { saveEvidence } from "../agent-gateway/contract";
import { searchOverlap } from "../../software/capability-registrar/contract";
import { completeEngineeringWork } from "./complete";
import { admitEngineeringCoding, readEngineeringCodingIntent } from "./gate";
import {
  fingerprintEngineeringAction,
  latestLifecycleForFingerprint,
  latestLifecycleForWork,
  overlappingActiveScope,
  canTransition,
  persistScopeLock,
  TERMINAL_ENGINEERING_STAGES,
  transitionLifecycle,
  type EngineeringLifecycleRecord,
  type EngineeringLifecycleStage,
} from "./lifecycle";
import { latestGithubPublicationProof, latestPublicationPointer, persistPublicationPointer, persistVerifiedCapability } from "./persist";
import { cleanupAfterEngineeringVerified } from "./workspace-lifecycle";
import { mayProceedToPublish, mayProceedToRegistry } from "./proceed-gate";
import { publishEngineeringSource } from "./publish";
import { resolveGithubDestination } from "./github-destination";
import {
  ownerFacingEngineeringResult,
  verifyGithubPublicationPermanence,
  type GithubPermanenceDeps,
  type GithubPermanenceInput,
  type GithubPermanenceProof,
  type OwnerEngineeringFace,
} from "./github-permanence";
import type { GithubPublishDeps } from "./github-publish-authority";
import {
  localScopedWorker,
  selectEngineeringWorker,
  type EngineeringRepairRequest,
  type EngineeringWorker,
} from "./engineering-worker-registry";
import type {
  EngineeringCompletionResult,
  EngineeringGateReason,
  EngineeringPublicationResult,
  ProposedScopedWrite,
} from "./types";

export interface EngineeringLoopDeps {
  readonly worker?: EngineeringWorker;
  readonly extras?: readonly EngineeringWorker[];
  readonly preferred_worker_id?: string | null;
  readonly exclude_worker_id?: string | null;
  readonly publish?: GithubPublishDeps;
  readonly registryWrite?: (row: Record<string, unknown>) => { readonly ok: true } | { readonly ok: false; readonly detail: string };
  readonly max_repair_attempts?: number;
  readonly skip_publish?: boolean;
  readonly permanence?: GithubPermanenceDeps;
  readonly verifyPermanence?: (input: GithubPermanenceInput) => Promise<GithubPermanenceProof>;
}

export interface EngineeringLoopResult {
  readonly status: "VERIFIED" | "BLOCKED" | "FAILED" | "REJECTED" | "OWNER_REVIEW" | "CI_PENDING";
  readonly reason_code: EngineeringGateReason | "ADMITTED" | "LIFECYCLE";
  readonly detail: string;
  readonly work_id: string;
  readonly command_id: string;
  readonly worker_id: string | null;
  readonly attempt: number;
  readonly lifecycle: EngineeringLifecycleRecord | null;
  readonly completion: EngineeringCompletionResult | null;
  readonly publication: EngineeringPublicationResult | null;
  readonly registry_written: boolean;
  readonly repair_count: number;
  readonly github_proof: GithubPermanenceProof | null;
  readonly owner_result: OwnerEngineeringFace;
  readonly workspace_cleanup: readonly { readonly status: string; readonly workspace_id: string; readonly evidence_id: string }[];
}

function now(): string {
  return new Date().toISOString();
}

function evidence(workId: string, commandId: string, note: string, extra: Record<string, unknown> = {}): string {
  const evidence_id = `ev-eng-loop-${randomUUID()}`;
  saveEvidence({
    evidence_id,
    task_id: `task-${commandId}-engineering-loop`,
    correlation_id: commandId,
    work_order_id: workId,
    kind: "execution_output",
    source: "control/engineering-runtime/autonomous-loop.ts",
    recorded_at: now(),
    payload: { note, work_id: workId, ...extra },
  });
  return evidence_id;
}

function replayTerminal(record: EngineeringLifecycleRecord, commandId: string): EngineeringLoopResult {
  evidence(record.work_id, commandId, "duplicate_lifecycle_replay", { stage: record.stage });
  const status = record.stage === "VERIFIED" ? "VERIFIED"
    : record.stage === "OWNER_REVIEW" ? "OWNER_REVIEW"
      : record.stage === "REJECTED" ? "REJECTED"
        : record.stage === "FAILED" ? "FAILED"
          : "BLOCKED";
  return terminal(status, record.reason_code, `replay existing lifecycle ${record.stage}`, {
    work_id: record.work_id,
    command_id: commandId,
    lifecycle: record,
  });
}

function digestWrites(writes: readonly ProposedScopedWrite[]): string {
  return createHash("sha256").update(writes.map((row) => `${row.relative_path}\n${row.content}`).join("\0")).digest("hex");
}

function proposalValid(allowed: readonly string[], forbidden: readonly string[], writes: readonly ProposedScopedWrite[]): { readonly ok: true } | { readonly ok: false; readonly reason_code: EngineeringGateReason; readonly detail: string; readonly files: readonly string[] } {
  if (writes.length === 0) return { ok: false, reason_code: "CODING_INCOMPLETE", detail: "worker proposed no writes", files: [] };
  const files: string[] = [];
  for (const row of writes) {
    const rel = row.relative_path.replaceAll("\\", "/");
    files.push(rel);
    if (rel.includes("..") || rel.startsWith("/")) return { ok: false, reason_code: "PATH_TRAVERSAL", detail: rel, files };
    if (forbidden.some((scope) => rel === scope || rel.startsWith(`${scope}/`))) {
      return { ok: false, reason_code: "WRITE_IN_FORBIDDEN_SCOPE", detail: rel, files };
    }
    if (!allowed.some((scope) => rel === scope || rel.startsWith(`${scope}/`))) {
      return { ok: false, reason_code: "WRITE_OUT_OF_ALLOWED_SCOPE", detail: rel, files };
    }
  }
  return { ok: true };
}

function terminal(status: EngineeringLoopResult["status"], reason: EngineeringLoopResult["reason_code"], detail: string, extra: Partial<EngineeringLoopResult>): EngineeringLoopResult {
  const github_proof = extra.github_proof ?? null;
  const owner_result = extra.owner_result ?? ownerFacingEngineeringResult({
    loop_status: status,
    permanence_status: github_proof?.status ?? null,
    repairing: extra.repair_count !== undefined && extra.repair_count > 0 && status !== "VERIFIED",
  });
  return {
    status,
    reason_code: reason,
    detail,
    work_id: extra.work_id ?? "",
    command_id: extra.command_id ?? "",
    worker_id: extra.worker_id ?? null,
    attempt: extra.attempt ?? 0,
    lifecycle: extra.lifecycle ?? null,
    completion: extra.completion ?? null,
    publication: extra.publication ?? null,
    registry_written: extra.registry_written ?? false,
    repair_count: extra.repair_count ?? 0,
    github_proof,
    owner_result,
    workspace_cleanup: extra.workspace_cleanup ?? [],
  };
}

export async function runAutonomousEngineeringLoop(input: {
  readonly command_id: string;
  readonly work_id: string;
  readonly intent_text: string;
  readonly payload: unknown;
  readonly checkout_root: string;
  readonly selected_capability_id?: string | null;
  readonly proposed_writes?: readonly ProposedScopedWrite[];
  readonly deps?: EngineeringLoopDeps;
}): Promise<EngineeringLoopResult> {
  const deps = input.deps ?? {};
  const maxRepairs = deps.max_repair_attempts ?? 3;
  const intent = readEngineeringCodingIntent(input.payload);
  const fingerprint = fingerprintEngineeringAction(input.intent_text, intent?.allowed_paths ?? []);
  const existingWork = latestLifecycleForWork(input.work_id);
  const existingFp = latestLifecycleForFingerprint(fingerprint);

  if (existingWork && TERMINAL_ENGINEERING_STAGES.has(existingWork.stage)) {
    return replayTerminal(existingWork, input.command_id);
  }
  if (existingFp && existingFp.work_id !== input.work_id) {
    if (TERMINAL_ENGINEERING_STAGES.has(existingFp.stage)) {
      return replayTerminal(existingFp, input.command_id);
    }
    return terminal("BLOCKED", "DUPLICATE_LIFECYCLE", `in-flight lifecycle ${existingFp.work_id} already owns this action`, { work_id: input.work_id, command_id: input.command_id, lifecycle: existingFp });
  }

  let record: EngineeringLifecycleRecord | null = existingWork;
  if (!record) {
    const started = transitionLifecycle({
      previous: null,
      next: "REQUESTED",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt: 0,
      worker_id: null,
      action_fingerprint: fingerprint,
      allowed_paths: intent?.allowed_paths ?? [],
      reservation_id: null,
      reason_code: "LIFECYCLE",
      detail: "Owner intent received",
      evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_REQUESTED", { fingerprint }),
      recorded_at: now(),
    });
    if (!started.ok) return terminal("FAILED", started.reason_code, started.detail, { work_id: input.work_id, command_id: input.command_id });
    record = started.record;
  }

  const admission = admitEngineeringCoding({
    command_id: input.command_id,
    work_id: input.work_id,
    checkout_root: input.checkout_root,
    payload: input.payload,
    selected_capability_id: input.selected_capability_id,
  });
  const overlap = (intent?.allowed_paths ?? []).flatMap((path) => [...searchOverlap(path)]);

  if (record.stage === "REGISTRY_UPDATE") {
    const pointer = latestPublicationPointer(input.work_id);
    if (!pointer) {
      return terminal("BLOCKED", "RECOVERY_UNSAFE", "REGISTRY_UPDATE without publication pointer", { work_id: input.work_id, command_id: input.command_id, lifecycle: record });
    }
    const publication: EngineeringPublicationResult = {
      status: "VERIFIED",
      reason_code: "ADMITTED",
      detail: "recovered publication pointer",
      completion: null as unknown as EngineeringCompletionResult,
      commit: null,
      publish: null,
      lineage: {
        command_id: pointer.command_id,
        work_id: pointer.work_id,
        reservation_id: record.reservation_id,
        branch_ref: null,
        worktree_path: null,
        base_commit_sha: null,
        repository_id: null,
        changed_path: null,
        dna_os_commit_sha: pointer.dna_os_commit_sha,
        post_publish_remote_sha: pointer.remote_sha,
        publish_status: "PUBLISHED",
      },
    };
    return await finishRegistry({
      input, deps, record, admissionPaths: record.allowed_paths, workerId: record.worker_id, attempt: record.attempt, repairCount: 0, completion: null, publication, pointer,
      github_proof: latestGithubPublicationProof<GithubPermanenceProof>(input.work_id),
    });
  }

  if (record.stage === "CI_PENDING" || record.stage === "CI_VERIFIED" || record.stage === "REMOTE_VERIFICATION") {
    const pointer = latestPublicationPointer(input.work_id);
    if (!pointer?.github_owner || !pointer.github_repository || !pointer.publish_branch || !pointer.connection_id || !pointer.manifest_id) {
      return terminal("BLOCKED", "RECOVERY_UNSAFE", `${record.stage} without complete publication pointer`, { work_id: input.work_id, command_id: input.command_id, lifecycle: record });
    }
    const publication: EngineeringPublicationResult = {
      status: "VERIFIED",
      reason_code: "ADMITTED",
      detail: "recovered publication pointer",
      completion: null as unknown as EngineeringCompletionResult,
      commit: null,
      publish: null,
      lineage: {
        command_id: pointer.command_id,
        work_id: pointer.work_id,
        reservation_id: record.reservation_id,
        branch_ref: pointer.publish_branch,
        worktree_path: null,
        base_commit_sha: null,
        repository_id: null,
        changed_path: null,
        dna_os_commit_sha: pointer.dna_os_commit_sha,
        post_publish_remote_sha: pointer.remote_sha,
        github_owner: pointer.github_owner,
        github_repository: pointer.github_repository,
        publish_branch: pointer.publish_branch,
        credential_ref: pointer.connection_id,
        publish_status: "PUBLISHED",
      },
    };
    const permanence = await applyPermanenceThenRegistry({
      input, deps, record, fingerprint, admissionPaths: record.allowed_paths, workerId: record.worker_id, attempt: record.attempt, repairCount: 0, completion: null, publication, pointer, maxRepairs: deps.max_repair_attempts ?? 3,
    });
    if (permanence.kind === "done") return permanence.result;
    record = permanence.record;
  }

  if (record.stage === "REQUESTED") {
    const scoped = transitionLifecycle({
      previous: record,
      next: admission.admitted ? "SCOPED" : "BLOCKED",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt: record.attempt,
      worker_id: null,
      action_fingerprint: fingerprint,
      allowed_paths: admission.allowed_paths,
      reservation_id: null,
      reason_code: admission.admitted ? "ADMITTED" : admission.reason_code,
      detail: admission.admitted
        ? `scope admitted; capability_overlap=${overlap.map((row) => row.CAPABILITY_ID).join(",") || "none"}`
        : admission.detail,
      evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_SCOPED", { overlap: overlap.map((row) => row.CAPABILITY_ID), admitted: admission.admitted }),
      recorded_at: now(),
    });
    if (!scoped.ok) return terminal("FAILED", scoped.reason_code, scoped.detail, { work_id: input.work_id, command_id: input.command_id, lifecycle: record });
    record = scoped.record;
    if (!admission.admitted) {
      return terminal("BLOCKED", admission.reason_code, admission.detail, { work_id: input.work_id, command_id: input.command_id, lifecycle: record });
    }
  } else if (!admission.admitted) {
    return terminal("BLOCKED", admission.reason_code, admission.detail, { work_id: input.work_id, command_id: input.command_id, lifecycle: record });
  }

  if (record.stage === "SCOPED") {
    const clash = overlappingActiveScope(input.work_id, admission.allowed_paths);
    const reserved = transitionLifecycle({
      previous: record,
      next: clash ? "BLOCKED" : "RESERVED",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt: record.attempt,
      worker_id: null,
      action_fingerprint: fingerprint,
      allowed_paths: admission.allowed_paths,
      reservation_id: null,
      reason_code: clash ? "SCOPE_LOCKED" : "ADMITTED",
      detail: clash ? `scope locked by ${clash.work_id}` : "scope lock acquired",
      evidence_ref: evidence(input.work_id, input.command_id, clash ? "scope_locked" : "scope_reserved", { clash: clash?.work_id ?? null }),
      recorded_at: now(),
    });
    if (!reserved.ok) return terminal("FAILED", reserved.reason_code, reserved.detail, { work_id: input.work_id, command_id: input.command_id, lifecycle: record });
    record = reserved.record;
    if (clash) {
      return terminal("BLOCKED", "SCOPE_LOCKED", record.detail, { work_id: input.work_id, command_id: input.command_id, lifecycle: record });
    }
    persistScopeLock({ work_id: input.work_id, allowed_paths: admission.allowed_paths, active: true, recorded_at: now() });
  } else if (record.stage !== "BLOCKED") {
    persistScopeLock({ work_id: input.work_id, allowed_paths: admission.allowed_paths, active: true, recorded_at: now() });
  }

  try {
  const midStages: readonly EngineeringLifecycleStage[] = ["CODE_PROPOSED", "VALIDATING", "BUILDING", "TESTING", "GOVERNANCE_CHECK", "CI_FAILED"];
  if (midStages.includes(record.stage) && canTransition(record.stage, "REPAIR_REQUIRED")) {
    const repaired = transitionLifecycle({
      previous: record,
      next: "REPAIR_REQUIRED",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt: record.attempt + 1,
      worker_id: record.worker_id,
      action_fingerprint: fingerprint,
      allowed_paths: admission.allowed_paths,
      reservation_id: record.reservation_id,
      reason_code: "RECOVERY_UNSAFE",
      detail: "resume mid-cycle via REPAIR_REQUIRED on same work_id",
      evidence_ref: evidence(input.work_id, input.command_id, "recovery_repair", { from: record.stage }),
      recorded_at: now(),
    });
    if (repaired.ok) record = repaired.record;
  }

  const worker = deps.worker ?? selectEngineeringWorker({
    preferred_worker_id: deps.preferred_worker_id,
    exclude_worker_id: deps.exclude_worker_id,
    extras: deps.extras,
  }) ?? localScopedWorker();

  let repair: EngineeringRepairRequest | null = record.stage === "REPAIR_REQUIRED"
    ? {
        work_id: input.work_id,
        attempt: record.attempt,
        failed_stage: "REPAIR_REQUIRED",
        failed_reason: record.detail,
        affected_files: admission.allowed_paths,
        evidence_refs: [record.evidence_ref],
        previous_attempt: Math.max(0, record.attempt - 1),
        allowed_paths: admission.allowed_paths,
        forbidden_paths: admission.forbidden_paths,
      }
    : null;
  let attempt = record.attempt;
  let skipDispatch = record.stage === "DISPATCHED";
  let completion: EngineeringCompletionResult | null = null;
  let publication: EngineeringPublicationResult | null = null;
  let repairCount = record.stage === "REPAIR_REQUIRED" ? Math.max(1, record.attempt) : 0;
  const hint = input.proposed_writes ?? [];

  while (attempt < maxRepairs) {
    if (!skipDispatch) {
      const dispatched = transitionLifecycle({
        previous: record,
        next: "DISPATCHED",
        work_id: input.work_id,
        command_id: input.command_id,
        attempt,
        worker_id: worker.worker_id,
        action_fingerprint: fingerprint,
        allowed_paths: admission.allowed_paths,
        reservation_id: record.reservation_id,
        reason_code: "ADMITTED",
        detail: `worker=${worker.worker_id} attempt=${attempt}`,
        evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_DISPATCHED", { worker_id: worker.worker_id, attempt, repair: repair !== null }),
        recorded_at: now(),
      });
      if (!dispatched.ok) break;
      record = dispatched.record;
    }
    skipDispatch = false;

    const proposal = worker.propose({
      work_id: input.work_id,
      command_id: input.command_id,
      intent_text: input.intent_text,
      allowed_paths: admission.allowed_paths,
      forbidden_paths: admission.forbidden_paths,
      attempt,
      repair,
      hint_writes: hint,
    });
    evidence(input.work_id, input.command_id, "worker_proposal", {
      worker_id: proposal.worker_id,
      claimed_complete: proposal.claimed_complete === true,
      digest: digestWrites(proposal.proposed_writes),
    });
    if (proposal.claimed_complete) {
      evidence(input.work_id, input.command_id, "WORKER_AUTHORITY_DENIED", { note: "claimed_complete ignored" });
    }

    const proposed = transitionLifecycle({
      previous: record,
      next: "CODE_PROPOSED",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt,
      worker_id: worker.worker_id,
      action_fingerprint: fingerprint,
      allowed_paths: admission.allowed_paths,
      reservation_id: record.reservation_id,
      reason_code: "ADMITTED",
      detail: `proposed ${proposal.proposed_writes.length} path(s)`,
      evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_CODE_PROPOSED", { count: proposal.proposed_writes.length }),
      recorded_at: now(),
    });
    if (!proposed.ok) break;
    record = proposed.record;

    const validating = transitionLifecycle({
      previous: record,
      next: "VALIDATING",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt,
      worker_id: worker.worker_id,
      action_fingerprint: fingerprint,
      allowed_paths: admission.allowed_paths,
      reservation_id: record.reservation_id,
      reason_code: "ADMITTED",
      detail: "DNA OS validating worker proposal",
      evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_VALIDATING"),
      recorded_at: now(),
    });
    if (!validating.ok) break;
    record = validating.record;

    const pre = proposalValid(admission.allowed_paths, admission.forbidden_paths, proposal.proposed_writes);
    if (!pre.ok) {
      repairCount += 1;
      repair = {
        work_id: input.work_id,
        attempt: attempt + 1,
        failed_stage: "VALIDATING",
        failed_reason: `${pre.reason_code}: ${pre.detail}`,
        affected_files: pre.files,
        evidence_refs: [record.evidence_ref],
        previous_attempt: attempt,
        allowed_paths: admission.allowed_paths,
        forbidden_paths: admission.forbidden_paths,
      };
      const nextStage = attempt + 1 >= maxRepairs ? "FAILED" : "REPAIR_REQUIRED";
      const repaired = transitionLifecycle({
        previous: record,
        next: nextStage,
        work_id: input.work_id,
        command_id: input.command_id,
        attempt: nextStage === "FAILED" ? attempt : attempt + 1,
        worker_id: worker.worker_id,
        action_fingerprint: fingerprint,
        allowed_paths: admission.allowed_paths,
        reservation_id: record.reservation_id,
        reason_code: attempt + 1 >= maxRepairs ? "REPAIR_EXHAUSTED" : pre.reason_code,
        detail: repair.failed_reason,
        evidence_ref: evidence(input.work_id, input.command_id, nextStage === "FAILED" ? "repair_exhausted" : "lifecycle_REPAIR_REQUIRED", { repair }),
        recorded_at: now(),
      });
      if (!repaired.ok) break;
      record = repaired.record;
      if (nextStage === "FAILED") {
        persistScopeLock({ work_id: input.work_id, allowed_paths: admission.allowed_paths, active: false, recorded_at: now() });
        return terminal("FAILED", "REPAIR_EXHAUSTED", repair.failed_reason, {
          work_id: input.work_id, command_id: input.command_id, worker_id: worker.worker_id, attempt, lifecycle: record, repair_count: repairCount,
        });
      }
      attempt += 1;
      continue;
    }

    const building = transitionLifecycle({
      previous: record,
      next: "BUILDING",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt,
      worker_id: worker.worker_id,
      action_fingerprint: fingerprint,
      allowed_paths: admission.allowed_paths,
      reservation_id: record.reservation_id,
      reason_code: "ADMITTED",
      detail: "completeEngineeringWork",
      evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_BUILDING"),
      recorded_at: now(),
    });
    if (!building.ok) break;
    record = building.record;

    completion = await completeEngineeringWork({
      command_id: input.command_id,
      work_id: input.work_id,
      intent_text: input.intent_text,
      payload: input.payload,
      checkout_root: input.checkout_root,
      selected_capability_id: input.selected_capability_id,
      proposed_writes: proposal.proposed_writes,
    });

    const testing = transitionLifecycle({
      previous: record,
      next: "TESTING",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt,
      worker_id: worker.worker_id,
      action_fingerprint: fingerprint,
      allowed_paths: admission.allowed_paths,
      reservation_id: completion.lineage.reservation_id,
      reason_code: completion.reason_code,
      detail: completion.detail,
      evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_TESTING", { status: completion.status }),
      recorded_at: now(),
    });
    if (!testing.ok) break;
    record = testing.record;

    const gov = transitionLifecycle({
      previous: record,
      next: "GOVERNANCE_CHECK",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt,
      worker_id: worker.worker_id,
      action_fingerprint: fingerprint,
      allowed_paths: admission.allowed_paths,
      reservation_id: completion.lineage.reservation_id,
      reason_code: completion.result_admission.decision === "ALLOW" ? "ADMITTED" : completion.reason_code,
      detail: `admission=${completion.result_admission.decision}`,
      evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_GOVERNANCE_CHECK", { decision: completion.result_admission.decision }),
      recorded_at: now(),
    });
    if (!gov.ok) break;
    record = gov.record;

    if (completion.status !== "VERIFIED" || completion.result_admission.decision !== "ALLOW") {
      repairCount += 1;
      repair = {
        work_id: input.work_id,
        attempt: attempt + 1,
        failed_stage: "GOVERNANCE_CHECK",
        failed_reason: `${completion.reason_code}: ${completion.detail}`,
        affected_files: completion.manifest?.changed_paths ?? admission.allowed_paths,
        evidence_refs: [record.evidence_ref],
        previous_attempt: attempt,
        allowed_paths: admission.allowed_paths,
        forbidden_paths: admission.forbidden_paths,
      };
      const nextStage = attempt + 1 >= maxRepairs ? "FAILED" : "REPAIR_REQUIRED";
      const repaired = transitionLifecycle({
        previous: record,
        next: nextStage,
        work_id: input.work_id,
        command_id: input.command_id,
        attempt: nextStage === "FAILED" ? attempt : attempt + 1,
        worker_id: worker.worker_id,
        action_fingerprint: fingerprint,
        allowed_paths: admission.allowed_paths,
        reservation_id: completion.lineage.reservation_id,
        reason_code: attempt + 1 >= maxRepairs ? "REPAIR_EXHAUSTED" : completion.reason_code,
        detail: repair.failed_reason,
        evidence_ref: evidence(input.work_id, input.command_id, nextStage, { repair }),
        recorded_at: now(),
      });
      if (!repaired.ok) break;
      record = repaired.record;
      if (nextStage === "FAILED") {
        persistScopeLock({ work_id: input.work_id, allowed_paths: admission.allowed_paths, active: false, recorded_at: now() });
        return terminal("FAILED", "REPAIR_EXHAUSTED", repair.failed_reason, {
          work_id: input.work_id, command_id: input.command_id, worker_id: worker.worker_id, attempt, lifecycle: record, completion, repair_count: repairCount,
        });
      }
      attempt += 1;
      continue;
    }

    const ready = transitionLifecycle({
      previous: record,
      next: "READY_TO_PUBLISH",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt,
      worker_id: worker.worker_id,
      action_fingerprint: fingerprint,
      allowed_paths: admission.allowed_paths,
      reservation_id: completion.lineage.reservation_id,
      reason_code: "ADMITTED",
      detail: "DNA OS completion VERIFIED",
      evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_READY_TO_PUBLISH"),
      recorded_at: now(),
    });
    if (!ready.ok) break;
    record = ready.record;

    const publishGate = mayProceedToPublish({ stage: record.stage, completion, worker_claimed_complete: proposal.claimed_complete === true });
    if (!publishGate.allow) {
      persistScopeLock({ work_id: input.work_id, allowed_paths: admission.allowed_paths, active: false, recorded_at: now() });
      const blocked = transitionLifecycle({
        previous: record,
        next: "BLOCKED",
        work_id: input.work_id,
        command_id: input.command_id,
        attempt,
        worker_id: worker.worker_id,
        action_fingerprint: fingerprint,
        allowed_paths: admission.allowed_paths,
        reservation_id: completion.lineage.reservation_id,
        reason_code: "WORKER_AUTHORITY_DENIED",
        detail: publishGate.detail,
        evidence_ref: evidence(input.work_id, input.command_id, "publish_gate_denied", { detail: publishGate.detail }),
        recorded_at: now(),
      });
      return terminal("BLOCKED", "WORKER_AUTHORITY_DENIED", publishGate.detail, {
        work_id: input.work_id, command_id: input.command_id, worker_id: worker.worker_id, attempt, lifecycle: blocked.ok ? blocked.record : record, completion, repair_count: repairCount,
      });
    }

    if (deps.skip_publish) {
      persistScopeLock({ work_id: input.work_id, allowed_paths: admission.allowed_paths, active: false, recorded_at: now() });
      return terminal("BLOCKED", "GITHUB_PUBLISH_BLOCKED", "skip_publish test seam — registry not written", {
        work_id: input.work_id, command_id: input.command_id, worker_id: worker.worker_id, attempt, lifecycle: record, completion, repair_count: repairCount,
      });
    }

    const publishing = transitionLifecycle({
      previous: record,
      next: "PUBLISHING",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt,
      worker_id: worker.worker_id,
      action_fingerprint: fingerprint,
      allowed_paths: admission.allowed_paths,
      reservation_id: completion.lineage.reservation_id,
      reason_code: "ADMITTED",
      detail: "publishEngineeringSource",
      evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_PUBLISHING"),
      recorded_at: now(),
    });
    if (!publishing.ok) break;
    record = publishing.record;

    publication = await publishEngineeringSource({
      completion,
      checkout_root: input.checkout_root,
      deps: deps.publish,
    });
    const sha = publication.lineage.dna_os_commit_sha;
    const remote = publication.lineage.post_publish_remote_sha;
    const shaMatch = publication.status === "VERIFIED" && Boolean(sha && remote && sha === remote);

    const remoteStage = transitionLifecycle({
      previous: record,
      next: shaMatch ? "REMOTE_VERIFICATION" : "BLOCKED",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt,
      worker_id: worker.worker_id,
      action_fingerprint: fingerprint,
      allowed_paths: admission.allowed_paths,
      reservation_id: completion.lineage.reservation_id,
      reason_code: shaMatch ? "ADMITTED" : publication.reason_code,
      detail: publication.detail,
      evidence_ref: evidence(input.work_id, input.command_id, shaMatch ? "lifecycle_REMOTE_VERIFICATION" : "github_publish_blocked", {
        sha, remote, status: publication.status,
      }),
      recorded_at: now(),
    });
    if (!remoteStage.ok) break;
    record = remoteStage.record;
    if (!shaMatch) {
      persistScopeLock({ work_id: input.work_id, allowed_paths: admission.allowed_paths, active: false, recorded_at: now() });
      return terminal("BLOCKED", publication.reason_code, publication.detail, {
        work_id: input.work_id, command_id: input.command_id, worker_id: worker.worker_id, attempt, lifecycle: record, completion, publication, repair_count: repairCount,
      });
    }

    const dest = resolveGithubDestination({
      repository_id: completion.lineage.repository_id ?? "",
      checkout_root: input.checkout_root,
    });
    const pointer = {
      work_id: input.work_id,
      command_id: input.command_id,
      dna_os_commit_sha: sha,
      remote_sha: remote,
      changed_paths: completion.manifest?.changed_paths ?? [],
      recorded_at: now(),
      github_owner: dest.ok ? dest.destination.owner : publication.lineage.github_owner ?? undefined,
      github_repository: dest.ok ? dest.destination.repository : publication.lineage.github_repository ?? undefined,
      publish_branch: dest.ok ? dest.destination.publish_branch : publication.lineage.publish_branch ?? undefined,
      connection_id: dest.ok ? dest.destination.connection_id : undefined,
      manifest_id: completion.manifest?.manifest_id,
    };
    persistPublicationPointer(pointer);
    const permanence = await applyPermanenceThenRegistry({
      input, deps, record, fingerprint, admissionPaths: admission.allowed_paths, workerId: worker.worker_id, attempt, repairCount, completion, publication, pointer, maxRepairs,
    });
    if (permanence.kind === "repair") {
      repairCount += 1;
      repair = {
        work_id: input.work_id,
        attempt: attempt + 1,
        failed_stage: "CI_FAILED",
        failed_reason: permanence.proof.detail,
        affected_files: pointer.changed_paths,
        evidence_refs: [record.evidence_ref],
        previous_attempt: attempt,
        allowed_paths: admission.allowed_paths,
        forbidden_paths: admission.forbidden_paths,
      };
      const nextStage = attempt + 1 >= maxRepairs ? "FAILED" : "REPAIR_REQUIRED";
      const repaired = transitionLifecycle({
        previous: permanence.record,
        next: nextStage,
        work_id: input.work_id,
        command_id: input.command_id,
        attempt: nextStage === "FAILED" ? attempt : attempt + 1,
        worker_id: worker.worker_id,
        action_fingerprint: fingerprint,
        allowed_paths: admission.allowed_paths,
        reservation_id: completion.lineage.reservation_id,
        reason_code: nextStage === "FAILED" ? "REPAIR_EXHAUSTED" : "CI_FAILED",
        detail: repair.failed_reason,
        evidence_ref: evidence(input.work_id, input.command_id, nextStage, { repair, github_proof: permanence.proof }),
        recorded_at: now(),
      });
      if (!repaired.ok) break;
      record = repaired.record;
      if (nextStage === "FAILED") {
        return terminal("FAILED", "REPAIR_EXHAUSTED", repair.failed_reason, {
          work_id: input.work_id, command_id: input.command_id, worker_id: worker.worker_id, attempt, lifecycle: record, completion, publication, repair_count: repairCount, github_proof: permanence.proof,
        });
      }
      attempt += 1;
      continue;
    }
    return permanence.result;
  }

  persistScopeLock({ work_id: input.work_id, allowed_paths: admission.allowed_paths, active: false, recorded_at: now() });
  return terminal("FAILED", "REPAIR_EXHAUSTED", "loop ended without VERIFIED", {
    work_id: input.work_id, command_id: input.command_id, worker_id: worker.worker_id, attempt, lifecycle: record, completion, publication, repair_count: repairCount,
  });
  } finally {
    persistScopeLock({ work_id: input.work_id, allowed_paths: admission.allowed_paths, active: false, recorded_at: now() });
  }
}

async function applyPermanenceThenRegistry(args: {
  readonly input: {
    readonly command_id: string;
    readonly work_id: string;
    readonly checkout_root: string;
  };
  readonly deps: EngineeringLoopDeps;
  readonly record: EngineeringLifecycleRecord;
  readonly fingerprint: string;
  readonly admissionPaths: readonly string[];
  readonly workerId: string | null;
  readonly attempt: number;
  readonly repairCount: number;
  readonly completion: EngineeringCompletionResult | null;
  readonly publication: EngineeringPublicationResult;
  readonly pointer: {
    readonly work_id: string;
    readonly command_id: string;
    readonly dna_os_commit_sha: string;
    readonly remote_sha: string;
    readonly changed_paths: readonly string[];
    readonly recorded_at: string;
    readonly github_owner?: string;
    readonly github_repository?: string;
    readonly publish_branch?: string;
    readonly connection_id?: string;
    readonly manifest_id?: string;
  };
  readonly maxRepairs: number;
}): Promise<{ readonly kind: "done"; readonly result: EngineeringLoopResult } | { readonly kind: "repair"; readonly proof: GithubPermanenceProof; readonly record: EngineeringLifecycleRecord }> {
  const { input, deps, fingerprint, admissionPaths, workerId, attempt, repairCount, completion, publication, pointer } = args;
  let record = args.record;
  if (!pointer.github_owner || !pointer.github_repository || !pointer.publish_branch || !pointer.connection_id || !pointer.manifest_id) {
    return { kind: "done", result: terminal("BLOCKED", "RECOVERY_UNSAFE", "publication pointer missing GitHub destination", { work_id: input.work_id, command_id: input.command_id, lifecycle: record, completion, publication, repair_count: repairCount }) };
  }
  const dest = resolveGithubDestination({
    repository_id: completion?.lineage.repository_id ?? publication.lineage.repository_id ?? "",
    checkout_root: input.checkout_root,
  });
  const permanenceInput: GithubPermanenceInput = {
    work_id: input.work_id,
    command_id: pointer.command_id,
    manifest_id: pointer.manifest_id,
    admission: "ALLOW",
    integration: "INTEGRATED",
    expected_sha: pointer.dna_os_commit_sha,
    expected_files: pointer.changed_paths,
    github_owner: pointer.github_owner,
    github_repository: pointer.github_repository,
    publish_branch: pointer.publish_branch,
    connection_id: pointer.connection_id,
    registered_owner: dest.ok ? dest.destination.owner : pointer.github_owner,
    registered_repository: dest.ok ? dest.destination.repository : pointer.github_repository,
    registered_branch: dest.ok ? dest.destination.publish_branch : pointer.publish_branch,
  };
  const verify = deps.verifyPermanence ?? ((row: GithubPermanenceInput) => verifyGithubPublicationPermanence(row, deps.permanence));
  const github_proof = await verify(permanenceInput);
  evidence(input.work_id, input.command_id, "github_permanence", {
    status: github_proof.status,
    reason_code: github_proof.reason_code,
    lineage_verified: github_proof.lineage_verified,
    expected_files_verified: github_proof.expected_files_verified,
    ci_required: github_proof.ci_required,
    ci_run_ids: github_proof.ci_run_ids,
    remote_sha: github_proof.remote_sha,
  });

  if (github_proof.status === "REMOTE_MISMATCH") {
    const blocked = transitionLifecycle({
      previous: record,
      next: "BLOCKED",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt,
      worker_id: workerId,
      action_fingerprint: fingerprint,
      allowed_paths: admissionPaths,
      reservation_id: record.reservation_id,
      reason_code: github_proof.reason_code,
      detail: github_proof.detail,
      evidence_ref: evidence(input.work_id, input.command_id, "REMOTE_MISMATCH", { github_proof }),
      recorded_at: now(),
    });
    return { kind: "done", result: terminal("BLOCKED", github_proof.reason_code, github_proof.detail, { work_id: input.work_id, command_id: input.command_id, worker_id: workerId, attempt, lifecycle: blocked.ok ? blocked.record : record, completion, publication, repair_count: repairCount, github_proof }) };
  }

  if (github_proof.status === "CI_PENDING") {
    const pending = record.stage === "CI_PENDING" ? { ok: true as const, record } : transitionLifecycle({
      previous: record,
      next: "CI_PENDING",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt,
      worker_id: workerId,
      action_fingerprint: fingerprint,
      allowed_paths: admissionPaths,
      reservation_id: record.reservation_id,
      reason_code: "CI_PENDING",
      detail: github_proof.detail,
      evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_CI_PENDING", { github_proof }),
      recorded_at: now(),
    });
    if (!pending.ok) return { kind: "done", result: terminal("FAILED", pending.reason_code, pending.detail, { work_id: input.work_id, command_id: input.command_id, lifecycle: record, github_proof, repair_count: repairCount }) };
    return { kind: "done", result: terminal("CI_PENDING", "CI_PENDING", github_proof.detail, { work_id: input.work_id, command_id: input.command_id, worker_id: workerId, attempt, lifecycle: pending.record, completion, publication, repair_count: repairCount, github_proof }) };
  }

  if (github_proof.status === "CI_FAILED") {
    const failed = record.stage === "CI_FAILED" ? { ok: true as const, record } : transitionLifecycle({
      previous: record,
      next: "CI_FAILED",
      work_id: input.work_id,
      command_id: input.command_id,
      attempt,
      worker_id: workerId,
      action_fingerprint: fingerprint,
      allowed_paths: admissionPaths,
      reservation_id: record.reservation_id,
      reason_code: "CI_FAILED",
      detail: github_proof.detail,
      evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_CI_FAILED", { github_proof }),
      recorded_at: now(),
    });
    if (!failed.ok) return { kind: "done", result: terminal("FAILED", failed.reason_code, failed.detail, { work_id: input.work_id, command_id: input.command_id, lifecycle: record, github_proof, repair_count: repairCount }) };
    return { kind: "repair", proof: github_proof, record: failed.record };
  }

  const ciVerified = record.stage === "CI_VERIFIED" ? { ok: true as const, record } : transitionLifecycle({
    previous: record,
    next: "CI_VERIFIED",
    work_id: input.work_id,
    command_id: input.command_id,
    attempt,
    worker_id: workerId,
    action_fingerprint: fingerprint,
    allowed_paths: admissionPaths,
    reservation_id: record.reservation_id,
    reason_code: "ADMITTED",
    detail: github_proof.detail,
    evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_CI_VERIFIED", { github_proof }),
    recorded_at: now(),
  });
  if (!ciVerified.ok) return { kind: "done", result: terminal("FAILED", ciVerified.reason_code, ciVerified.detail, { work_id: input.work_id, command_id: input.command_id, lifecycle: record, github_proof, repair_count: repairCount }) };
  record = ciVerified.record;

  const registryStage = transitionLifecycle({
    previous: record,
    next: "REGISTRY_UPDATE",
    work_id: input.work_id,
    command_id: input.command_id,
    attempt,
    worker_id: workerId,
    action_fingerprint: fingerprint,
    allowed_paths: admissionPaths,
    reservation_id: record.reservation_id,
    reason_code: "ADMITTED",
    detail: "registry after GitHub permanence CI_VERIFIED",
    evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_REGISTRY_UPDATE"),
    recorded_at: now(),
  });
  if (!registryStage.ok) return { kind: "done", result: terminal("FAILED", registryStage.reason_code, registryStage.detail, { work_id: input.work_id, command_id: input.command_id, lifecycle: record, github_proof, repair_count: repairCount }) };
  return {
    kind: "done",
    result: await finishRegistry({
      input, deps, record: registryStage.record, admissionPaths, workerId, attempt, repairCount, completion, publication, pointer, github_proof,
    }),
  };
}

async function finishRegistry(args: {
  readonly input: {
    readonly command_id: string;
    readonly work_id: string;
  };
  readonly deps: EngineeringLoopDeps;
  readonly record: EngineeringLifecycleRecord;
  readonly admissionPaths: readonly string[];
  readonly workerId: string | null;
  readonly attempt: number;
  readonly repairCount: number;
  readonly completion: EngineeringCompletionResult | null;
  readonly publication: EngineeringPublicationResult | null;
  readonly pointer: {
    readonly work_id: string;
    readonly command_id: string;
    readonly dna_os_commit_sha: string;
    readonly remote_sha: string;
    readonly changed_paths: readonly string[];
    readonly recorded_at: string;
  };
  readonly github_proof: GithubPermanenceProof | null;
}): Promise<EngineeringLoopResult> {
  const { input, deps, record, admissionPaths, workerId, attempt, repairCount, completion, publication, pointer, github_proof } = args;
  const registryGate = mayProceedToRegistry({ stage: record.stage, publication, github_proof });
  const row = {
    work_id: input.work_id,
    command_id: input.command_id,
    capability_id: "engineering-runtime",
    changed_paths: pointer.changed_paths,
    dna_os_commit_sha: pointer.dna_os_commit_sha,
    remote_sha: pointer.remote_sha,
    recorded_at: now(),
  };
  const write = registryGate.allow
    ? (deps.registryWrite ? deps.registryWrite(row) : { ok: true as const, path: persistVerifiedCapability(row) })
    : { ok: false as const, detail: registryGate.detail };
  if (!write.ok) {
    evidence(input.work_id, input.command_id, "REGISTRY_WRITE_FAILED", { github_published: true, sha: pointer.dna_os_commit_sha, remote: pointer.remote_sha, detail: write.detail, recoverable: true });
    persistScopeLock({ work_id: input.work_id, allowed_paths: admissionPaths, active: false, recorded_at: now() });
    return terminal("BLOCKED", "REGISTRY_WRITE_FAILED", write.detail, {
      work_id: input.work_id, command_id: input.command_id, worker_id: workerId, attempt, lifecycle: record, completion, publication, registry_written: false, repair_count: repairCount, github_proof,
    });
  }

  const verified = transitionLifecycle({
    previous: record,
    next: "VERIFIED",
    work_id: input.work_id,
    command_id: input.command_id,
    attempt,
    worker_id: workerId,
    action_fingerprint: record.action_fingerprint,
    allowed_paths: admissionPaths,
    reservation_id: record.reservation_id,
    reason_code: "ADMITTED",
    detail: `verified commit ${pointer.dna_os_commit_sha}`,
    evidence_ref: evidence(input.work_id, input.command_id, "lifecycle_VERIFIED", { sha: pointer.dna_os_commit_sha, remote: pointer.remote_sha, worker_id: workerId }),
    recorded_at: now(),
  });
  persistScopeLock({ work_id: input.work_id, allowed_paths: admissionPaths, active: false, recorded_at: now() });
  if (!verified.ok) return terminal("FAILED", verified.reason_code, verified.detail, { work_id: input.work_id, command_id: input.command_id, lifecycle: record, completion, publication, repair_count: repairCount, github_proof });
  const workspace_cleanup = await cleanupAfterEngineeringVerified(input.work_id, input.command_id);
  return terminal("VERIFIED", "ADMITTED", verified.record.detail, {
    work_id: input.work_id,
    command_id: input.command_id,
    worker_id: workerId,
    attempt,
    lifecycle: verified.record,
    completion,
    publication,
    registry_written: true,
    repair_count: repairCount,
    github_proof,
    workspace_cleanup,
  });
}
