import portals from "@/registry/portals.json";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import AdminSidebarNav from "@/components/admin/AdminSidebarNav";

/**
 * Main layout for the Documentation Portal.
 * It includes a sidebar for navigating between different registry explorers.
 * Icon NAMES (strings) are passed to AdminSidebarNav, not resolved icon
 * components — a Server Component can't pass a component/function reference
 * as a prop to a Client Component. Resolution happens client-side.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuthPage("/admin", ADMIN_TIER);

  const portalInfo = portals.main.find(p => p.href.includes('/admin'));

  return (
    <div className="flex min-h-screen bg-stone-50">
      <AdminSidebarNav
        navItems={portals.docs}
        headerLabel={portalInfo?.label || "Documentation"}
        headerIcon={portalInfo?.icon || "LayoutGrid"}
        userEmail={user.email}
      />

      {/* Main Content */}
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}