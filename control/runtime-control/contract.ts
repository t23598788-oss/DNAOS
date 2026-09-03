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
export { buildRequesterProvenance, readRequester, RUNTIME_CONTROL_EXECUTOR } from "./requester";
export type {
  RuntimeOperationRequest, RuntimeRequesterIdentity, RuntimeRequestLineage,
  RuntimeExecutor, RequesterReading,
} from "./requester";
export { evidenceStoreFile } from "./host-runtime";
export { SERVICES } from "./host-runtime";
export type {
  ServiceId,
  Action,
  ServiceDefinition,
  HealthCheckResult,
  LaunchdState,
  DuplicateCheck,
  OperationEvidence,
  OperationResult,
} from "./types";

/**
 * BOOT SENSOR → DEPENDENCY START. ใช้ SERVICES ชุดเดียวกับ resolver
 * ไม่มี registry ที่สอง และไม่มี supervisor ตัวที่สอง — ตัวที่รันมันคือ
 * `control/owner-backbone/start.ts` ที่ launchd คุมอยู่แล้ว
 */
export { bootAll, resolveStartOrder, MAX_START_ATTEMPTS } from "./boot-orchestrator";
export type { BootReport, ServiceBootResult, ServiceState } from "./boot-orchestrator";
