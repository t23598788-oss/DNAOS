import { requireAuthPage } from "@/core/auth/requireAuthPage";
import permissions from "@/registry/permissions.json";
import type { AppRole } from "@/core/auth/session";
import { resolveNavItems } from "@/core/navigation/resolveNavItems";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";

const TRANSPORTER_ROLES = permissions.route_access.find((r) => r.prefix === "/transporter")!.roles as AppRole[];

/** Transporter surface — same session/role authority as every other portal. */
export default async function TransporterLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuthPage("/transporter", TRANSPORTER_ROLES);
  const navItems = resolveNavItems(user.role);

  return (
    <WorkspaceShell navItems={navItems} activeKey="transporter" userEmail={user.email}>
      {children}
    </WorkspaceShell>
  );
}
