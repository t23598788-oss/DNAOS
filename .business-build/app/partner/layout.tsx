import { requireAuthPage } from "@/core/auth/requireAuthPage";
import permissions from "@/registry/permissions.json";
import portals from "@/registry/portals.json";
import type { AppRole } from "@/core/auth/session";
import { resolveNavItems } from "@/core/navigation/resolveNavItems";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";

const PARTNER_ROLES = permissions.route_access.find((r) => r.prefix === "/partner")!.roles as AppRole[];

// Enterprise Workspace Architecture, Phase 2 — same pattern as app/user/layout.tsx.
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuthPage("/partner", PARTNER_ROLES);
  const navItems = resolveNavItems(user.role);

  return (
    <WorkspaceShell
      navItems={navItems}
      activeKey="partner"
      userEmail={user.email}
      portalStatus={portals.portals.partner_portal.status as "shell" | "official"}
    >
      {children}
    </WorkspaceShell>
  );
}
