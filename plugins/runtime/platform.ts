/**
 * Platform Detection — Browser Safe
 * ไม่ import child_process
 */
export function isLocalMac(): boolean {
  return typeof process !== "undefined" && process.platform === "darwin";
}
