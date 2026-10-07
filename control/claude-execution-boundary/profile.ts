/**
 * หน้าที่: โปรไฟล์ sandbox เฉพาะของ Claude Code — สิทธิ์ที่ Agent ทั่วไปไม่มี
 * อยู่ที่นี่ที่เดียว และผูกกับ executable ตัวเดียว
 * (Owner, IMPLEMENT_LOCAL_CLAUDE_CODE_TRUSTED_EXECUTION_BOUNDARY ข้อ 6).
 *
 * ทำไมไม่ใช้ control/runtime-adapter: `MANDATORY_READ_DENY_SUBPATHS` ของมัน
 * ปิด `Library/Keychains` แบบตายตัวและถูก emit หลัง allow ของผู้เรียกเสมอ
 * (Seatbelt เป็น last-match-wins) — นั่นเป็นการตัดสินใจที่ถูกต้องสำหรับ
 * runtime ทั่วไป และเราไม่แก้มัน จึงต้องมีโปรไฟล์ของตัวเองแทนการเจาะของกลาง
 *
 * ทำไมไม่ใช้ control/agent-host: โปรไฟล์นั้นคือกรงของ Agent ทั่วไป และมันต้อง
 * ปฏิเสธ Keychain ต่อไป การเติมสิทธิ์ลงไปที่นั่นจะเปิดให้ Agent ทุกตัว ไม่ใช่
 * เฉพาะตัวที่เชื่อถือได้
 *
 * สิทธิ์ที่เพิ่มขึ้นจากกรงทั่วไปมีสองอย่างเท่านั้น และพิสูจน์แล้วว่าต้องมีคู่กัน:
 *   - exec `/usr/bin/security`   (ขาดอันนี้ Claude crash ตอนสตาร์ต)
 *   - อ่าน `~/Library/Keychains` (ขาดอันนี้ได้ "Not logged in")
 * เปิดข้างเดียวไม่พอ — วัดแล้วทั้งสองกรณี
 *
 * Input: workspace ที่อนุมัติแล้ว + executable ที่ระบบ resolve เอง.
 * Output: `buildClaudeProfile`.
 * Dependency ที่อนุญาต: ../runtime-adapter/contract.ts (escapeSbplString), node:os, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามรับ SBPL ดิบจากผู้เรียก, ห้ามให้ผู้เรียกกำหนด path ใด ๆ
 * นอกจาก workspace, ห้ามเปิด exec ให้ไบนารีอื่นนอกจากสองตัวที่ระบุชื่อไว้.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { escapeSbplString } from "../runtime-adapter/contract";

/** ไบนารีเดียวที่โปรไฟล์นี้อนุญาตให้เรียกเพื่อคุยกับ Keychain ของเครื่อง */
export const SECURITY_BINARY = "/usr/bin/security";

export interface ClaudeProfileInput {
  /** absolute path ของ workspace ที่ DNA OS อนุมัติ */
  workspace: string;
  /** realpath ของ Claude Code ที่ระบบ resolve เอง ไม่ใช่ค่าจากผู้เรียก */
  executable: string;
  /** path ที่อ่านได้เพิ่ม (เช่น source ที่มอบหมาย) — อ่านอย่างเดียวเสมอ */
  readPaths?: readonly string[];
}

/**
 * ประกอบโปรไฟล์จริง ลำดับสำคัญ: Seatbelt ตัดสินด้วยกฎที่ตรงเป็น "อันสุดท้าย"
 * กฎปิดความลับที่ไม่เกี่ยวกับ Claude จึงถูกวางไว้ท้ายสุดเพื่อให้ชนะเสมอ
 */
export function buildClaudeProfile(input: ClaudeProfileInput): string {
  const home = homedir();
  const q = (p: string): string => escapeSbplString(p);
  const lines = [
    "(version 1)",
    "(deny default)",
    "(allow mach-lookup)",
    "(allow sysctl-read)",
    "(allow signal)",
    "(allow ipc-posix-shm)",
    "(allow process-fork)",
    "(allow file-read-metadata)",
    "(allow file-read*)",
    // บ้านของผู้ใช้ปิดก่อน แล้วค่อยเปิดคืนเฉพาะสิ่งที่ Claude ต้องใช้จริง
    `(deny file-read* (subpath "${q("/Users")}"))`,
    `(allow file-read* (subpath "${q("/usr")}"))`,
    `(allow file-read* (subpath "${q(input.workspace)}"))`,
    `(allow file-write* (subpath "${q(input.workspace)}"))`,
    `(allow process-exec (literal "${q(input.executable)}"))`,
    // สองบรรทัดนี้คือทั้งหมดที่ทำให้ machine auth ใช้ได้ — และมีเฉพาะที่นี่
    `(allow process-exec (literal "${q(SECURITY_BINARY)}"))`,
    `(allow file-read* (subpath "${q(join(home, "Library/Keychains"))}"))`,
    // Claude Code ต้องคุยกับบริการของมันเอง ดูข้อจำกัดที่ประกาศไว้ใน ./boundary.ts
    "(allow network-outbound)",
    "(allow system-socket)",
  ];
  for (const p of input.readPaths ?? []) lines.push(`(allow file-read* (subpath "${q(p)}"))`);
  // ปิดท้ายเสมอ: ความลับที่ไม่เกี่ยวกับ Claude ต้องอ่านไม่ได้แม้อยู่ในขอบเขตนี้
  lines.push(
    `(deny file-read* (subpath "${q(join(home, ".ssh"))}"))`,
    `(deny file-read* (subpath "${q(join(home, ".config/gh"))}"))`,
    '(deny file-read* (regex #"\\.env($|\\.)"))',
  );
  return lines.join("\n") + "\n";
}
