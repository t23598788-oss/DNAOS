/**
 * หน้าที่: derives the Output Contract lane
 * (../../contracts/command/output-contract.ts) from a `CapabilityResult`
 * this router already produced. `dispatcher` is the ONE capability_id in
 * `./capability-registry.ts` whose step (`runDispatcherStep` in
 * `./router.ts`) actually hands work to a real `AgentAdapter` via
 * `dispatchTask`/`submitTask` — every other capability_id runs
 * synchronously inside this router's own step and is admitted via
 * `admitCompletedTask` (see ../agent-gateway/gateway.ts). That single,
 * already-real fact — not a new decision — is what this function reads.
 *
 * Input: a `CapabilityResult` (../../contracts/command/capability-result.ts).
 * Output: `DnaOsOutput` (../../contracts/command/output-contract.ts).
 * Dependency ที่อนุญาต: ../../contracts/command/capability-result.ts,
 * ../../contracts/command/output-contract.ts.
 * สิ่งที่ห้ามแตะ: never classify by inspecting `summary`/`evidence` text —
 * only `capability_id`, which is the one field this router's own registry
 * (./capability-registry.ts) already guarantees is truthful.
 */

import type { CapabilityResult } from "../../contracts/command/capability-result";
import type { DnaOsOutput } from "../../contracts/command/output-contract";

const DISPATCHER_CAPABILITY_ID = "dispatcher";

export function classifyOutput(result: CapabilityResult): DnaOsOutput {
  if (result.capability_id === DISPATCHER_CAPABILITY_ID) {
    const dispatcherArtifact = result.artifacts.find((artifact) => artifact.kind === "dispatcher_task_id");
    return {
      lane: "WORK_ITEM",
      task_id: result.task_id,
      capability_id: result.capability_id,
      status: result.status,
      summary: result.summary,
      evidence: result.evidence,
      artifacts: result.artifacts,
      dispatcher_task_id: dispatcherArtifact?.ref ?? null,
      next_action: result.next_action,
    };
  }
  return {
    lane: "SYSTEM_STATE",
    task_id: result.task_id,
    capability_id: result.capability_id,
    status: result.status,
    summary: result.summary,
    evidence: result.evidence,
    next_action: result.next_action,
  };
}
