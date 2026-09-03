/**
 * หน้าที่: ขอบเขตสาธารณะของ `control/claude-execution-boundary/` — ไฟล์เดียว
 * ที่โฟลเดอร์อื่นนำเข้าได้ ตาม governance/architecture-rules/CAPABILITY_FOLDER_LAW.md ข้อ 9
 *
 * Input: re-export เท่านั้น.
 * Output: `runClaudeCodeLocally` และชนิดที่ผู้เรียกต้องใช้.
 * Dependency ที่อนุญาต: ./boundary.ts, ./types.ts.
 */
export { runClaudeCodeLocally } from "./boundary";
export type { ClaudeBoundaryRequest, ClaudeBoundaryResult, ClaudeBoundaryStatus, ClaudeExecutionMode } from "./types";
