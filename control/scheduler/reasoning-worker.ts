/**
 * หน้าที่: the REASONING-CLASS worker — dispatches a real, bounded AI agent
 * (via `control/agent-gateway/agent-host-dispatch.ts#runAgentWorkOrder`, the
 * SAME Agent Host boundary every other real agent launch in this repo
 * already goes through — no second executor) for the four work kinds that
 * need real judgement, not a deterministic test re-run:
 * `WIRE_OR_RETIRE`, `REPAIR`, `IMPLEMENT`, `RESOLVE_DEPENDENCY`.
 *
 * PHASE 4.4 (Owner: a Processing Resource must never scan the repo, walk
 * folders, read system history, know what DNA OS is, or summarize anything
 * back). This file now hands the agent EXACTLY ONE thing: a rendered
 * `./work-packet.ts#WorkPacket` — task, closed input/output paths, output
 * shape, pass criteria. No prose inviting it to "investigate" or "read the
 * rest of the repository for context" survives anywhere in this file
 * (compare the previous, retired `KIND_INSTRUCTIONS` prose-builder, which
 * did say that — this replaces it). `agent_run.assigned_source_paths` is
 * narrowed from the whole repo root to exactly `packet.input_refs`, the
 * same declared-authority discipline `control/agent-gateway/workspace-manager.ts`
 * already uses elsewhere in this repo. Genuine kernel-level intra-repo read
 * confinement remains the disclosed, unresolved FILE_READ_DEFAULT_DENY gap
 * (`control/runtime-adapter/`'s own honest limitation) — this narrows what
 * is DECLARED and ASKED, not a claim that reading elsewhere is kernel-
 * impossible.
 *
 * HARD RULE (Owner, this round — "Never let an agent self-declare
 * completion"): this file's own `WorkResult.outcome` is capped at `PARTIAL`
 * for every kind it handles — it is STRUCTURALLY INCAPABLE of returning
 * `VERIFIED`, regardless of what the agent itself reports. `control/scheduler/coordinator.ts`'s
 * `recordEvidence` additionally asserts this at the call site, so the cap
 * holds even if a future edit here forgets it. The only thing that can ever
 * write `VERIFIED` into the ledger is `./agent-worker.ts`
 * (`DETERMINISTIC_TEST`), re-running real tests against whatever this agent
 * changed — on the NEXT census cycle, not this one.
 *
 * Confinement: the agent's `allowedWorkspaceDir` is the REAL target
 * capability folder (not a disposable `/tmp` workspace) — correct here
 * because `control/scheduler/coordinator.ts` already claims that exact path
 * as a mutual-exclusion write-scope lock BEFORE this ever runs, so a live
 * edit to a real capability's own folder is authorized and non-overlapping,
 * not an unreviewed widening. The agent's WRITE authority never extends
 * beyond that one folder — Agent Host's own Seatbelt profile enforces that
 * at the kernel level, unchanged from every other real launch in this repo.
 *
 * COST DISCIPLINE (Owner directive across this whole session): a real
 * CLAUDE/CODEX dispatch spends real API budget. WHICH provider a given
 * dispatch uses is decided entirely by `./capability-router.ts` — this
 * file has no preference and no fixed kind-to-provider mapping. When the
 * router (or an explicit override) selects `LOCAL`, this file honestly
 * reports `LOCAL_WORKER_NO_REASONING_CAPABILITY` rather than pretending
 * to have made a real wiring/repair/implementation decision it cannot
 * make — `LOCAL` proves the mechanism (dispatch, confinement, evidence
 * collection, independent re-verification) at zero cost, nothing more.
 *
 * Input: `WorkItem` (kind ∈ {WIRE_OR_RETIRE, REPAIR, IMPLEMENT,
 * RESOLVE_DEPENDENCY}), real census facts (used ONLY to build the packet —
 * never handed to the agent as raw census/system knowledge), a
 * `ProviderKind` already chosen by the router.
 * Output: `WorkResult` (outcome ∈ {PARTIAL, BLOCKED} only — never VERIFIED,
 * never FAILED — a reasoning agent's own work failing to compile/apply is
 * `BLOCKED`, since "FAILED" is reserved for a real, already-run test
 * failure per `control/work-graph/derive.ts`'s own FAILED-vs-BLOCKED rule).
 * Dependency ที่อนุญาต: ../agent-gateway/contract.ts, ../work-graph/types.ts,
 * ./provider-pool.ts (types only), ./work-packet.ts,
 * ../../software/live-census/contract.ts (types only).
 * สิ่งที่ห้ามแตะ: never construct an instruction outside `renderPacketInstruction`
 * — that is exactly the self-declared-completion / repo-exploration path
 * this file exists to close off. Never return "VERIFIED". Never choose a
 * provider itself — that decision belongs entirely to `./capability-router.ts`.
 * Never set `assigned_source_paths` to anything broader than
 * `packet.input_refs`.
 */

