"use client";

import { usePathname } from "next/navigation";
import { Briefcase, Users, User, LayoutGrid } from "lucide-react";
import IconRail, { type IconRailItem } from "@/presentation/shell/navigation/IconRail";
import LogoutButton from "@/components/auth/LogoutButton";
import type { WorkspaceNavItem } from "@/core/navigation/resolveNavItems";

// Icon components resolved HERE (client side) from string names passed down
// from the server layout — same reason as components/business/BusinessSidebarNav.tsx
// (now retired): a Server Component cannot pass a component/function reference
// as a prop to a Client Component, only serializable data like an icon name.
const iconMap: { [key: string]: React.ElementType } = { Briefcase, Users, User, LayoutGrid };

// Enterprise Workspace Architecture, Phase 2/3 — the one shared shell for
// Admin/Business/Partner/User Workspace. Reuses components/ui-kit/IconRail as-is
// rather than the full 3-column AppShell: AppShell's middle ListColumn is a
// chat/contact-list pattern (search box + avatar rows) with no equivalent data in
// any of these workspaces today — forcing it in would mean shipping a permanently
// empty search box, not a genuine reuse.
//
// `theme` defaults to "dark" (Business/Partner/User's existing content, unchanged
// since Phase 2). Admin passes "light" — its ~28 real pages were built against
// app/admin/layout.tsx's original bg-stone-50 wrapper and were never visually
// re-audited here; forcing a dark shell onto unverified live business pages
// (jobs/partners/invoices/transactions/debt-tracking) was judged too risky to
// guess at, so the shell adapts to what each workspace already had instead.
export default function WorkspaceShell({
  navItems,
  activeKey,
  userEmail,
  portalStatus,
  theme = "dark",
  excludePathPrefixes = [],
  children,
}: {
  navItems: WorkspaceNavItem[];
  activeKey: string;
  userEmail: string;
  portalStatus?: "shell" | "official";
  theme?: "dark" | "light";
  // Paths that already bring their own full-screen shell (e.g.
  // app/admin/relationships/workspace.tsx's own AppShell + IconRail) render
  // bare here instead of getting a second, nested shell — a second h-screen
  // container inside this one would break their layout. This is also what
  // keeps this component from ever touching the Relationship-Centric
  // Workspace Architecture Freeze's scope: excluded paths are rendered
  // completely untouched, not wrapped, not modified.
  excludePathPrefixes?: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isExcluded = excludePathPrefixes.some((p) => pathname?.startsWith(p));

  if (isExcluded) {
    return <>{children}</>;
  }

  const railItems: IconRailItem[] = navItems.map((item) => ({
    key: item.key,
    label: item.label,
    icon: iconMap[item.icon] ?? Briefcase,
    href: item.href,
  }));

  const isDark = theme === "dark";

  return (
    <div className="flex w-full h-screen bg-white overflow-hidden">
      <IconRail items={railItems} activeKey={activeKey} />
      <div
        className={
          "flex-1 min-w-0 h-full flex flex-col overflow-hidden " +
          (isDark ? "bg-black" : "bg-stone-50")
        }
      >
        <div
          className={
            "flex-shrink-0 h-12 border-b flex items-center justify-between gap-3 px-4 " +
            (isDark ? "border-stone-800" : "border-stone-200")
          }
        >
          {portalStatus === "shell" ? (
            <span
              className={
                "text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border " +
                (isDark
                  ? "text-amber-400 border-amber-800 bg-amber-950/40"
                  : "text-amber-700 border-amber-200 bg-amber-50")
              }
            >
              Shell — ยังไม่เป็นทางการ
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <span className={"text-xs truncate max-w-[200px] " + (isDark ? "text-stone-500" : "text-stone-400")}>
              {userEmail}
            </span>
            <LogoutButton />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
