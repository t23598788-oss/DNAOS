import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { resolveNavItems } from "@/core/navigation/resolveNavItems";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";

/**
 * Main layout for the admin area (Single Workspace Shell migration,
 * completing what was paused as EWA-P3).
 *
 * Every /admin/* page now renders inside the shared WorkspaceShell (same
 * component Business/Partner/User already use) EXCEPT app/admin/relationships/*
 * and app/admin/line-customers, both excluded via WorkspaceShell's
 * excludePathPrefixes and rendered completely bare/untouched — each already
 * brings its own full-screen AppShell with its own icon rail, so wrapping
 * either in WorkspaceShell would nest two shells inside one another.
 * relationships/* additionally sits inside the separate, still-active
 * Relationship-Centric Workspace Architecture Freeze (registry/CURRENT_STATE.json).
 * The shell is infrastructure (nav/header/status/command); the page is content —
 * these two pages already own their infrastructure, so they stay content-only
 * exceptions, not migrations into the shared shell.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuthPage("/admin", ADMIN_TIER);
  const navItems = resolveNavItems(user.role);

  return (
    <WorkspaceShell
      navItems={navItems}
      activeKey="admin"
      userEmail={user.email}
      theme="light"
      excludePathPrefixes={["/admin/relationships", "/admin/line-customers"]}
    >
      {children}
    </WorkspaceShell>
  );
}