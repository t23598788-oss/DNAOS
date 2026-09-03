/**
 * หน้าที่: §9 — make RESOURCE availability produce events, so work parked as
 * WAITING_FOR_RESOURCE resumes on its own instead of waiting for an Owner to
 * type "try again".
 *
 * DETERMINISTIC EVIDENCE ONLY. Availability is decided from two facts that
 * cost nothing to read:
 *   1. does the worker's executable resolve?  (`../agent-host/#resolveWorker`)
 *   2. has the credential evidence CHANGED since this worker last failed?
 *      (a digest of `credentials/registry/`'s own reference journal — the
 *      authorized mechanism's own record, never a secret value)
 *
 * IT NEVER LAUNCHES AN AGENT TO FIND OUT. Probing by launching would mean
 * spending a real provider call on every tick, and — worse — a provider that
 * fails on authentication would be retried forever. A worker that failed
 * stays unavailable until the credential evidence it failed against is no
 * longer the current one. That is what makes this loop-safe.
 *
 * Input: none (reads resolver + credential-reference evidence).
 * Output: `resourceAvailability`, `allResourceAvailability`,
 * `recordResourceFailure`, `pollResourceAvailability`.
 * Dependency ที่อนุญาต: ../agent-host/contract.ts, ../scheduler/contract.ts,
 * ../work-continuation/contract.ts, ../agent-gateway/contract.ts,
 * ./events.ts, ./gateway.ts, node built-ins.
 * สิ่งที่ห้ามแตะ: never read, log or persist a credential VALUE — only a
 * digest of the reference journal. Never mark a worker available because
 * time passed; only changed evidence may do that.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { resolveWorker } from "../agent-host/contract";
import { REASONING_CAPABLE_PROVIDERS } from "../scheduler/contract";
import { currentWaiting } from "../work-continuation/contract";
import { saveEvidence, loadEvidenceForTask } from "../agent-gateway/contract";
import { emitSystemEvent } from "./events";
import { resumeWorkOnDependency } from "./gateway";

const SOURCE_MARKER = "control/owner-backbone/resource-availability.ts";
const REPO_ROOT = resolvePath(new URL("../..", import.meta.url).pathname);

/** The authorized credential mechanism's OWN journal. A digest of it, never its contents. */
const CREDENTIAL_REFERENCE_JOURNAL = join(REPO_ROOT, "credentials/registry/data/api-credential-references.jsonl");

/** The dependency key that WAITING_FOR_RESOURCE work is parked on. One spelling, shared with `./gateway.ts`. */
export const RESOURCE_DEPENDENCY = { namespace: "resource", value: "worker:reasoning:available" } as const;

/**
 * A digest of the credential EVIDENCE — the reference journal's bytes plus
 * its size. No secret is read: this journal holds references (which Keychain
 * item, which account), which is exactly the level at which "has the
 * credential situation changed?" can be answered.
 */
function credentialEvidenceDigest(): string {
  if (!existsSync(CREDENTIAL_REFERENCE_JOURNAL)) return "no-credential-journal";
  try {
    const bytes = readFileSync(CREDENTIAL_REFERENCE_JOURNAL);
    const size = statSync(CREDENTIAL_REFERENCE_JOURNAL).size;
    return createHash("sha256").update(bytes).update(String(size)).digest("hex").slice(0, 32);
  } catch {
    // Unreadable is UNKNOWN, and UNKNOWN never becomes "changed".
    return "credential-journal-unreadable";
  }
}

interface FailureRow {
  readonly worker_kind: string;
  readonly reason: string;
  readonly credential_digest: string;
  readonly executable: string | null;
  readonly at: string;
}

function taskIdFor(workerKind: string): string {
  return `resource:${workerKind}`;
}

/**
 * Record that a worker proved unavailable, together with the credential
 * evidence it failed AGAINST. That pairing is what lets availability be
 * re-derived later without launching anything.
 */
export function recordResourceFailure(workerKind: string, reason: string): FailureRow {
  const resolution = resolveWorker(workerKind as never) as { ok: boolean; worker?: { executable: string } };
  const row: FailureRow = {
    worker_kind: workerKind,
    reason: reason.slice(0, 300),
    credential_digest: credentialEvidenceDigest(),
    executable: resolution.ok ? resolution.worker?.executable ?? null : null,
    at: new Date().toISOString(),
  };
  saveEvidence({
    evidence_id: `resource-failure-${workerKind}-${Date.now()}`,
    task_id: taskIdFor(workerKind),
    kind: "execution_output",
    source: SOURCE_MARKER,
    recorded_at: row.at,
    payload: row,
  });
  return row;
}

