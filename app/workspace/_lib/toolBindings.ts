/** Presentation bindings only. Routes keep their own server authority checks.
 * A route binding means an existing screen, NOT a connected/healthy provider.
 * Never put executable URLs, credentials or permission grants in layout data.
 */
export interface ToolBinding {
  route?: string;
  targetIds?: readonly string[];
  pendingReason: string;
}

export const TOOL_BINDINGS: Record<string, ToolBinding> = {
  documents: { route: "/admin/create-document", pendingReason: "เปิดเครื่องมือเอกสารเดิมเพื่อสร้างและดูเอกสาร" },
  chat: { route: "/admin/relationships", pendingReason: "เปิดพื้นที่ข้อความเดิม — ยังไม่ได้รวมทุกช่องทางในกล่องเดียว" },
  connections: { route: "/admin/connectors", pendingReason: "จัดการการเชื่อมต่อผ่านหน้าตั้งค่าเดิม" },
  finance: { route: "/admin/finance", pendingReason: "เปิดระบบการเงินเดิม" },
  people: { targetIds: ["partners-table"], pendingReason: "ยังไม่ได้รับข้อมูลคู่ค้าจากระบบกลาง" },
  jobs: { targetIds: ["jobs-table"], pendingReason: "ยังไม่ได้รับข้อมูลงานจากระบบกลาง" },
  search: { pendingReason: "ยังไม่ได้เชื่อมการค้นหารวม" },
  changes: { pendingReason: "ยังไม่ได้เชื่อมผลการเปลี่ยนแปลง" },
  problems: { pendingReason: "ยังไม่ได้เชื่อมผลตรวจสอบ" },
  history: { pendingReason: "ยังไม่ได้เชื่อมประวัติของรายการที่เลือก" },
  accounting: { pendingReason: "ยังไม่ได้เชื่อมเครื่องมือบัญชีในพื้นที่นี้" },
  vehicles: { route: "/admin/equipment", pendingReason: "เปิดระบบอุปกรณ์เดิม — ไม่ใช่สถานะ GPS สด" },
  materials: { route: "/admin/pits", pendingReason: "เปิดแหล่งวัสดุเดิม" },
  transfer: { route: "/admin/storage", pendingReason: "เปิดที่จัดเก็บเดิม — แปลงไฟล์และแชร์รวมยังรอเชื่อม" },
};

/** Static service boxes, not a second registry or infrastructure provisioner. */
export const SETTINGS_BOXES = [
  { key: "database", label: "ฐานข้อมูลและบริการ", route: "/admin/infrastructure" },
  { key: "schema", label: "โครงสร้างข้อมูล / Schema", route: "/admin/schema-audit" },
  { key: "files", label: "ไฟล์และเอกสาร", route: "/admin/storage" },
  { key: "access", label: "ผู้ใช้และสิทธิ์", route: "/admin/users" },
  { key: "connect", label: "Connect / ผู้ให้บริการ", route: "/admin/connectors" },
  { key: "capabilities", label: "งานและความสามารถ", route: "/admin/engine-explorer" },
  { key: "history", label: "เหตุการณ์และหลักฐาน", route: "/admin/event-inbox" },
  { key: "backup", label: "สำรองและกู้คืน", route: "/admin/backup" },
  { key: "configuration", label: "ตั้งค่าระบบ", route: "/admin/settings" },
] as const;

/** Layout changes can only select known, granted keys; they cannot grant access. */
export function orderGrantedTools<T extends { key: string }>(tools: readonly T[], allowed: readonly string[], order: readonly string[]): T[] {
  const byKey = new Map(tools.filter(t => allowed.includes(t.key)).map(t => [t.key, t]));
  return [...new Set([...order, ...byKey.keys()])].flatMap(key => {
    const tool = byKey.get(key);
    return tool ? [tool] : [];
  });
}
