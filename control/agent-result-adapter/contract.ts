/**
 * หน้าที่: the public boundary of `control/agent-result-adapter/` — the only file
 * another capability folder may import from, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * Input: re-exports only.
 * Output: `adaptAgentResult`, plus every type a caller needs.
 * Dependency ที่อนุญาต: ./adapter.ts.
 * สิ่งที่ห้ามแตะ: ห้าม re-export ตัวช่วยภายใน (artifactPath, toRepoRelative) —
 * ผู้เรียกที่แปลง artifact เป็น path เองได้ จะข้ามกฎ "ต้องมีหลักฐานการวัด" ของ
 * โฟลเดอร์นี้ไปเลย
 */
export { adaptAgentResult } from "./adapter";
export type { AdaptContext, AdaptOutcome, FieldProvenance, UnresolvedItem,
              VerifiedFileChange, ExecutedTest, ProvenanceKind } from "./adapter";
