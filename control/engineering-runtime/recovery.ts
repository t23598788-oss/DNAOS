/**
 * หน้าที่: resume an in-flight Engineering lifecycle from persisted
 * evidence after process restart. Never silently restart from REQUESTED.
 *
 * Input: canonical work_id + original command fields.
 * Output: continue runAutonomousEngineeringLoop or report BLOCKED.
 * Dependency ที่อนุญาต: ./lifecycle.ts, ./autonomous-loop.ts.
 * สิ่งที่ห้ามแตะ: never mint a second work_id. never drop reservations.
 */

import { latestLifecycleForWork, TERMINAL_ENGINEERING_STAGES } from "./lifecycle";
import { runAutonomousEngineeringLoop, type EngineeringLoopDeps, type EngineeringLoopResult } from "./autonomous-loop";
import type { ProposedScopedWrite } from "./types";

export function inspectEngineeringRecovery(workId: string): {
  readonly work_id: string;
  readonly stage: string;
  readonly safe_to_resume: boolean;
  readonly detail: string;
} {
  const latest = latestLifecycleForWork(workId);
  if (!latest) {
    return { work_id: workId, stage: "NONE", safe_to_resume: false, detail: "RECOVERY_UNSAFE: no persisted lifecycle" };
  }
  if (TERMINAL_ENGINEERING_STAGES.has(latest.stage)) {
    return { work_id: workId, stage: latest.stage, safe_to_resume: false, detail: `terminal ${latest.stage} — replay, do not restart` };
  }
  if (latest.stage === "READY_TO_PUBLISH" || latest.stage === "PUBLISHING") {
    return { work_id: workId, stage: latest.stage, safe_to_resume: false, detail: "RECOVERY_UNSAFE: publication in flight without a completion object" };
  }
  if (latest.stage === "CI_PENDING" || latest.stage === "CI_VERIFIED" || latest.stage === "REMOTE_VERIFICATION") {
    return { work_id: workId, stage: latest.stage, safe_to_resume: true, detail: `resume GitHub verification from ${latest.stage}` };
  }
  if (latest.stage === "REQUESTED") {
    return { work_id: workId, stage: latest.stage, safe_to_resume: true, detail: "resume from REQUESTED using persisted work_id" };
  }
  return { work_id: workId, stage: latest.stage, safe_to_resume: true, detail: `resume persisted stage ${latest.stage}` };
}

export async function recoverEngineeringLoop(input: {
  readonly work_id: string;
  readonly command_id: string;
  readonly intent_text: string;
  readonly payload: unknown;
  readonly checkout_root: string;
  readonly selected_capability_id?: string | null;
  readonly proposed_writes?: readonly ProposedScopedWrite[];
  readonly deps?: EngineeringLoopDeps;
}): Promise<EngineeringLoopResult> {
  const inspection = inspectEngineeringRecovery(input.work_id);
  if (!inspection.safe_to_resume && inspection.stage !== "VERIFIED" && inspection.stage !== "BLOCKED" && inspection.stage !== "FAILED" && inspection.stage !== "REJECTED" && inspection.stage !== "OWNER_REVIEW") {
    return {
      status: "BLOCKED",
      reason_code: "RECOVERY_UNSAFE",
      detail: inspection.detail,
      work_id: input.work_id,
      command_id: input.command_id,
      worker_id: null,
      attempt: 0,
      lifecycle: null,
      completion: null,
      publication: null,
      registry_written: false,
      repair_count: 0,
      github_proof: null,
      owner_result: "ต้องการการอนุมัติจาก Owner",
      workspace_cleanup: [],
    };
  }
  return runAutonomousEngineeringLoop(input);
}
