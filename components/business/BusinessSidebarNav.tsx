"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "@/components/auth/LogoutButton";
import { Briefcase, DollarSign, TrendingUp, User, Users } from "lucide-react";

// Icon components resolved HERE (client side) from string names passed down
// from the server layout — a Server Component cannot pass a component
// reference (function) as a prop to a Client Component, only serializable
// data like this icon-name string.
const iconMap: { [key: string]: React.ElementType } = {
  Briefcase, DollarSign, TrendingUp, User, Users
};

type NavItem = { href: string; label: string; icon: string };

function NavLink({ href, label, icon }: NavItem) {
  const pathname = usePathname();
  const isActive = pathname === href;
  const Icon = iconMap[icon] || Briefcase;

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        isActive
          ? "bg-stone-800 text-white"
          : "text-stone-400 hover:bg-stone-900 hover:text-white"
      }`}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </Link>
  );
}

export default function BusinessSidebarNav({
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
  const HeaderIcon = iconMap[headerIcon] || Briefcase;

  return (
    <aside className="w-64 flex-shrink-0 bg-stone-950 border-r border-stone-800 p-4 flex flex-col">
      <div className="flex items-center gap-3 mb-8 px-2">
        <HeaderIcon className="w-5 h-5 text-stone-300" />
        <h1 className="font-bold text-white tracking-tight">{headerLabel}</h1>
      </div>
      <nav className="space-y-1 flex-1">
        {navItems.map((item) => (
          <NavLink key={item.href} {...item} />
        ))}
      </nav>
      <div className="pt-4 mt-4 border-t border-stone-800">
        <p className="px-1 text-[10px] text-stone-500 truncate mb-1">{userEmail}</p>
        <LogoutButton />
      </div>
    </aside>
  );
}