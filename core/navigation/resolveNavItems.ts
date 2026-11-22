import permissions from "@/registry/permissions.json";
import type { AppRole } from "@/core/auth/session";

export interface WorkspaceNavItem {
  key: string;
  label: string;
  icon: string;
  href: string;
}

// Enterprise Workspace Architecture, Phase 2/3 — the one place that decides
// which workspaces a role can switch between via the shared IconRail.
//
// This is an ALLOW-list of real workspaces, not a filtered deny-list of
// developer/architecture pages — Architecture/Registry/Drivers/Observer/etc.
// are excluded by construction (they were never added here), not by a
// special-case rule that a future addition could forget to apply. Building
// their real home (Infrastructure Workspace) is explicitly out of scope here
// (owner decision, 2026-07-14) — deferred to its own phase, not this list.
//
// `prefix` is what registry/permissions.json's route_access is keyed on
// (permission check); `href` is where the rail link actually goes — they
// differ for admin so the rail never round-trips through app/admin/page.tsx's
// own redirect(), same reasoning as workspace_landing in permissions.json.
const WORKSPACES: { prefix: string; href: string; key: string; label: string; icon: string }[] = [
  { prefix: "/admin", href: "/admin/dashboard", key: "admin", label: "Admin", icon: "LayoutGrid" },
  { prefix: "/business", href: "/business", key: "business", label: "Business", icon: "Briefcase" },
  { prefix: "/partner", href: "/partner", key: "partner", label: "Partner", icon: "Users" },
  { prefix: "/user", href: "/user", key: "user", label: "User", icon: "User" },
];

// A role sees every workspace registry/permissions.json's route_access
// already authorizes it for (e.g. partner sees both Partner and Business,
// matching route_access's existing /business roles list) — this is what
// makes /business reachable in practice instead of orphaned, without
// inventing a new role or a new landing decision.
export function resolveNavItems(role: AppRole): WorkspaceNavItem[] {
  return WORKSPACES.filter((w) => {
    const routeAccess = permissions.route_access as Array<{ prefix: string; roles: AppRole[] }>;
    const entry = routeAccess.find((r) => r.prefix === w.prefix);
    return !!entry?.roles.includes(role);
  }).map((w) => ({ key: w.key, label: w.label, icon: w.icon, href: w.href }));
}