function lastFailure(workerKind: string): FailureRow | null {
  const rows = loadEvidenceForTask(taskIdFor(workerKind))
    .filter((r) => r.source === SOURCE_MARKER)
    .map((r) => r.payload as FailureRow)
    .sort((a, b) => a.at.localeCompare(b.at));
  return rows.length > 0 ? rows[rows.length - 1] : null;
}

export interface ResourceAvailability {
  readonly worker_kind: string;
  readonly available: boolean;
  readonly executable_resolves: boolean;
  readonly credential_digest: string;
  readonly last_failure_at: string | null;
  readonly reason: string;
}

export function resourceAvailability(workerKind: string): ResourceAvailability {
  const resolution = resolveWorker(workerKind as never) as { ok: boolean; reason?: string };
  const digest = credentialEvidenceDigest();
  const failure = lastFailure(workerKind);

  if (!resolution.ok) {
    return { worker_kind: workerKind, available: false, executable_resolves: false, credential_digest: digest, last_failure_at: failure?.at ?? null, reason: `executable does not resolve: ${resolution.reason ?? "UNRESOLVED"}` };
  }
  if (failure === null) {
    return { worker_kind: workerKind, available: true, executable_resolves: true, credential_digest: digest, last_failure_at: null, reason: "executable resolves and this worker has no recorded failure" };
  }
  if (failure.credential_digest !== digest) {
    return { worker_kind: workerKind, available: true, executable_resolves: true, credential_digest: digest, last_failure_at: failure.at, reason: `credential evidence changed since the failure at ${failure.at} (${failure.credential_digest} -> ${digest})` };
  }
  return { worker_kind: workerKind, available: false, executable_resolves: true, credential_digest: digest, last_failure_at: failure.at, reason: `failed at ${failure.at} (${failure.reason.slice(0, 80)}) and the credential evidence is unchanged — nothing has happened that could make it work` };
}

export function allResourceAvailability(): readonly ResourceAvailability[] {
  return REASONING_CAPABLE_PROVIDERS.map((kind) => resourceAvailability(kind));
}

export interface ResourcePollResult {
  readonly available_kinds: readonly string[];
  readonly waiting_work_ids: readonly string[];
  readonly resumed_work_ids: readonly string[];
  readonly emitted: boolean;
  readonly detail: string;
}

/**
 * One supervisor tick for resources. Emits and resumes ONLY on a real
 * transition: a resource is available AND work is actually parked waiting
 * for one. A tick that finds nothing to do is silent.
 */
export async function pollResourceAvailability(): Promise<ResourcePollResult> {
  const availability = allResourceAvailability();
  const availableKinds = availability.filter((a) => a.available).map((a) => a.worker_kind);

  const waiting = currentWaiting()
    .filter((row) => row.status === "WAITING_FOR_RESOURCE" && row.blocked_on.some((k) => k.includes(RESOURCE_DEPENDENCY.value)))
    .map((row) => row.work_id);

  if (availableKinds.length === 0 || waiting.length === 0) {
    return {
      available_kinds: availableKinds, waiting_work_ids: waiting, resumed_work_ids: [], emitted: false,
      detail: availableKinds.length === 0
        ? `no reasoning resource is available: ${availability.map((a) => `${a.worker_kind}(${a.reason.slice(0, 40)})`).join("; ")}`
        : "resources are available but no work is parked waiting for one",
    };
  }

  await emitSystemEvent({
    command_id: null, work_id: null, incident_id: null,
    event_type: "RESOURCE_AVAILABLE", state: availableKinds.join(","),
    source: SOURCE_MARKER, resource_ids: availableKinds, capability_ids: ["agent-host", "scheduler"],
    evidence_refs: availability.filter((a) => a.available).map((a) => `credential-evidence:${a.credential_digest}`),
    next_action: `resume ${waiting.length} work item(s) parked on ${RESOURCE_DEPENDENCY.value}`,
  });

  const resumed: string[] = [];
  for (const workId of waiting) {
    const outcome = await resumeWorkOnDependency({
      work_id: workId,
      namespace: RESOURCE_DEPENDENCY.namespace,
      value: RESOURCE_DEPENDENCY.value,
      source: SOURCE_MARKER,
      evidence_ref: `resource-available:${availableKinds.join(",")}`,
    });
    if (outcome.resumed) resumed.push(workId);
  }

  return { available_kinds: availableKinds, waiting_work_ids: waiting, resumed_work_ids: resumed, emitted: true, detail: `${availableKinds.join(", ")} available; resumed ${resumed.length}/${waiting.length}` };
}
