import { TemplateShell } from "@/presentation/shell/TemplateShell";

// Business Workspace Template — พื้นที่ทำงาน (Workspace)
//
// PRESENTATION RESET (owner-directed) — structure only, not a redesign:
// dark hero box / cards / panels / lists / pills ถูกเอาออกจาก presentation แล้ว
// เหลือ LEFT NAV | (HEADER + MAIN WORK AREA) เปล่า ๆ ให้ Owner จัดตำแหน่งเอง
// business logic / capability / source ไม่ได้ถูกลบ — ไฟล์นี้ทำหน้าที่แค่ประกอบโครง
export default function BusinessWorkspacePage() {
  return <TemplateShell title="พื้นที่ทำงาน" />;
}
