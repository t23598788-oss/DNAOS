/**
 * หน้าที่: the public boundary of `control/runtime-control/` — the only
 * file another capability folder (or `cli.ts`) may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `runOperation`, `SERVICES`, plus every type a caller needs.
 *
 * `httpHealthCheck` is deliberately NOT exported. It was, briefly, so that a
 * caller could run a longer readiness wait of its own — but a caller able to
 * poll health separately is a second opinion about whether a service is up.
 * `runOperation` now waits to each service's declared `readiness_timeout_ms`
 * itself, so there is nothing left to work around, and readiness has one home.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { runOperation } from "./resolver";
export { SERVICES } from "./host-runtime";
export { serviceNodeEligibility, isKnownServiceId } from "./service-eligibility";
export type { ServiceNodeEligibility } from "./service-eligibility";
export { PortableProcessSupervisor, getPortableSupervisor, resetPortableSupervisorForTests, portableSupervisorActive } from "./portable-supervisor";
export type { ProcessSupervisor, SupervisorInspect } from "./supervisor";
export { buildRequesterProvenance, readRequester, RUNTIME_CONTROL_EXECUTOR } from "./requester";
export type {
  RuntimeOperationRequest, RuntimeRequesterIdentity, RuntimeRequestLineage,
  RuntimeExecutor, RequesterReading,
} from "./requester";
export { evidenceStoreFile } from "./host-runtime";
export type {
  ServiceId,
  Action,
  ServiceDefinition,
  HealthCheckResult,
  LaunchdState,
  DuplicateCheck,
  OperationEvidence,
  OperationResult,
  ProcessLifecycleState,
} from "./types";

/**
 * BOOT SENSOR → DEPENDENCY START. ใช้ SERVICES ชุดเดียวกับ resolver
 * ไม่มี registry ที่สอง — ตัวที่รันบน Mac คือ
 * `control/owner-backbone/start.ts` ที่ launchd คุมอยู่แล้ว
 * CORE_NODE ใช้ PortableProcessSupervisor กับ SERVICES ชุดเดียวกัน
 */
export { bootAll, resolveStartOrder, MAX_START_ATTEMPTS } from "./boot-orchestrator";
export type { BootReport, ServiceBootResult, ServiceState } from "./boot-orchestrator";
