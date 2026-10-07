import { recoverInterruptedTasks } from "./gateway";
import type { AgentAdapter } from "./types";
import { startTaskController } from "./controller";

export interface SupervisorHandle {
  stop(): void;
}

/** Process supervisor for the existing Agent Gateway. It does not create a
 * second queue or router: it recovers the durable task log on boot and emits
 * a heartbeat so the transport can expose liveness.
 *
 * ── ทำไมไม่มีการประกาศด้วยเสียงบนตัวจับเวลานี้แล้ว (Owner, 2026-08-31) ──
 * เดิมตัวจับเวลานี้ยิง `runVoiceAnnouncementSweep()` แบบ `void` (ไม่รอผล) ทุก 30
 * วินาที รอบหนึ่งอ่าน `tasks.jsonl` ทั้งไฟล์แล้ว `JSON.parse` ทีละแถว (14.5 MB /
 * 16,611 แถว) และวนงานปลายทางหลายพันใบ เมื่อรอบใช้เวลานานกว่า 30 วินาที รอบใหม่
 * เริ่มทับรอบเดิมจนเธรดหลักถูกยึด 100% และ Core ไม่ตอบ HTTP นาน 3 ชั่วโมง 47 นาที
 *
 * Owner ปฏิเสธระบบประกาศด้วยเสียง จึงถอดออกจากเส้นทางรันของ Core ทั้งเส้น
 * ไม่ใช่แก้ให้เร็วขึ้น และไม่มีระบบใหม่มาแทน — ที่นี่ต้องไม่มี import, timer,
 * watcher หรือ hook ใดที่เริ่มการประกาศด้วยเสียงได้อีก */
export function startAgentGatewaySupervisor(adapters: readonly AgentAdapter[]): SupervisorHandle {
  const controller = startTaskController();
  recoverInterruptedTasks();
  const timer = setInterval(() => {
    recoverInterruptedTasks();
    void adapters;
  }, 30_000);
  return { stop: () => { clearInterval(timer); controller.stop(); } };
}
