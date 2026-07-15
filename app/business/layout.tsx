import portals from "@/registry/portals.json";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import permissions from "@/registry/permissions.json";
import type { AppRole } from "@/core/auth/session";
import { resolveNavItems } from "@/core/navigation/resolveNavItems";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";

const BUSINESS_ROLES = permissions.route_access.find(r => r.prefix === "/business")!.roles as AppRole[];

// Main layout for the Business Portal (Enterprise Workspace Architecture,
// Phase 2) — now uses the shared WorkspaceShell instead of the retired
// components/business/BusinessSidebarNav.tsx. A partner or admin-tier user
// now sees both Business and any other workspace registry/permissions.json's
// route_access already authorizes them for, via resolveNavItems.
export default async function BusinessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuthPage("/business", BUSINESS_ROLES);
  const navItems = resolveNavItems(user.role);

  return (
    <WorkspaceShell
      navItems={navItems}
      activeKey="business"
      userEmail={user.email}
      portalStatus={portals.portals.business_portal.status as "shell" | "official"}
    >
      {children}
    </WorkspaceShell>
  );
}