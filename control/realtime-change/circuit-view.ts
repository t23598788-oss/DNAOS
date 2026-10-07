/**
 * หน้าที่: the circuit view of the realtime change path — five DIRECTED edges,
 * no decorative bidirectional arrow (Owner, 2026-08-26).
 *
 * Each edge names the runtime evidence that would prove it happened, so the UI
 * never draws a relationship that cannot be traced to something real.
 *
 * Input: none.
 * Output: nodes + directed edges.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม edge ที่ไม่มี evidence จริงรองรับ.
 */

export function changeFlowCircuitGraph(): {
  nodes: { id: string; label: string; kind: string; source_note: string }[];
  edges: { id: string; from: string; to: string; direction: string; schema: readonly string[]; evidence: readonly string[] }[];
} {
  const nodes = [
    { id: "FILESYSTEM", label: "FILESYSTEM", kind: "top", source_note: "macOS kernel events surfaced by fs.watch — control/realtime-change/observer.ts" },
    { id: "CHANGE_EVENT", label: "CHANGE EVENT", kind: "data", source_note: "control/realtime-change/types.ts#ChangeEvent — raw OS facts only" },
    { id: "SYSTEM_RESOLUTION", label: "SYSTEM RESOLUTION", kind: "function", source_note: "control/realtime-change/impact.ts + control/system-read-paths/" },
    { id: "IMPACT_CONTEXT", label: "CHANGE IMPACT CONTEXT", kind: "data", source_note: "control/realtime-change/types.ts#ChangeImpactContext" },
    { id: "ACTIVE_AGENT", label: "ACTIVE AGENT", kind: "process", source_note: "control/agent-host#listActiveLaunches / control/work-coordination#listWriteLocks" },
  ];

  const edges = [
    { id: "E_FS_TO_EVENT", from: "FILESYSTEM", to: "CHANGE_EVENT", direction: "OBSERVATION", schema: ["path", "event_type", "observed_at", "filesystem_evidence"], evidence: ["control/realtime-change/observer.ts#startObserving", "fs.watch recursive on a runtime-derived scope"] },
    { id: "E_EVENT_TO_RESOLUTION", from: "CHANGE_EVENT", to: "SYSTEM_RESOLUTION", direction: "REQUEST", schema: ["event_id", "path"], evidence: ["control/realtime-change/impact.ts#buildImpactContext"] },
    { id: "E_RESOLUTION_TO_CONTEXT", from: "SYSTEM_RESOLUTION", to: "IMPACT_CONTEXT", direction: "RESPONSE", schema: ["changed_resource", "related_capability", "active_task", "write_lock", "evidence_refs", "affected_blueprint_claims", "unresolved_refs"], evidence: ["control/system-read-paths/contract.ts read paths", "software/registry-database#findResourceBySourceLocation"] },
    { id: "E_CONTEXT_TO_AGENT", from: "IMPACT_CONTEXT", to: "ACTIVE_AGENT", direction: "INTERRUPT_AND_CONTEXT", schema: ["interrupt.json", "change-context.json"], evidence: ["control/realtime-change/interrupt.ts#deliverInterrupt", "control/realtime-change/interrupt.ts#deliverContext", "scopesOverlap proof on the target's declared scope"] },
    { id: "E_AGENT_TO_DNAOS", from: "ACTIVE_AGENT", to: "SYSTEM_RESOLUTION", direction: "ACK", schema: ["interrupt_id", "state", "current_step", "acknowledged_at"], evidence: ["control/realtime-change/interrupt.ts#readAck — read from what the execution really wrote"] },
  ];

  return { nodes, edges };
}
