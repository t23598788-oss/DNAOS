/**
 * หน้าที่: ขอบเขตสาธารณะของ control/remote-mcp-client/
 * Input: re-export เท่านั้น
 * Output: invokeRemoteTool และชนิดข้อมูลของผล
 * Dependency ที่อนุญาต: ./client.ts, ./types.ts
 * สิ่งที่ห้ามแตะ: ห้าม export ทางที่รับ token หรือกำหนด endpoint เองได้
 */
export { invokeRemoteTool, EXECUTION_FILE } from "./client";
export type { RemoteMcpInvocation, RemoteMcpExecution, RemoteMcpStatus } from "./types";
