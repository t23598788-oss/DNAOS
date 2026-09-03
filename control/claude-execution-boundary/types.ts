/**
 * หน้าที่: รูปสัญญาของ "ขอบเขตการเรียก Claude Code ในเครื่อง" — ผู้เรียกบอกได้
 * เพียงว่าจะให้ทำอะไรและในพื้นที่ไหน ที่เหลือขอบเขตนี้เป็นคนตัดสินทั้งหมด
 * (Owner, IMPLEMENT_LOCAL_CLAUDE_CODE_TRUSTED_EXECUTION_BOUNDARY).
 *
 * สิ่งที่จงใจ "ไม่มี" ในคำขอ คือหัวใจของไฟล์นี้: ไม่มี executable, ไม่มี argv,
 * ไม่มี env, ไม่มี sandbox policy, ไม่มี credential ใด ๆ ถ้าฟิลด์เหล่านั้นมีอยู่
 * ขอบเขตนี้จะกลายเป็น "ตัวรันคำสั่งที่มีสิทธิ์พิเศษแบบทั่วไป" ซึ่งเป็นสิ่งเดียว
 * ที่มันถูกสร้างขึ้นมาเพื่อไม่ให้เป็น
 *
 * Input: none (นิยามชนิดล้วน).
 * Output: `ClaudeBoundaryRequest`, `ClaudeBoundaryResult`, `ClaudeBoundaryStatus`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มฟิลด์ที่ให้ผู้เรียกกำหนด executable/argv/env/profile/
 * credential ไม่ว่าทางตรงหรือทางอ้อม.
 */

export type ClaudeExecutionMode = "LOCAL_MACHINE_AUTH";

export interface ClaudeBoundaryRequest {
  /** ต้องเป็น "CLAUDE_CODE" — ผู้ให้บริการอื่นมีขอบเขตของตัวเอง ไม่ใช้ไฟล์นี้ */
  provider: "CLAUDE_CODE";
  /** งานที่จะให้ทำ เป็นข้อความล้วน ถูกส่งเป็น argv ตัวสุดท้ายหลัง `--` เท่านั้น */
  objective: string;
  /** พื้นที่ทำงานที่ DNA OS อนุมัติแล้ว — ต้องเป็น absolute path ที่มีอยู่จริง */
  workspace: string;
  /** โหมดเดียวที่มี: ใช้การยืนยันตัวตนของเครื่องที่ Owner login ไว้แล้ว */
  execution_mode: ClaudeExecutionMode;
  /** โมดูลผู้เรียก — ตรวจกับ allowlist จริง ไม่ใช่คอมเมนต์ */
  caller: string;
  /** ไว้ผูกหลักฐานกลับเข้างานเดิม ไม่มีผลต่อสิทธิ์ */
  task_id: string;
  work_order_id: string;
  timeout_ms?: number;
}

export type ClaudeBoundaryStatus =
  | "COMPLETED"
  /** โปรเซสรันแต่ Claude บอกเองว่ายังไม่ได้ล็อกอิน — ปิดตาย ไม่สลับไปโหมด API key */
  | "AUTH_UNAVAILABLE"
  | "CALLER_NOT_ALLOWED"
  | "INVALID_REQUEST"
  | "EXECUTABLE_UNAVAILABLE"
  | "TIMED_OUT"
  | "FAILED";

export interface ClaudeBoundaryResult {
  status: ClaudeBoundaryStatus;
  launch_id: string;
  /** สิ่งที่ Claude ตอบกลับมาเป็นข้อความ — ไม่มีสาระของ credential อยู่ในนี้ */
  text: string | null;
  /** ข้อความที่ Claude พูดระหว่างทาง เรียงตามที่พูดจริง */
  messages: readonly string[];
  exit_code: number | null;
  authenticated: boolean;
  /** ค่าที่ Claude รายงานเอง — "none" คือค่าที่ถูกต้องสำหรับโหมดนี้ (ใช้ OAuth ไม่ใช่ API key) */
  api_key_source: string | null;
  /** ชื่อ env ที่ส่งเข้าไป ไม่ใช่ค่า */
  env_names: readonly string[];
  /** argv ที่รันจริง — objective ถูกตัดออกเพื่อไม่ให้เนื้องานปนเข้าไปในหลักฐานสิทธิ์ */
  sanitized_argv: readonly string[];
  executable: string;
  sandbox_profile_hash: string | null;
  reason: string | null;
  /**
   * บันทึกดิบของโปรเซส — มีเฉพาะ stream-json ที่ Claude ปล่อยเอง (ข้อความ, สถานะ,
   * apiKeySource) ไม่มีโทเคน ไม่มีค่าจาก Keychain เพราะขอบเขตนี้ไม่เคยอ่านมันเลย
   * สิ่งที่อ่าน Keychain คือตัว Claude เองในโปรเซสของมัน ไม่ใช่โค้ดนี้
   *
   * มีไว้เพื่อให้ Agent Gateway ประกอบผลตามสัญญาเดิม (DNA_OS_AGENT_RESULT_V1) ได้
   * โดยไม่ต้องมีเส้นทางแปลผลชุดที่สอง
   */
  stdout: string;
  stderr: string;
  pid: number | null;
  started_at: string;
  ended_at: string;
}
