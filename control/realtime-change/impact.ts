/**
 * หน้าที่: turns a raw `ChangeEvent` into a `ChangeImpactContext`, and decides
 * — deterministically — which active execution, if any, is entitled to be
 * interrupted (Owner, 2026-08-26).
 *
 * EVERY LOOKUP GOES THROUGH SOMETHING THAT ALREADY EXISTED: `./path-resolution.ts`
 * for identity, `../work-coordination/`'s `listWriteLocks`/`scopesOverlap` for
 * the overlap test, `../agent-host/`'s `listActiveLaunches` for running
 * executions, `../system-read-paths/` for task state, evidence and Blueprint
 * claims. Nothing here re-implements any of them.
 *
 * OVERLAP IS PROVEN, NOT GUESSED. An execution is interrupted only when
 * `scopesOverlap()` says its declared write scope contains the changed path.
 * Similar names, same folder-ish, "probably related" — none of those reach the
 * interrupt path. That is what keeps an unrelated agent from being woken.
 *
 * Input: a `ChangeEvent` + an optional `RegistryStore`.
 * Output: `ChangeImpactContext`, and `findRelatedWork()`'s decision.
 * Dependency ที่อนุญาต: ./types.ts, ./path-resolution.ts,
 * ../work-coordination/contract.ts, ../agent-host/contract.ts,
 * ../agent-gateway/contract.ts, ../system-read-paths/contract.ts.
 * สิ่งที่ห้ามแตะ:
 * - ห้าม interrupt โดยไม่มีหลักฐาน overlap.
 * - ห้ามแก้ raw facts บน ChangeEvent.
 * - ห้ามตัดสิน policy — ไฟล์นี้ resolve และรายงานเท่านั้น.
 */

import type { ChangeEvent, ChangeImpactContext, InterruptSignal } from "./types";
import { resolvePath } from "./path-resolution";
import { listWriteLocks, scopesOverlap, normalizeScopePath } from "../work-coordination/contract";
import { listActiveLaunches } from "../agent-host/contract";
import { getTask, loadEvidenceForTask } from "../agent-gateway/contract";
import { compareSourceToBlueprint } from "../system-read-paths/contract";
import type { RegistryStore } from "../../software/registry-database/contract";

declare const require: any;
const crypto = require("node:crypto");

export interface RelatedWork {
  write_lock: { holder: string; scope_path: string; evidence: readonly string[] } | null;
  active_launch: { launch_id: string; pid: number; allowed_workspace_dir: string } | null;
  overlap_evidence: readonly string[];
}

/**
 * Which running work, if any, provably covers this path. Returns nulls when
 * nothing overlaps — the correct answer for a change nobody is working on.
 */
export function findRelatedWork(changedRepoRelativePath: string): RelatedWork {
  // normalizeScopePath refuses a path it cannot reason about (empty, "/", or
  // containing ".."). A refused path can never be shown to overlap anything, so
  // it produces no interrupt — the fail-closed direction.
  const changed = normalizeScopePath(changedRepoRelativePath);
  const overlapEvidence: string[] = [];
  if (changed === null) {
    return { write_lock: null, active_launch: null, overlap_evidence: [`normalizeScopePath refused "${changedRepoRelativePath}" — no overlap can be proven, so no interrupt is issued`] };
  }

  let writeLock: RelatedWork["write_lock"] = null;
  for (const lock of listWriteLocks()) {
    const record = lock as unknown as Record<string, unknown>;
    const scopePath = String(record.scope_path ?? record.path ?? "");
    if (scopePath.length === 0) continue;
    const normalizedScope = normalizeScopePath(scopePath);
    if (normalizedScope !== null && scopesOverlap(normalizedScope, changed)) {
      const holder = String(record.holder_id ?? record.holder ?? record.claim_id ?? "unknown-holder");
      writeLock = { holder, scope_path: scopePath, evidence: [`control/work-coordination/contract.ts#listWriteLocks holder=${holder}`, `scopesOverlap("${scopePath}", "${changedRepoRelativePath}")=true`] };
      overlapEvidence.push(...writeLock.evidence);
      break;
    }
  }

  let activeLaunch: RelatedWork["active_launch"] = null;
  for (const launch of listActiveLaunches()) {
    const normalizedWorkspace = normalizeScopePath(launch.allowedWorkspaceDir);
    if (normalizedWorkspace !== null && scopesOverlap(normalizedWorkspace, changed)) {
      activeLaunch = { launch_id: launch.launchId, pid: launch.pid, allowed_workspace_dir: launch.allowedWorkspaceDir };
      overlapEvidence.push(`control/agent-host/contract.ts#listActiveLaunches launch=${launch.launchId}`, `scopesOverlap("${launch.allowedWorkspaceDir}", "${changedRepoRelativePath}")=true`);
      break;
    }
  }

  return { write_lock: writeLock, active_launch: activeLaunch, overlap_evidence: overlapEvidence };
}

export function buildImpactContext(event: ChangeEvent, store: RegistryStore | undefined, taskId: string | null = null): ChangeImpactContext {
  const resolution = resolvePath(event.path, store);
  const related = findRelatedWork(resolution.repo_relative_path);

  let activeTask: ChangeImpactContext["active_task"] = null;
  const evidenceRefs: string[] = [];
  if (taskId) {
    const task = getTask(taskId);
    if (task) {
      activeTask = { task_id: task.task_id, status: task.status, observed_at: task.updated_at, evidence: [`control/agent-gateway/contract.ts#getTask#${task.task_id}`] };
      for (const row of loadEvidenceForTask(taskId)) evidenceRefs.push(`${row.kind}@${row.source}#${row.recorded_at}`);
    }
  }

  // Blueprint claims that cite the changed file — classified, never rewritten.
  const blueprintFindings = compareSourceToBlueprint(resolution.repo_relative_path, null);

  return {
    event_id: event.event_id,
    resolved_at: new Date().toISOString(),
    changed_resource: resolution.resource,
    related_capability: resolution.capability,
    active_task: activeTask,
    active_launch: related.active_launch,
    write_lock: related.write_lock,
    evidence_refs: evidenceRefs,
    affected_documents: [...new Set(blueprintFindings.filter((f) => f.blueprint_document !== null).map((f) => `${f.blueprint_document}#${f.blueprint_section}`))],
    affected_blueprint_claims: blueprintFindings,
    previous_state: activeTask ? `${activeTask.status} @ ${activeTask.observed_at}` : null,
    unresolved_refs: resolution.unresolved,
  };
}

/** Builds the interrupt for a proven overlap. Returns null when nothing overlaps — no target, no interrupt. */
export function buildInterrupt(event: ChangeEvent, related: RelatedWork): InterruptSignal | null {
  const target = related.write_lock
    ? { kind: "WRITE_LOCK_HOLDER" as const, id: related.write_lock.holder, scope_path: related.write_lock.scope_path }
    : related.active_launch
      ? { kind: "ACTIVE_LAUNCH" as const, id: related.active_launch.launch_id, scope_path: related.active_launch.allowed_workspace_dir }
      : null;
  if (!target) return null;
  return {
    interrupt_id: crypto.randomUUID(),
    event_id: event.event_id,
    issued_at: new Date().toISOString(),
    reason: "RESOURCE_CHANGED_UNDER_ACTIVE_WORK",
    overlap_evidence: related.overlap_evidence,
    target,
    authorizes: "NOTHING",
  };
}
