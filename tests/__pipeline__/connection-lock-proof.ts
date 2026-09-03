/**
 * PROOF: 4 edge ที่เหลือ — observation→ingress, joint→ingress, violation→ingress,
 * RouteResult→executor dispatch
 *
 * ไม่มีการปล่อย Agent ใด ๆ ในไฟล์นี้
 */
const STORE = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/tests/__pipeline__/isolated-store-locks";
process.env.AGENT_GATEWAY_DATA_DIR = STORE;
process.env.OWNER_BACKBONE_ROUTE_LOG = `${STORE}/route-results.jsonl`;
// joint-monitor client จะ POST ออกไป — ชี้ไปพอร์ตที่ไม่มีใครฟัง เพื่อพิสูจน์ว่า
// hook ยิงที่จุดผลิตจริง ไม่ได้ขึ้นกับ collector
process.env.JOINT_MONITOR_URL = "http://127.0.0.1:59999";

import { rmSync } from "node:fs";
import { appendObservation } from "../../control/machine-observation/contract";
import { startObservationEventBridge, observationToEvent } from "../../control/machine-observation/contract";
import { reportJoint, reportViolation } from "../../observability/joint-monitor/contract";
import { startJointEventBridge, isLoopingJoint, jointToEvent, violationToEvent } from "../../observability/joint-monitor/contract";
import { dispatchRoute, resolveExecutorBinding, EXECUTOR_BINDINGS, intakeEvent } from "../../control/owner-backbone/contract";
import type { RouteResult } from "../../control/owner-backbone/contract";

const REGISTERED = new Set(["owner-backbone", "dna-os-live-agent-execution-path", "workspace-cleanup-gate"]);

function routeFor(action: string | null, owner: string | null): RouteResult {
  return {
    route_id: `route-test-${action ?? "none"}`, input_event_id: "evt-test",
    target_owner: owner, target_capability_or_executor: "x", action,
    policy_result: action ? "AUTOMATIC_RECOVERY" : "NO_REMEDIATION_AVAILABLE",
    reason_code: action ? "ROUTED" : "NO_ACTION", evidence_refs: [], identity: {},
    decided_at: new Date().toISOString(),
  };
}

