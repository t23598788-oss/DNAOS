import portals from "@/registry/portals.json";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import permissions from "@/registry/permissions.json";
import type { AppRole } from "@/core/auth/session";
import BusinessSidebarNav from "@/components/business/BusinessSidebarNav";

const BUSINESS_ROLES = permissions.route_access.find(r => r.prefix === "/business")!.roles as AppRole[];

/**
 * Main layout for the Business Portal.
 * It includes a sidebar for navigating between different role-based dashboards.
 * Icon NAMES (strings) are passed to BusinessSidebarNav, not resolved icon
 * components — a Server Component can't pass a component/function reference
 * as a prop to a Client Component. Resolution happens client-side.
 */
export default async function BusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuthPage("/business", BUSINESS_ROLES);

  const portalInfo = portals.main.find(p => p.label.includes('Business'));

  return (
    <div className="flex min-h-screen bg-black">
      <BusinessSidebarNav
        navItems={portals.business}
        headerLabel={portalInfo?.label || "Business Portal"}
        headerIcon={portalInfo?.icon || "Briefcase"}
        userEmail={user.email}
      />

      {/* Main Content */}
      <main className="flex-1 bg-black">
        {children}
      </main>
    </div>
  );
}