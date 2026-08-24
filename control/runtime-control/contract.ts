/**
 * หน้าที่: the public boundary of `control/runtime-control/` — the only
 * file another capability folder (or `cli.ts`) may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `runOperation`, `SERVICES`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { runOperation } from "./resolver";
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
