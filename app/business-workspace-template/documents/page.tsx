import { TemplateShell } from "@/presentation/shell/TemplateShell";

// Business Workspace Template — เอกสาร (Documents)
//
// PRESENTATION RESET (owner-directed) — structure only, not a redesign:
// type cards (PO/DO/INV/Receipt/PV) / ตารางเอกสาร / tool panels / flow ถูกเอาออก
// จาก presentation แล้ว เหลือ LEFT NAV | (HEADER + MAIN WORK AREA) เปล่า ๆ
// business logic / capability / source ไม่ได้ถูกลบ — ไฟล์นี้ทำหน้าที่แค่ประกอบโครง
export default function BusinessWorkspaceDocumentsPage() {
  return <TemplateShell title="เอกสาร" />;
}
