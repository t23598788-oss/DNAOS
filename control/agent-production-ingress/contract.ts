/**
 * หน้าที่: the public boundary of `control/agent-production-ingress/` —
 * the only file another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `submitAgentWork`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./resolver.ts, ./types.ts.
 */

export { submitAgentWork } from "./resolver";
export type { AgentProductionRequest, AgentProductionStage, AgentProductionStatus, AgentProductionResult } from "./types";
