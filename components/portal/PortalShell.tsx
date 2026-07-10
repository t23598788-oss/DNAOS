import Link from "next/link";
import portalRegistry from "@/registry/portals.json";
import { ArrowLeft, Clock } from "lucide-react";

export type PortalId = keyof typeof portalRegistry.portals;

interface PortalShellProps {
  portalId: PortalId;
  children?: React.ReactNode;
}

/**
 * Portal Shell — component เดียวที่ทุก Portal ใหม่ใช้ร่วมกัน
 *
 * ทุก Portal ต่างกันแค่ config ใน registry/portals.json (name/purpose/status/access)
 * ไม่ใช่ component คนละตัว — ป้องกันการสร้าง Logic ซ้ำ (ห้ามสร้าง Business Logic ใหม่ต่อ Portal)
 * ไม่ใช้กับ Control Center / Developer Portal ที่มีอยู่แล้วก่อนตั้ง Portal Registry —
 * สองอันนั้นแค่ "เปลี่ยนสถานะ" ใน portals.json เฉยๆ ไม่แตะโค้ดภายใน
 *
 * Re-skinned 2026-07-07 to match the site's dark visual language (presentation-only —
 * same props, same registry fields, same shell/official logic, no new data or behavior).
 */
export default function PortalShell({ portalId, children }: PortalShellProps) {
  const portal = portalRegistry.portals[portalId];
  const isShell = portal.status === "shell";

  return (
    <div className="min-h-screen bg-black text-stone-300 font-sans">
      <header className="border-b border-stone-800">
        <div className="max-w-screen-lg mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-stone-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" /> DNA OS
          </Link>
          <span
            className={`text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border ${
              isShell
                ? "text-amber-400 border-amber-800 bg-amber-950/40"
                : "text-emerald-400 border-emerald-800 bg-emerald-950/40"
            }`}
          >
            {isShell ? "Shell" : "Official"}
          </span>
        </div>
      </header>

      <main className="max-w-screen-lg mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="text-center mb-12 animate-[fadeIn_0.5s_ease-out]">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white">{portal.name}</h1>
          <p className="mt-4 max-w-2xl mx-auto text-base sm:text-lg text-stone-400">{portal.purpose_th}</p>
        </div>

        {isShell && !children && (
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
        {isShell && children && (
          <p className="max-w-2xl mx-auto text-center text-xs text-amber-500/80 mb-8 -mt-6">
            Portal ยังไม่เป็นทางการ — เนื้อหาด้านล่างคือข้อมูลจริงจาก Registry ที่เกี่ยวข้อง ไม่ใช่หน้าสมบูรณ์
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
