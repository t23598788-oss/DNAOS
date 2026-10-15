import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { DEVELOPER_TIER } from "@/core/auth/session";

/**
 * DEVELOPER WORKSPACE (owner directive 2026-10-12; access separated 2026-10-15)
 * — /developer
 *
 * ทางเข้าของ "ระบบพัฒนา" ที่แยก URL และ Navigation ออกจาก Business อย่างชัดเจน:
 *  - หน้านี้ใช้ requireAuthPage(DEVELOPER_TIER) — tier ที่แยกออกจาก admin_tier
 *    แล้ว (role_tiers.developer_tier = super_admin เท่านั้น, registry/permissions.json)
 *    employee / ผู้ใช้งานธุรกิจทั่วไปจึงเข้าไม่ได้ · ไม่มี role หรือระบบ auth ใหม่
 *  - ไม่ render WorkspaceToolNavigation (เมนูธุรกิจ) เลย — Developer
 *    Workspace มี navigation ของตัวเอง (components/admin/AdminSidebarNav
 *    กลุ่ม "เครื่องมือนักพัฒนา") ส่วน Business ยังใช้เมนูเดิมทุกประการ
 *  - shell ใช้ .dna-admin-shell/.dna-admin-content ตัวเดิมจาก
 *    app/globals.css — ไม่มี UI framework ใหม่ ไม่มี component ใหม่ซ้ำ
 *  - การเปิดเส้นทางนี้เป็น entry เดียวที่ middleware.ts สลับ surface เป็น
 *    development — และ middleware ตรวจ role จาก registry ก่อนสลับ (fail-closed)
 */
export default async function DeveloperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuthPage("/developer", DEVELOPER_TIER);

  return (
    <div className="dna-admin-shell bg-stone-50">
      <div className="dna-admin-content">{children}</div>
    </div>
  );
}
