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
  // OWNER DIRECTIVE 2026-10-15: เดิมผูกกับ /admin/connectors (หน้าจัดการผู้ให้บริการ
  // ภายนอก — GitHub/Railway/Vercel/Supabase). หน้าจอผู้ใช้ธุรกิจไม่ควรพาไปที่นั่นแล้ว
  // จึงคงเป็น "ยังไม่เชื่อม" ตรง ๆ (ห้ามผูก route ที่เจ้าของสั่งห้าม) — หน้าจริงยังอยู่
  connections: { pendingReason: "ยังไม่ได้เชื่อมการจัดการการเชื่อมต่อในพื้นที่ผู้ใช้ธุรกิจ" },
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

/**
 * Static service boxes, not a second registry or infrastructure provisioner.
 *
 * OWNER DIRECTIVE 2026-10-15 — BUSINESS USER SURFACE ONLY: entries that pointed at
 * Developer / Infrastructure / credentials screens (/admin/infrastructure,
 * /admin/schema-audit, /admin/connectors, /admin/settings, /admin/devices,
 * /admin/engine-explorer, /admin/backup) were removed from this business-surface
 * source. Those screens still exist and still work — they are now reachable only
 * from the Developer Workspace (/developer, role_tiers.developer_tier) and are
 * closed at the server for the operational surface (registry/permissions.json →
 * capability_actions.deny_pages). Nothing was deleted from the backend.
 */
export const SETTINGS_BOXES = [
  { key: "files", label: "ไฟล์และเอกสาร", route: "/admin/storage" },
  { key: "access", label: "ผู้ใช้และสิทธิ์", route: "/admin/users" },
  { key: "history", label: "เหตุการณ์และหลักฐาน", route: "/admin/event-inbox" },
] as const;

/** Layout changes can only select known, granted keys; they cannot grant access. */
export function orderGrantedTools<T extends { key: string }>(tools: readonly T[], allowed: readonly string[], order: readonly string[]): T[] {
  const byKey = new Map(tools.filter(t => allowed.includes(t.key)).map(t => [t.key, t]));
  return [...new Set([...order, ...byKey.keys()])].flatMap(key => {
    const tool = byKey.get(key);
    return tool ? [tool] : [];
  });
}
