/**
 * หน้าที่: ทางเข้าเดียวของชั้นลำดับขั้นปฏิบัติการ
 *
 * ผู้เรียกภายนอกต้องนำเข้าไฟล์นี้เท่านั้น เพื่อให้การเปลี่ยนภายในไม่ลากผู้เรียกไปด้วย
 * และเพื่อให้ "ใครใช้ชั้นนี้บ้าง" ตอบได้ด้วย grep บรรทัดเดียว
 *
 * Output: ชนิด + deriveLifecycle + decideContinuation + stagesInOrder + ดัชนีเส้นเชื่อม.
 * Dependency ที่อนุญาต: ไฟล์ภายในโฟลเดอร์นี้.
 * สิ่งที่ห้ามแตะ: ห้าม export ตัวตั้งสถานะ.
 */

export type {
  StageStatus, StageKind, ConditionResult,
  LifecycleStageDeclaration, LifecycleStageState, ContinuationDecision,
} from "./types";
export { ORPHANED, stageKey } from "./types";
export { STAGES, stageById, stagesInOrder } from "./stages";
export { CONDITIONS, evaluateCondition } from "./conditions";
export { deriveLifecycle, decideContinuation, resumeAfterRepair } from "./derive";
export type { ResumeAfterRepair } from "./derive";
export { recordStageLink, loadStageLinks, linksForStage, STAGE_LINKS_PATH } from "./links";
export type { StageLink, StageLinkKind } from "./links";
