import Link from "next/link";
import portalRegistry from "@/registry/portals.json";
import { ArrowLeft, Clock } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Portal Shell — Canonical shell for standalone Portal / Capability pages
 * (Phase 3 consolidation, DEL-05 merge).
 *
 * This ONE implementation replaces two previously parallel shells that rendered
 * the same chrome (dark header + centred title/description + max-w-screen-lg main):
 *
 *   - components/portal/PortalShell.tsx        → mode A: `portalId` + registry/portals.json
 *   - components/landing/CapabilityPageShell.tsx → mode B: explicit `title` / `description`
 *
 * Both public interfaces are kept, because both still have live consumers, and each
 * mode renders exactly what its consumer rendered before this merge (mode A keeps the
 * Shell/Official status chip and the shell note boxes and has no footer; mode B keeps
 * the footer and has no status chip).
 *
 * Presentation only: no data access, no business logic, no side effects.
 * The registry read in mode A is the same static `registry/portals.json` label lookup
 * the original PortalShell already used (SAFE_WITH_NOTE in the boundary plan).
 */

export type PortalId = keyof typeof portalRegistry.portals;

type PortalMode = {
  portalId: PortalId;
  title?: undefined;
  description?: undefined;
  children?: ReactNode;
};

type CapabilityMode = {
  portalId?: undefined;
  title: string;
  description: string;
  children: ReactNode;
};

export type PortalShellProps = PortalMode | CapabilityMode;

export default function PortalShell(props: PortalShellProps) {
  const portalId = "portalId" in props ? props.portalId : undefined;
  const portal = portalId ? portalRegistry.portals[portalId] : null;
  const isShell = portal?.status === "shell";
  const children = props.children;
  const title = portal ? portal.name : props.title;
  const description = portal ? portal.purpose_th : props.description;

  return (
    <div className="min-h-screen bg-black text-stone-300 font-sans">
      <header className="border-b border-stone-800">
        <div className={`max-w-screen-lg mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center${portal ? " justify-between" : ""}`}>
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-stone-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" /> DNA OS
          </Link>
          {portal && (
            <span
              className={`text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                isShell
                  ? "text-amber-400 border-amber-800 bg-amber-950/40"
                  : "text-emerald-400 border-emerald-800 bg-emerald-950/40"
              }`}
            >
              {isShell ? "Shell" : "Official"}
            </span>
          )}
        </div>
      </header>

      <main className="max-w-screen-lg mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="text-center mb-12 animate-[fadeIn_0.5s_ease-out]">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white">{title}</h1>
          <p className="mt-4 max-w-2xl mx-auto text-base sm:text-lg text-stone-400">{description}</p>
        </div>

        {portal && isShell && !children && (
          <div className="max-w-2xl mx-auto bg-stone-950 border border-amber-900/50 rounded-2xl p-6 mb-8 animate-[fadeIn_0.5s_ease-out]">
            <div className="flex items-center gap-2 text-amber-400">
              <Clock className="w-4 h-4" />
              <p className="text-sm font-semibold">ยังไม่มีเนื้อหาจริง — รอรายละเอียดจากเจ้าของระบบ</p>
            </div>
            <p className="text-sm text-stone-500 mt-2">{portal.note}</p>
            <p className="text-xs text-stone-600 mt-3 pt-3 border-t border-stone-800">
              สิทธิ์การเข้าถึง: {portal.access.note}
            </p>
          </div>
        )}
        {portal && isShell && children && (
          <p className="max-w-2xl mx-auto text-center text-xs text-amber-500/80 mb-8 -mt-6">
            Portal ยังไม่เป็นทางการ — เนื้อหาด้านล่างคือข้อมูลจริงจาก Registry ที่เกี่ยวข้อง ไม่ใช่หน้าสมบูรณ์
          </p>
        )}
        {children}
      </main>

      {!portal && (
        <footer className="text-center py-16 border-t border-stone-800/50">
          <Link href="/" className="text-sm text-stone-500 hover:text-stone-300 transition-colors">← Back to DNA OS</Link>
        </footer>
      )}
    </div>
  );
}
