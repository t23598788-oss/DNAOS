/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (clock).
 *
 * Input: none.
 * Output: `nowIso`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never widen this file to spawn a process or make a
 * network call — this folder plans/gates only, this round.
 */

export function nowIso(): string {
  return new Date().toISOString();
}
