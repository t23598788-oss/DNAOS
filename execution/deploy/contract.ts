/**
 * หน้าที่: the public boundary of `execution/deploy/` — the only file
 * another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `resolveDeployPlan`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { resolveDeployPlan } from "./resolver";
export type { DeployPlanStatus, DeployPlanInput, DeployPlanResult } from "./types";
