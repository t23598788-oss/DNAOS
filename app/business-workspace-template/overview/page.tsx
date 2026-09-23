import { TemplateShell } from "@/presentation/shell/TemplateShell";

// Business Workspace Template — ภาพรวม (Overview)
//
// PRESENTATION RESET (owner-directed) — structure only, not a redesign:
// ทุก Card/Box/Panel/KPI/ตาราง/รายการ/Empty State ถูกเอาออกจาก presentation แล้ว
// เหลือ LEFT NAV | (HEADER + MAIN WORK AREA) เปล่า ๆ ให้ Owner จัดตำแหน่งเอง
// business logic / capability / source ไม่ได้ถูกลบ — ไฟล์นี้ทำหน้าที่แค่ประกอบโครง
export default function BusinessWorkspaceOverviewPage() {
  return <TemplateShell title="ภาพรวม" />;
}
