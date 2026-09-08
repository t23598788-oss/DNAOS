/**
 * หน้าที่: the public boundary of `connections/dna-os-mcp/` — the only
 * file another capability folder or test outside this folder may import
 * from, per `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md`
 * ข้อ 9. `./tool-registry.ts`, `./capability-gate.ts`,
 * `./adapters/dna-os-http-client.ts`, and `./identity.ts` stay reachable
 * only through here.
 *
 * Input: re-exports only.
 * Output: `createDnaOsMcpServer`, `DNA_OS_MCP_TOOLS`, `DnaOsHttpClient`,
 * `resolveCapabilityForTool`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./server.ts, ./tool-registry.ts,
 * ./capability-gate.ts, ./capability-projection.ts,
 * ./adapters/dna-os-http-client.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never re-export ./identity.ts's internals beyond
 * `resolveAgentIdentity` — this boundary carries DNA OS-level contracts
 * only.
 */

export { projectCapability, projectCapabilityList } from "./capability-projection";
export type { ModelVisibleCapability } from "./capability-projection";
export { createDnaOsMcpServer } from "./server";
export { DNA_OS_MCP_TOOLS } from "./tool-registry";
export type { DnaOsMcpTool, McpToolResult } from "./tool-registry";
export { resolveCapabilityForTool } from "./capability-gate";
export { DnaOsHttpClient } from "./adapters/dna-os-http-client";
export type { DnaOsHttpClientOptions, DnaOsHttpResponse } from "./adapters/dna-os-http-client";
export { resolveAgentIdentity } from "./identity";
export {
  getCapabilityStatusFact,
  getLatestWorkFact,
  getRuntimeIdentityFact,
  getSystemHealthFact,
  getWorkEvidenceFact,
  getWorkStatusFact,
} from "./runtime-facts";
export { UNAUTHENTICATED_CONTEXT } from "./caller-context";
export type { CallerContext } from "./export-policy";
export type {
  McpToolMetadata,
  McpToolPermissionScope,
  McpToolReadWriteBehavior,
  McpToolEvidenceBehavior,
  CapabilityGateResult,
  CapabilityGateStatus,
  DnaOsAgentIdentity,
  CorrelationTrace,
} from "./types";
