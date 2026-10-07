/**
 * หน้าที่: ขอบเขตสาธารณะของ control/joint-resolver/
 * Input: re-export เท่านั้น
 * Output: resolveJoint, resolveJoints, COMPOSITIONS และชนิดของผล
 * Dependency ที่อนุญาต: ./resolve.ts
 * สิ่งที่ห้ามแตะ: ห้าม export ทางที่ให้ผู้เรียกกำหนดผลการตัดสินเอง
 */
export { resolveJoint, resolveJoints, COMPOSITIONS } from "./resolve";
export type { JointResolution, JointVerdict } from "./resolve";
