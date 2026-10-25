import { requirePlatformOperatorPage } from "@/core/auth/requireAuthPage";


/**
 * DEVELOPER WORKSPACE (owner directive 2026-10-12) — /developer
 *
 * ทางเข้าของ "ระบบพัฒนา" ที่แยก URL และ Navigation ออกจาก Business
 * อย่างชัดเจน:
 *  - หน้านี้ใช้ requirePlatformOperatorPage (owner directive 2026-10-20):
 *    เฉพาะ platform operator เท่านั้น — Business admin/employee ถูกปฏิเสธ
 *    (ที่แยกคือ surface และสิทธิ์ระดับ platform ไม่ใช่ role ธุรกิจ)
 *  - ไม่ render WorkspaceToolNavigation (เมนูธุรกิจ) เลย — Developer
 *    Workspace มี navigation ของตัวเอง (components/admin/AdminSidebarNav
 *    กลุ่ม "เครื่องมือนักพัฒนา") ส่วน Business ยังใช้เมนูเดิมทุกประการ
 *  - shell ใช้ .dna-admin-shell/.dna-admin-content ตัวเดิมจาก
 *    app/globals.css — ไม่มี UI framework ใหม่ ไม่มี component ใหม่ซ้ำ
 *  - การเปิดเส้นทางนี้เป็นหนึ่งใน entry ที่ middleware.ts สลับ surface
 *    เป็น development (core/auth/surfacePolicy.ts#surfaceForPagePath)
 */
export default async function DeveloperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePlatformOperatorPage("/developer");

  return (
    <div className="dna-admin-shell bg-stone-50">
      <div className="dna-admin-content">{children}</div>
    </div>
  );
}
