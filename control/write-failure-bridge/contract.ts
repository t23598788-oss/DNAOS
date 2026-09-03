/**
 * หน้าที่: ขอบเขตสาธารณะของ control/write-failure-bridge/
 *
 * Input: re-export เท่านั้น
 * Output: eligibility, bridge, claim boundary
 * Dependency ที่อนุญาต: ./eligibility.ts, ./bridge.ts, ./claim-store.ts
 * สิ่งที่ห้ามแตะ: ห้าม export อะไรที่เขียนไฟล์ปลายทางได้ — สะพานนี้อ่านเหตุการณ์
 * และสร้างงาน ไม่ใช่ผู้เขียน
 */

export { classifyWriteAudit, ALLOW_DECISIONS } from "./eligibility";
export type { WriteFailureClass, EligibilityVerdict } from "./eligibility";
export { startWriteFailureBridge, handleWriteAuditEvent, buildCorrectiveWorkOrder, CORRECTIVE_SOURCE_EVENT_TYPE, AUTOMATIC_AGENT_DISPATCH_ENABLED } from "./bridge";
export type { BridgeHandle, BridgeObservation, CorrectiveConstruction, CorrectiveOutcome, HandleOptions } from "./bridge";
export { claimSourceEvent, bindCorrectiveTask, markWorkNotCreated, listClaims, findClaim, CLAIM_PURPOSE_CORRECTIVE_WORK } from "./claim-store";
export type { SourceEventClaim, ClaimOutcome, ClaimState } from "./claim-store";
export { snapshotRouteInputs, decideRoute, digestOf, buildCorrectiveWorkItem, CORRECTIVE_WORK_KIND, POOL_SIZE_PER_PROVIDER } from "./routing";
export type { RouteInputsSnapshot } from "./routing";
