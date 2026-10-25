"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const nav = [
  { href: "/business-workspace-template/overview", label: "ภาพรวม" },
  { href: "/business-workspace-template/workspace", label: "พื้นที่ทำงาน" },
  { href: "/business-workspace-template/tasks", label: "งาน" },
  { href: "/business-workspace-template/documents", label: "เอกสาร" },
];

// Business Workspace Template — STRUCTURE ONLY (presentation reset, owner-directed).
//
// LEFT NAV | (HEADER + MAIN WORK AREA) and nothing else:
//   - no cards / boxes / panels around content
//   - no dark hero box
//   - no numbered navigation
//   - no sidebar menu card / no decoration
//   - header = page title + account area only (no description, no business actions)
//   - main area = empty structural canvas (the caller decides what, if anything, to render)
//   - colour deliberately left flat/neutral (no new accent, no gradient)
//
// This file only lays out the frame. Business logic and capability are untouched;
// Panel/StatusPill below are kept exported exactly as before (still used by the
// UI Gallery component host) — they are simply no longer rendered by these pages.
export function TemplateShell({ title, children }: { title: string; children?: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
          <div className="px-6 py-6 text-base font-semibold tracking-tight">DNA OS</div>
          <nav className="flex-1 space-y-1 px-4 pb-4">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    "block rounded-lg px-3 py-2 text-sm transition " +
                    (active
                      ? "bg-slate-100 font-medium text-slate-900"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="border-b border-slate-200 bg-white">
            <div className="flex min-h-16 items-center justify-between gap-4 px-5 lg:px-8">
              <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
              <div className="text-right">
                <div className="text-xs font-medium text-slate-700">ผู้ใช้งานธุรกิจ</div>
                <div className="text-[11px] text-slate-500">พร้อมใช้งาน</div>
              </div>
            </div>
          </header>
          <div className="p-5 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const style = {
    neutral: "bg-slate-100 text-slate-700",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
    danger: "bg-rose-50 text-rose-700",
  }[tone];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>{children}</span>;
}

export function Panel({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/40">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