async function main() {
  rmSync(STORE, { recursive: true, force: true });

  // ---- CONNECTION 1 : observation -> ingress (producer time)
  const obsBridge = startObservationEventBridge(intakeEvent);
  const rec = appendObservation({
    event_id: "obs-lock-1", resource_id: "resource-lock-1",
    path: "tests/__sandbox__/true-test-a/observed.txt", observed_at: new Date().toISOString(),
    process_evidence: ["proof"], relationship_evidence: [], meaning_records: [],
    source: "dna-os:work=work-lock-1;execution=exec-lock-1",
    derived_by: "connection-lock-proof",
    work_id: "work-lock-1", execution_id: "exec-lock-1",
    workspace_id: "ws-lock-1", task_id: "task-lock-1", capability_id: "cap-lock-1",
  });
  const obsForwarded = await obsBridge.settled();
  obsBridge.stop();
  const mapped = observationToEvent(rec);

  // ---- CONNECTION 2 : joint / violation -> ingress
  const jointBridge = startJointEventBridge(intakeEvent);
  await reportJoint({ from_capability: "owner-console", to_capability: "agent-gateway", task_id: "task-lock-2",
    status: "FAILED", summary: "task failed in proof", source: "control/agent-gateway/gateway.ts#persistStatus", occurred_at: new Date().toISOString(), occurred_seq: 1, reporter_run_id: "r1" } as never);
  await reportJoint({ from_capability: "owner-console", to_capability: "agent-gateway", task_id: "task-lock-3",
    status: "EXECUTING", summary: "normal transition", source: "control/agent-gateway/gateway.ts#persistStatus", occurred_at: new Date().toISOString(), occurred_seq: 2, reporter_run_id: "r1" } as never);
  await reportJoint({ from_capability: "x", to_capability: "y", task_id: null,
    status: "FAILED", summary: "self emitted", source: "control/owner-backbone/events.ts", occurred_at: new Date().toISOString(), occurred_seq: 3, reporter_run_id: "r1" } as never);
  await reportViolation({ launch_id: "launch-lock-1", reason: "POLICY_BREACH_TEST", detail: "proof violation",
    source: "control/circuit-breaker/daemon.ts", enforced: false, occurred_at: new Date().toISOString(), occurred_seq: 4, reporter_run_id: "r1" } as never);
  const jointForwarded = await jointBridge.settled();
  jointBridge.stop();

  // ---- CONNECTION 3 : RouteResult -> executor
  const okRestart = await dispatchRoute(routeFor("RESTART_EXISTING_SERVICE", "control/owner-backbone"), { registeredCapabilityNames: REGISTERED });
  const agentPath = await dispatchRoute(routeFor("REPAIR_THROUGH_RESOLVED_WORK_PACKET", "control/agent-gateway"), { registeredCapabilityNames: REGISTERED });
  const cleanup = await dispatchRoute(routeFor("WORKSPACE_REMOVE", "control/agent-gateway"), { registeredCapabilityNames: REGISTERED });
  const noAction = await dispatchRoute(routeFor(null, null), { registeredCapabilityNames: REGISTERED });
  const unregistered = await dispatchRoute(routeFor("RESTART_EXISTING_SERVICE", "control/owner-backbone"), { registeredCapabilityNames: new Set() });
  const unknownAction = await dispatchRoute(routeFor("SOMETHING_NOBODY_DECLARED", "control/owner-backbone"), { registeredCapabilityNames: REGISTERED });
  // ผู้เรียกจริงถูกส่งเข้ามาได้ แต่จะถึงก็ต่อเมื่อ execution_enabled
  let invoked = 0;
  const withInvoke = await dispatchRoute(routeFor("RESTART_EXISTING_SERVICE", "control/owner-backbone"),
    { registeredCapabilityNames: REGISTERED, invoke: async () => { invoked += 1; return { ok: true, detail: "invoked by proof (ไม่ได้รีสตาร์ตบริการจริง)" }; } });
  const agentWithInvoke = await dispatchRoute(routeFor("REPAIR_THROUGH_RESOLVED_WORK_PACKET", "control/agent-gateway"),
    { registeredCapabilityNames: REGISTERED, invoke: async () => { invoked += 1; return { ok: true, detail: "MUST NEVER HAPPEN" }; } });

  console.log(JSON.stringify({
    CONNECTION_1_observation_to_ingress: {
      forwarded: obsForwarded.length,
      identity_mapped: { event_id: mapped.event_id, resource_id: mapped.resource_id, workspace_id: mapped.workspace_id,
        task_id: mapped.task_id, capability_id: mapped.capability_id, agent_run_id: mapped.agent_run_id ?? null,
        work_order_id: mapped.work_order_id },
      work_id_kept_distinct: mapped.work_order_id === null && (mapped.evidence_refs ?? []).some((e) => e.startsWith("work_id=")) ? "YES" : "NO",
      no_untracked: JSON.stringify(mapped).includes("UNTRACKED") ? "FAIL" : "PASS",
      route: obsForwarded[0] ? { policy_result: obsForwarded[0].route.policy_result, target_owner: obsForwarded[0].route.target_owner } : null,
      STATUS: obsForwarded.length === 1 ? "CONNECTED" : "BLOCKED",
    },
    CONNECTION_2_joint_violation_to_ingress: {
      emitted: 4, forwarded: jointForwarded.length, skipped_by_guard: jointBridge.skipped(),
      loop_guard_blocks_owner_backbone: isLoopingJoint({ source: "control/owner-backbone/events.ts" } as never) ? "YES" : "NO",
      joint_task_id_propagated: jointToEvent({ from_capability: "a", to_capability: "b", task_id: "task-lock-2", status: "FAILED", summary: "s", source: "control/agent-gateway/gateway.ts", occurred_at: "t" } as never).task_id,
      violation_task_id_not_inferred: violationToEvent({ launch_id: "launch-1", reason: "r", detail: "d", source: "s", enforced: false, occurred_at: "t" } as never).task_id,
      violation_launch_id_as_evidence: (violationToEvent({ launch_id: "launch-1", reason: "r", detail: "d", source: "s", enforced: false, occurred_at: "t" } as never).evidence_refs ?? []).some((e) => e.startsWith("launch_id=")) ? "YES" : "NO",
      STATUS: jointForwarded.length === 2 ? "CONNECTED" : "BLOCKED",
    },
    CONNECTION_3_route_to_executor: {
      bindings_declared: EXECUTOR_BINDINGS.length,
      RESTART_EXISTING_SERVICE: { status: okRestart.status, target: okRestart.binding?.target_symbol ?? null, result_return: okRestart.result_return },
      REPAIR_THROUGH_RESOLVED_WORK_PACKET: { status: agentPath.status, reason: agentPath.detail.slice(0, 80), result_return: agentPath.result_return },
      WORKSPACE_REMOVE: { status: cleanup.status, target: cleanup.binding?.target_symbol ?? null, result_return: cleanup.result_return },
      no_action: noAction.status,
      capability_not_in_registry: unregistered.status,
      action_not_declared: unknownAction.status,
      with_real_invoker: { restart: withInvoke.status, agent_path: agentWithInvoke.status, INVOKE_CALL_COUNT: invoked },
      STATUS: okRestart.status === "EXECUTION_DISABLED" && unregistered.status === "TARGET_EXECUTOR_NOT_REGISTERED" && unknownAction.status === "TARGET_EXECUTOR_NOT_REGISTERED" ? "CONNECTED" : "CHECK",
    },
    AGENT_AUTOMATIC_DISPATCH: agentWithInvoke.status === "EXECUTION_DISABLED" && invoked === 1 ? "DISABLED (ผู้เรียกถูกเรียกเฉพาะเส้นทางที่อนุญาต)" : "CHECK",
  }, null, 1));
}
main().catch((e) => { console.error("ERR", e?.stack ?? e); process.exit(1); });
