/**
 * ทางเข้าของการเขียนไฟล์แบบมีกรง — อยู่ฝั่ง DNA OS โดยตั้งใจ
 *
 * แยกออกจาก ./contract.ts เมื่อ 2026-09-04 เพราะ contract.ts เป็นสัญญาของ
 * "ด่านซอร์ส" (Canonical Source Write Authority) ซึ่งต้องไม่พึ่งพา
 * implementation ของ DNA OS — และ sandboxed-executor เรียก
 * control/agent-host/contract#launchAgent ซึ่งเป็น implementation ฝั่ง DNA OS
 *
 * การเขียนไฟล์จริงยังเดินผ่านด่านซอร์สเหมือนเดิม สิ่งที่ต่างคือใครเป็นคนรัน
 */
export { executeFileWriteSandboxed } from "./sandboxed-executor";
export type { FileWriteRefusalCode, FileWriteRequest, FileWriteResult, FileWriteStatus } from "./types";