import { runAgentWorkOrder } from "../agent-gateway/contract";
import type { WorkOrder } from "../agent-gateway/types";
import type { WorkItem, WorkResult } from "../work-graph/types";
import type { CapabilityRecord } from "../../software/live-census/contract";
import type { ProviderKind } from "./provider-pool";
import { buildWorkPacket, renderPacketInstruction } from "./work-packet";
import { join } from "node:path";

export type ReasoningWorkerKind = ProviderKind;

export async function dispatchReasoningWorker(
  item: WorkItem,
  cap: CapabilityRecord | null,
  workerKind: ReasoningWorkerKind,
  repoRoot: string,
  timeoutMs: number,
): Promise<WorkResult> {
  const started = Date.now();
  const packet = buildWorkPacket(item, cap, timeoutMs);
  const instruction = renderPacketInstruction(packet);

  if (workerKind === "LOCAL") {
    // Honest mechanism proof, zero cost: LOCAL has no real reasoning
    // capability, so it is never asked to pretend it wired/repaired/
    // implemented anything — see this file's own header.
    return {
      work_id: item.work_id,
      target: item.target,
      outcome: "BLOCKED",
      evidence_ref: "LOCAL_WORKER_NO_REASONING_CAPABILITY",
      passed: 0,
      failed: 0,
      duration_ms: Date.now() - started,
      output_tail: `LOCAL worker dispatched to prove the mechanism (real Agent Host launch, real write-scope confinement, real Work Packet ${packet.packet_id}) — it has no real reasoning capability and never claims to have made a wiring/repair/implementation decision.`,
    };
  }

  // SECURITY/CORRECTNESS FIX (found live, this round's real CLAUDE dispatch):
  // `item.write_scope`/`item.target` are REPO-RELATIVE paths (the Live
  // Census's own convention — see `software/live-census/host-runtime.ts`'s
  // `relative(REPO_ROOT, ...)` construction), but Agent Host's
  // `allowedWorkspaceDir`/`assigned_source_paths` require REAL ABSOLUTE
  // paths to build a correct Seatbelt profile. Passing the relative form
  // through uncorrected made a real CLAUDE launch fail immediately
  // (`FAIL_CLOSED: no terminal stream-json 'result' event`) — this had
  // never been exercised before because every prior proof this phase used
  // `LOCAL`, which returns above before ever reaching this code path.
  const writeScopeRel = item.write_scope.length > 0 ? item.write_scope[0] : item.target;
  const writeScopeAbs = join(repoRoot, writeScopeRel);
  const inputRefsAbs = packet.input_refs.map((p) => join(repoRoot, p));
  const workOrder: WorkOrder = {
    operation: "MODIFY",
    target_type: "FILE",
    target_path: `(work packet: ${packet.packet_id})`,
    requested_change: instruction,
    content: "",
    workspace_scope: writeScopeAbs,
    mode: "sandbox",
    required_tests: [],
    forbidden_files: [],
    evidence: [],
    agent_run: {
      worker_kind: workerKind,
      instruction,
      // Narrowed to EXACTLY the packet's own declared input_refs (resolved
      // to real absolute paths) — never the repo root. The Processing
      // Resource is handed a packet, not a repository; it has no declared
      // reason to read anything else.
      assigned_source_paths: inputRefsAbs,
      dependency_read_paths: [],
      workspace_path: writeScopeAbs,
      timeout_ms: timeoutMs,
      expected_result_contract: "DNA_OS_AGENT_RESULT_V1",
    },
  };

  const result = await runAgentWorkOrder(workOrder, `scheduler-reasoning:${item.work_id}`, process.env as Record<string, string | undefined>);

  const outcome = result.status === "PASS" ? "PARTIAL" : "BLOCKED"; // NEVER "VERIFIED" — see header.
  return {
    work_id: item.work_id,
    target: item.target,
    outcome,
    evidence_ref: `reasoning-agent(${workerKind}):${packet.packet_id}:${result.result_id}:${result.status}`,
    passed: 0,
    failed: 0,
    duration_ms: Date.now() - started,
    output_tail: result.summary.slice(0, 500),
  };
}
