/**
 * หน้าที่: the public boundary of `control/scheduler/` — the canonical
 * Scheduler/Coordinator, per CAPABILITY_FOLDER_LAW ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `runLoop` + its option/report types, the Processing Fabric's
 * pool/router types.
 * Dependency ที่อนุญาต: ./coordinator.ts, ./provider-pool.ts,
 * ./capability-router.ts.
 */
export { runLoop } from "./coordinator";
export type { LoopOptions, LoopReport, LoopRound } from "./coordinator";
export { discoverPool, recordMetric, loadMetrics, REASONING_WORK_KINDS } from "./provider-pool";
export type { ProviderKind, ProcessingUnit, ProviderMetricRecord } from "./provider-pool";
export { routeWork, REASONING_CAPABLE_PROVIDERS } from "./capability-router";
export type { RouteDecision } from "./capability-router";
export { buildWorkPacket, renderPacketInstruction } from "./work-packet";
export type { WorkPacket } from "./work-packet";
export { compileIntent } from "./intent-compiler";
export type { Objective, CompiledIntent } from "./intent-compiler";
export { identifyRouteDecision, routingInputDigest, listRouteDecisions, loadRouteDecision, routeDecisionsForTask } from "./route-decision-record";
export type { RouteDecisionRecord, IdentifyRouteDecisionInput, IdentifyOutcome } from "./route-decision-record";
