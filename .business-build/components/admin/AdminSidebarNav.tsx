"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import LogoutButton from "@/components/auth/LogoutButton";
import {
  BookOpen,
  Cpu,
  Database,
  LayoutGrid,
  Network,
  Plug,
  Puzzle,
  Shield,
} from "lucide-react";

// LINE's chat-bubble silhouette (own drawing, not the LINE wordmark/logo) —
// used so "ลูกค้า LINE" is recognizable as LINE at a glance in the sidebar.
function LineChat({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 3C6.48 3 2 6.69 2 11.25c0 4.11 3.61 7.55 8.48 8.16.33.07.78.22.9.5.1.26.07.65.03.9l-.15.9c-.04.26-.2 1.03.9.56 1.1-.47 5.95-3.5 8.12-6 .1-.11.14-.24.14-.38C22 12.34 22 11.79 22 11.25 22 6.69 17.52 3 12 3Z"
        fill="currentColor"
      />
    </svg>
  );
}

// Icon components resolved HERE (client side) from string names passed down
// from the server layout — a Server Component cannot pass a component
// reference (function) as a prop to a Client Component, only serializable
// data like this icon-name string. That mismatch was the "Functions cannot
// be passed directly to Client Components" 500 on every /admin request.
const iconMap: { [key: string]: React.ElementType } = {
  BookOpen, Cpu, Database, LayoutGrid, Network, Plug, Puzzle, Shield, LineChat
};

type NavItem = { href: string; label: string; icon: string; group?: string };

function NavLink({ href, label, icon, badge }: NavItem & { badge?: number }) {
  const pathname = usePathname();
  const isActive = pathname === href;
  const Icon = iconMap[icon] || Puzzle;

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        isActive
          ? "bg-blue-50 text-blue-700"
          : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
      }`}
    >
      <Icon className={icon === "LineChat" ? "w-4 h-4 text-[#06C755]" : "w-4 h-4"} />
      <span className="flex-1">{label}</span>
      {!!badge && (
        <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}

export default function AdminSidebarNav({
  navItems,
  headerLabel,
  headerIcon,
  userEmail,
}: {
  navItems: NavItem[];
  headerLabel: string;
  headerIcon: string;
  userEmail: string;
}) {
  const HeaderIcon = iconMap[headerIcon] || LayoutGrid;
  const businessItems = navItems.filter((i) => i.group !== "dev");
  const devItems = navItems.filter((i) => i.group === "dev");

  // Red badge on "ลูกค้า LINE" for outbound messages waiting on human
  // approval (Rule 72) — visible from anywhere in the admin, not just when
  // the page happens to be open.
  const [pendingDrafts, setPendingDrafts] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/admin/outbound-drafts");
        const d = await res.json();
        if (!cancelled) setPendingDrafts((d.drafts ?? []).filter((x: { status: string }) => x.status === "pending_review").length);
      } catch { /* silent — badge just stays at last known count */ }
    }
    poll();
    const id = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <aside className="w-60 flex-shrink-0 bg-white border-r border-stone-200 p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-6">
        <HeaderIcon className="w-5 h-5 text-blue-600" />
        <h1 className="font-bold text-stone-800 tracking-tight">{headerLabel}</h1>
      </div>
      <nav className="space-y-1 flex-1 overflow-y-auto">
        {businessItems.map((item) => (
          <NavLink key={item.href} {...item} badge={item.href === "/admin/line-customers" ? pendingDrafts : undefined} />
        ))}

        {devItems.length > 0 && (
          <details className="pt-3 mt-3 border-t border-stone-100 group">
            <summary className="px-3 py-1.5 text-xs font-semibold text-stone-400 uppercase tracking-wide cursor-pointer select-none hover:text-stone-600">
              เครื่องมือนักพัฒนา
            </summary>
            <div className="space-y-1 mt-1">
              {devItems.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </div>
          </details>
        )}
      </nav>
      <div className="pt-4 mt-4 border-t border-stone-100">
        <p className="px-1 text-[10px] text-stone-400 truncate mb-1">{userEmail}</p>
        <LogoutButton />
      </div>
    </aside>
  );
}