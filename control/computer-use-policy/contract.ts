/**
 * หน้าที่: ขอบเขตสาธารณะของ control/computer-use-policy/ (V2 authorization model)
 * Output: readPreauthorization, setPreauthorization, resolveComputerUseAuthorization,
 *   completeJob + types.
 * Dependency ที่อนุญาต: ./policy.ts, ./resolve.ts.
 */
export { readPreauthorization, setPreauthorization } from "./policy";
export type { PreauthorizationRecord, SetPreauthorizationResult } from "./policy";
export { resolveComputerUseAuthorization, completeJob } from "./resolve";
export type { ResolveMode, ResolveRequest, ResolveResult, ResolveDeps } from "./resolve";
