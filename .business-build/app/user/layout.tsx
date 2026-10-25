import { requireAuthPage } from "@/core/auth/requireAuthPage";
import permissions from "@/registry/permissions.json";
import portals from "@/registry/portals.json";
import type { AppRole } from "@/core/auth/session";
import { resolveNavItems } from "@/core/navigation/resolveNavItems";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";

const USER_ROLES = permissions.route_access.find((r) => r.prefix === "/user")!.roles as AppRole[];

// Enterprise Workspace Architecture, Phase 2 — auth + shell now live here
// (matches app/admin/layout.tsx's and app/business/layout.tsx's existing
// pattern), page.tsx is content only. Same requireAuthPage call, same roles,
// same redirect behavior as before this file existed — nothing about the
// auth flow itself changed, only where the call is made from.
export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuthPage("/user", USER_ROLES);
  const navItems = resolveNavItems(user.role);

  return (
    <WorkspaceShell
      navItems={navItems}
      activeKey="user"
      userEmail={user.email}
      portalStatus={portals.portals.user_portal.status as "shell" | "official"}
    >
      {children}
    </WorkspaceShell>
  );
}
