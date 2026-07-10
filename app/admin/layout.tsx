import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";

/**
 * Main layout for the admin area.
 *
 * The old 13-item text sidebar (AdminSidebarNav, still at
 * components/admin/AdminSidebarNav.tsx — kept, not deleted) is switched off
 * here (owner request 2026-07-11: "เมนูฟังก์ชันด้านข้างเอาออกไป เหลือเฉพาะ
 * [7-icon rail]... นอกนั้นเอาไปซ่อนไว้หลังบ้านก่อน"). Pages that already use
 * components/ui-kit/AppShell (e.g. app/admin/line-customers/page.tsx) bring
 * their own IconRail; pages that don't yet have no left nav until they're
 * migrated too — intentional, temporary, not a regression to "fix" alone.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuthPage("/admin", ADMIN_TIER);

  return (
    <div className="min-h-screen bg-stone-50">
      {children}
    </div>
  );
}