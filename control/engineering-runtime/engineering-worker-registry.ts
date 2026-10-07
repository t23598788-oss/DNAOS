/**
 * หน้าที่: Engineering Worker Registry. DNA OS selects a replaceable
 * coding worker. Workers propose scoped writes; they never admit
 * completion, commit, publish, or register capabilities.
 *
 * Input: Owner-admitted scope + optional repair request.
 * Output: worker id + proposed_writes (untrusted).
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never treat worker claimed_complete as authority.
 * never hardcode a vendor/model as source of truth.
 */

import type { ProposedScopedWrite } from "./types";

export interface EngineeringRepairRequest {
  readonly work_id: string;
  readonly attempt: number;
  readonly failed_stage: string;
  readonly failed_reason: string;
  readonly affected_files: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly previous_attempt: number;
  readonly allowed_paths: readonly string[];
  readonly forbidden_paths: readonly string[];
}

export interface EngineeringWorkerRequest {
  readonly work_id: string;
  readonly command_id: string;
  readonly intent_text: string;
  readonly allowed_paths: readonly string[];
  readonly forbidden_paths: readonly string[];
  readonly attempt: number;
  readonly repair: EngineeringRepairRequest | null;
  readonly hint_writes: readonly ProposedScopedWrite[];
}

export interface EngineeringWorkerProposal {
  readonly worker_id: string;
  readonly proposed_writes: readonly ProposedScopedWrite[];
  /** Ignored by DNA OS. Present only to prove workers cannot self-complete. */
  readonly claimed_complete?: boolean;
}

export interface EngineeringWorker {
  readonly worker_id: string;
  readonly kind: "LOCAL_SCOPED" | "SCRIPTED" | "AGENT_HOST_LOCAL";
  readonly status: "CONNECTED" | "NOT_CONNECTED";
  propose(request: EngineeringWorkerRequest): EngineeringWorkerProposal;
}

function fixtureContent(path: string, workId: string, attempt: number): string {
  const tag = `DNA_OS_AUTONOMOUS ${workId} attempt=${attempt}`;
  if (path.endsWith(".json")) return `${JSON.stringify({ document_type: "engineering_fixture", proof: "autonomous-loop", work_id: workId, attempt }, null, 2)}\n`;
  if (path.endsWith(".md")) return `# ${tag}\n\nAutonomous Engineering Loop worker proposal. Not an admission of completion.\n`;
  return `${tag}\n`;
}

export function localScopedWorker(workerId = "engineering-worker://local-scoped"): EngineeringWorker {
  return {
    worker_id: workerId,
    kind: "LOCAL_SCOPED",
    status: "CONNECTED",
    propose(request) {
      if (request.repair === null && request.hint_writes.length > 0 && request.attempt === 0) {
        return { worker_id: workerId, proposed_writes: request.hint_writes, claimed_complete: false };
      }
      const paths = request.repair ? request.allowed_paths : request.allowed_paths;
      return {
        worker_id: workerId,
        claimed_complete: false,
        proposed_writes: paths.map((relative_path) => ({
          relative_path,
          content: fixtureContent(relative_path, request.work_id, request.attempt),
        })),
      };
    },
  };
}

export function scriptedWorker(workerId: string, attempts: readonly (readonly ProposedScopedWrite[])[]): EngineeringWorker {
  return {
    worker_id: workerId,
    kind: "SCRIPTED",
    status: "CONNECTED",
    propose(request) {
      const writes = attempts[Math.min(request.attempt, attempts.length - 1)] ?? [];
      return { worker_id: workerId, proposed_writes: writes, claimed_complete: request.attempt === 0 };
    },
  };
}

const DEFAULT_WORKERS: EngineeringWorker[] = [
  localScopedWorker(),
  {
    worker_id: "engineering-worker://agent-host-local",
    kind: "AGENT_HOST_LOCAL",
    status: "CONNECTED",
    propose: localScopedWorker("engineering-worker://agent-host-local").propose,
  },
];

export function listEngineeringWorkers(extras: readonly EngineeringWorker[] = []): readonly EngineeringWorker[] {
  return [...extras, ...DEFAULT_WORKERS.filter((row) => !extras.some((extra) => extra.worker_id === row.worker_id))];
}

export function selectEngineeringWorker(input: {
  readonly preferred_worker_id?: string | null;
  readonly exclude_worker_id?: string | null;
  readonly extras?: readonly EngineeringWorker[];
}): EngineeringWorker | null {
  const workers = listEngineeringWorkers(input.extras ?? []).filter((row) => row.status === "CONNECTED");
  if (input.preferred_worker_id) {
    const preferred = workers.find((row) => row.worker_id === input.preferred_worker_id && row.worker_id !== input.exclude_worker_id);
    if (preferred) return preferred;
  }
  return workers.find((row) => row.worker_id !== input.exclude_worker_id) ?? null;
}
