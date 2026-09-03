/**
 * หน้าที่: รวมสองเลนให้เป็นฟีดเดียวที่หน้าจอ #command อ่านได้
 *
 * อ่านจากสโตร์สายเลือดเดิมของ control/owner-command เท่านั้น ไม่มีสโตร์ใหม่
 * แถวของ Owner กับแถวที่ระบบสร้างอยู่ในไฟล์เดียวกันอยู่แล้ว ต่างกันที่ detail
 * ซึ่งบันทึกต้นทางไว้ตอนเขียน — ฟีดนี้จึงเป็นการ "อ่านให้ถูก" ไม่ใช่การรวมสโตร์
 *
 * Input: none
 * Output: `listOwnerConsoleItems`
 * Dependency ที่อนุญาต: ../owner-command/contract.ts, ./types.ts
 * สิ่งที่ห้ามแตะ: ห้ามให้ฟีดนี้เขียนอะไร และห้ามเดาต้นทางจากข้อความของคำสั่ง
 */

import { listCommandLineage } from "../owner-command/contract";
import type { OriginKind } from "./types";

export interface ConsoleFeedItem {
  readonly origin_kind: OriginKind;
  readonly owner_visible: true;
  readonly command_id: string;
  readonly work_id: string | null;
  readonly task_id: string | null;
  readonly stage: string;
  readonly detail: string;
  readonly recorded_at: string;
  readonly origin_event_id: string | null;
}

const LANE_MARKER = "control/owner-error-lane";

/** ต้นทางมาจากบันทึกตอนเขียน ไม่ใช่จากการอ่านใจข้อความคำสั่ง */
function originOf(detail: string): OriginKind {
  return detail.startsWith(LANE_MARKER) ? "SYSTEM_ERROR_COMMAND" : "OWNER_COMMAND";
}

function eventIdOf(detail: string): string | null {
  const m = /event=(evt-[0-9a-f]+)/.exec(detail);
  return m ? m[1] : null;
}

/**
 * รายการล่าสุดของทั้งสองเลน เรียงใหม่ก่อน
 *
 * หนึ่งคำสั่งมีหลายแถว (command_received แล้วตามด้วยผล) — ฟีดคืนแถวล่าสุดต่อ
 * คำสั่ง เพื่อให้หน้าจอเห็นสถานะปัจจุบัน ไม่ใช่ประวัติทุกขั้น
 */
export function listOwnerConsoleItems(limit = 50): readonly ConsoleFeedItem[] {
  const all = listCommandLineage(Math.max(limit * 4, 200));

  // ต้นทางเป็นคุณสมบัติของ "คำสั่ง" ไม่ใช่ของ "แถว": แถวขั้นหลัง ๆ บันทึกผลของ
  // การจัดเส้นทาง จึงไม่มีเครื่องหมายของเลนอยู่ในนั้น การอ่านต้นทางจากแถวล่าสุด
  // จะทำให้ความผิดพลาดของระบบกลายเป็นคำสั่งที่ Owner พิมพ์เอง
  const originByCommand = new Map<string, OriginKind>();
  const eventByCommand = new Map<string, string>();
  for (const r of all) {
    const commandId = r.command_id ?? r.envelope_id;
    if (!originByCommand.has(commandId)) originByCommand.set(commandId, originOf(r.detail));
    const evt = eventIdOf(r.detail);
    if (evt !== null && !eventByCommand.has(commandId)) eventByCommand.set(commandId, evt);
  }

  const latest = new Map<string, ConsoleFeedItem>();
  for (const r of all) {
    const commandId = r.command_id ?? r.envelope_id;
    latest.set(commandId, {
      origin_kind: originByCommand.get(commandId) ?? "OWNER_COMMAND", owner_visible: true,
      command_id: commandId, work_id: r.work_id ?? null, task_id: r.task_id,
      stage: r.stage, detail: r.detail, recorded_at: r.recorded_at,
      origin_event_id: eventByCommand.get(commandId) ?? null,
    });
  }
  return [...latest.values()].sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1)).slice(0, limit);
}
