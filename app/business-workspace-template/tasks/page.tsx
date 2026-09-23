import { TemplateShell } from "@/presentation/shell/TemplateShell";

// Business Workspace Template — งาน (Tasks)
//
// PRESENTATION RESET (owner-directed) — structure only, not a redesign:
// KPI cards / ตารางงาน / calendar card / panels / pills ถูกเอาออกจาก presentation แล้ว
// เหลือ LEFT NAV | (HEADER + MAIN WORK AREA) เปล่า ๆ ให้ Owner จัดตำแหน่งเอง
// business logic / capability / source ไม่ได้ถูกลบ — ไฟล์นี้ทำหน้าที่แค่ประกอบโครง
export default function BusinessWorkspaceTasksPage() {
  return <TemplateShell title="งาน" />;
}
