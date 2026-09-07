/**
 * หน้าที่: สัญญาของ control/remote-mcp-client/ — ด่านเรียกทรัพยากร MCP ระยะไกล
 * ที่ DNA OS เป็นเจ้าของเอง
 *
 * Owner, 2026-09-05: ห้ามใช้ Claude Code เป็นตัวแทนการรัน และห้ามดึง token ของ
 * Claude มาใช้ ด่านนี้จึงรับได้เพียง `credential_ref` ซึ่งเป็นตัวชี้ ไม่ใช่ความลับ
 * ตัวความลับอยู่ที่ credentials/macos-keychain/ ตามสถาปัตยกรรมเดิม
 *
 * ด่านนี้ห้ามรู้จัก Gmail/Calendar/Slack ในฐานะกฎธุรกิจ ค่าที่เจาะจงผู้ให้บริการ
 * ทั้งหมดมาจากทะเบียน ไม่ใช่จากโค้ดที่นี่
 *
 * Input: RemoteMcpInvocation
 * Output: RemoteMcpExecution (ไม่มีความลับอยู่ในนั้นเลย)
 * Dependency ที่อนุญาต: none (นิยามชนิดล้วน)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่มฟิลด์ที่ถือ token/secret/refresh token
 * - ห้ามรวม UNAUTHORIZED เข้ากับ FAILED — คนละสาเหตุและคนละการแก้
 * - ห้ามให้ผู้เรียกส่ง endpoint เข้ามาเอง ต้องมาจากทะเบียน
 */

export type RemoteMcpStatus =
  | "COMPLETED"
  | "FAILED"
  | "RESOURCE_UNAUTHORIZED"
  | "RESOURCE_UNAVAILABLE"
  | "CAPABILITY_MISSING"
  | "RESOURCE_CONTRACT_DRIFT"
  | "BLOCKED";

export interface RemoteMcpInvocation {
  readonly resource_id: string;
  readonly capability_id: string;
  /** ตัวชี้เท่านั้น เช่น credential://google/<owner>/<connection> — ห้ามเป็นค่าจริง */
  readonly credential_ref: string | null;
  readonly tool_name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly command_id: string;
  readonly work_id: string | null;
  readonly task_id: string | null;
  readonly execution_policy: { readonly read_write_class: "READ_ONLY" | "EXTERNAL_WRITE"; readonly allow_external_write: boolean };
}

export interface RemoteMcpExecution {
  readonly resource_execution_id: string;
  readonly command_id: string;
  readonly work_id: string | null;
  readonly task_id: string | null;
  readonly resource_id: string;
  readonly capability_id: string;
  /** ตัวชี้เท่านั้น — ตรวจได้ว่าใช้ใบไหน โดยไม่เปิดเผยความลับ */
  readonly credential_ref: string | null;
  readonly tool_name: string;
  readonly endpoint: string | null;
  readonly started_at: string;
  readonly finished_at: string;
  readonly duration_ms: number;
  readonly status: RemoteMcpStatus;
  readonly discovered_tools: readonly string[];
  readonly structured_result: unknown;
  readonly error_code: string | null;
  readonly reason: string;
  readonly network_request_made: boolean;
  readonly evidence_id: string;
}
